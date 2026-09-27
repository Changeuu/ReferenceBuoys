import { displayName, type DocumentIndex, type Reference, type Span, type Target, targetKey } from './model';

// Shared by the source parser, reading view and return-point summaries.
export const REFERENCE_PATTERN = /@(?:#?(?:fig|tab|add))?\{#?[^{}\r\n]*\}/g;

const escaped = (source: string, at: number): boolean => {
  let count = 0;
  for (let i = at - 1; i >= 0 && source[i] === '\\'; i--) count++;
  return count % 2 === 1;
};
export const contains = (ranges: Span[], at: number): boolean => ranges.some(r => at >= r.from && at < r.to);
const overlaps = (a: Span, b: Span): boolean => a.from < b.to && b.from < a.to;

/** Exclude literal examples, comments and YAML before looking for navigation syntax. */
function literalRanges(source: string): Span[] {
  const ranges: Span[] = [];
  const lines = source.split('\n');
  let offset = 0;
  let fence: { char: string; count: number; start: number } | undefined;
  let yaml = source.startsWith('---\n') || source.startsWith('---\r\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (yaml) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) {
        ranges.push({ from: 0, to: offset + lines[i].length + 1 });
        yaml = false;
      }
    } else {
      const match = /^(?: {0,3}>\s*)* {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (match && match[1][0] === fence.char && match[1].length >= fence.count && !match[2].trim()) {
          ranges.push({ from: fence.start, to: offset + lines[i].length + 1 });
          fence = undefined;
        }
      } else if (match) {
        fence = { char: match[1][0], count: match[1].length, start: offset };
      } else if (/^(?: {4}|\t)/.test(line)) {
        ranges.push({ from: offset, to: offset + lines[i].length });
      }
    }
    offset += lines[i].length + 1;
  }
  if (yaml) ranges.push({ from: 0, to: source.length });
  if (fence) ranges.push({ from: fence.start, to: source.length });
  for (const match of source.matchAll(/<!--[\s\S]*?(?:-->|$)|%%[\s\S]*?(?:%%|$)/g)) {
    if (!contains(ranges, match.index!)) ranges.push({ from: match.index!, to: match.index! + match[0].length });
  }
  // CommonMark code spans may contain shorter runs of backticks.
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '`' || escaped(source, i) || contains(ranges, i)) continue;
    let length = 1;
    while (source[i + length] === '`') length++;
    let end = i + length;
    let found = false;
    while ((end = source.indexOf('`'.repeat(length), end)) >= 0) {
      if (source[end - 1] !== '`' && source[end + length] !== '`') { found = true; break; }
      end += length;
    }
    if (found) {
      ranges.push({ from: i, to: end + length });
      i = end + length - 1;
    } else i += length - 1;
  }
  return ranges.sort((a, b) => a.from - b.from);
}

export function parseReference(raw: string, from = 0): Reference | undefined {
  const match = /^@(#?)(fig|tab|add)\{([^{}\r\n]+)\}$|^@\{(#?)([^{}\r\n]+)\}$/.exec(raw);
  if (!match) return;
  const typed = Boolean(match[2]);
  let label = (typed ? match[3] : match[5]).trim();
  const kind = typed ? (match[2] === 'fig' ? 'figure' : match[2] === 'tab' ? 'table' : 'addon')
    : label.startsWith('图') ? 'figure' : label.startsWith('表') ? 'table' : 'equation';
  // Continue reading the first release's Chinese syntax in existing notes.
  if (!typed && kind !== 'equation') label = label.slice(1).trim();
  if (!label || label.length > 100 || /[{}\r\n]/.test(label)) return;
  if (typed && label.startsWith('#')) return;
  const definition = (typed ? match[1] : match[4]) === '#';
  if (definition && kind === 'equation') return;
  return { from, to: from + raw.length, kind, label, key: targetKey(kind, label), definition };
}

function findMath(source: string, excluded: Span[]): Array<Span & { contentFrom: number; contentTo: number }> {
  const result: Array<Span & { contentFrom: number; contentTo: number }> = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '$' || escaped(source, i) || contains(excluded, i)) continue;
    const count = source[i + 1] === '$' ? 2 : 1;
    let end = i + count;
    while (end < source.length) {
      if (count === 1 && source[end] === '\n') break;
      if (source[end] === '$' && !escaped(source, end)) {
        if (count === 2 && source[end + 1] !== '$') { end++; continue; }
        if (count === 1 && source[end + 1] === '$') { end += 2; continue; }
        result.push({ from: i, to: end + count, contentFrom: i + count, contentTo: end });
        i = end + count - 1;
        break;
      }
      end++;
    }
    if (end >= source.length && count === 2) {
      // While the author is typing an unfinished formula, don't turn its contents into links.
      excluded.push({ from: i, to: source.length });
      break;
    }
  }
  return result;
}

function tagsInMath(math: string): Array<{ label: string; from: number; to: number }> {
  const result: Array<{ label: string; from: number; to: number }> = [];
  const comments: Span[] = [];
  for (const match of math.matchAll(/%[^\n]*/g)) {
    if (!escaped(math, match.index!)) comments.push({ from: match.index!, to: match.index! + match[0].length });
  }
  for (const match of math.matchAll(/\\tag\*?\s*\{/g)) {
    if (escaped(math, match.index!) || contains(comments, match.index!)) continue;
    const start = match.index! + match[0].length;
    let depth = 1, end = start;
    for (; end < math.length; end++) {
      if (escaped(math, end)) continue;
      if (math[end] === '{') depth++;
      if (math[end] === '}' && --depth === 0) break;
    }
    // Tags are literal user-assigned labels; TeX commands inside the label are intentionally not guessed.
    const label = math.slice(start, end).trim();
    if (depth === 0 && label && !/[{}\\\n]/.test(label)) {
      result.push({ label, from: match.index!, to: end + 1 });
    }
  }
  return result;
}

export function indexDocument(source: string): DocumentIndex {
  const excluded = literalRanges(source);
  // Indented TeX is common inside display math: only the delimiter needs to be outside literal ranges.
  const mathBlocks = findMath(source, excluded);
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (at: number): number => {
    let low = 0, high = lineStarts.length;
    while (low + 1 < high) { const mid = (low + high) >>> 1; if (lineStarts[mid] <= at) low = mid; else high = mid; }
    return low;
  };
  const headings: Array<{ from: number; text: string }> = [];
  for (const match of source.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    if (!contains(excluded, match.index!) && !contains(mathBlocks, match.index!)) headings.push({ from: match.index!, text: match[1] });
  }
  const headingAt = (at: number): string => headings.findLast(h => h.from <= at)?.text ?? '正文';
  const targets: Target[] = [];
  for (const block of mathBlocks) {
    const math = source.slice(block.contentFrom, block.contentTo);
    const tags = tagsInMath(math);
    tags.forEach((tag, index) => {
      const tagFrom = block.contentFrom + tag.from;
      const line = lineAt(tagFrom);
      const focus = { from: Math.max(block.contentFrom, lineStarts[line]), to: Math.min(block.contentTo, lineStarts[line + 1] === undefined ? source.length : lineStarts[line + 1] - 1) };
      targets.push({
        from: block.from, to: block.to, focus, line, kind: 'equation', label: tag.label,
        key: targetKey('equation', tag.label), markdown: `$$\n${math.trim()}\n$$`, math,
        tagIndex: index, tagCount: tags.length, heading: headingAt(block.from), caption: ''
      });
    });
  }
  const allExcluded = [...excluded, ...mathBlocks];
  const references: Reference[] = [];
  for (const match of source.matchAll(REFERENCE_PATTERN)) {
    const from = match.index!;
    if (escaped(source, from) || allExcluded.some(r => overlaps(r, { from, to: from + match[0].length }))) continue;
    const ref = parseReference(match[0], from);
    if (!ref) continue;
    // Do not replace tokens embedded inside image alt text or Markdown destinations.
    const line = lineAt(from);
    const lineStart = lineStarts[line];
    const prefix = source.slice(lineStart, from);
    if (/!\[[^\]]*$|!\[\[[^\]]*$|\]\([^)]*$/.test(prefix)) continue;
    references.push(ref);
    if (!ref.definition || prefix.trim()) continue;
    const lineEnd = lineStarts[line + 1] === undefined ? source.length : lineStarts[line + 1] - 1;
    const caption = source.slice(ref.to, lineEnd).trim();
    let blockEnd = lineStart;
    while (blockEnd > 0 && /\s/.test(source[blockEnd - 1])) blockEnd--;
    const blockEndLine = lineAt(Math.max(0, blockEnd - 1));
    let blockStart = lineStarts[blockEndLine];
    const previousLine = source.slice(blockStart, blockEnd).trim();
    if (ref.kind === 'figure') {
      if (!/^(?:!\[\[[^\n]+\]\]|!\[[^\n]*\]\([^\n]+\))$/.test(previousLine)) continue;
    } else if (ref.kind === 'table') {
      while (blockStart > 0) {
        const prevLine = lineAt(blockStart - 1);
        const value = source.slice(lineStarts[prevLine], blockStart).trim();
        if (!value || !value.includes('|')) break;
        blockStart = lineStarts[prevLine];
      }
      const table = source.slice(blockStart, blockEnd).split('\n');
      if (table.length < 2 || !/^\s*\|?\s*:?-{3,}:?\s*\|(?:\s*:?-{3,}:?\s*\|?\s*)+$/.test(table[1])) continue;
    } else {
      const start = precedingContentStart(source, blockEnd, allExcluded);
      if (start === undefined) continue;
      blockStart = start;
    }
    if (ref.kind !== 'addon' && excluded.some(r => overlaps(r, { from: blockStart, to: blockEnd }))) continue;
    targets.push({ from: blockStart, to: lineEnd, focus: { from: blockStart, to: blockEnd },
      line: lineAt(blockStart), kind: ref.kind, label: ref.label, key: ref.key,
      markdown: source.slice(blockStart, blockEnd), heading: headingAt(blockStart), caption,
      definition: { from: ref.from, to: ref.to }
    });
  }
  targets.sort((a, b) => a.from - b.from || a.focus.from - b.focus.from);
  const byKey = new Map<string, Target[]>();
  for (const target of targets) {
    const list = byKey.get(target.key) ?? [];
    list.push(target);
    byKey.set(target.key, list);
  }
  return { source, references, targets, byKey, excluded: allExcluded };
}

export function contextExcerpt(source: string, position: number): string {
  const start = source.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const end = source.indexOf('\n', position);
  return source.slice(start, end < 0 ? source.length : end).trim().replace(REFERENCE_PATTERN, raw => {
    const ref = parseReference(raw);
    return ref ? displayName(ref) : raw;
  }).replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/, '')
    .replace(/(\*\*|__|~~|`+)(.*?)\1/g, '$2').slice(0, 90) || '此处的阅读位置';
}

/** The add marker labels one complete block directly above it. Multi-paragraph material
 * can be grouped into a quote/callout, whose blank lines start with > as in Markdown. */
function precedingContentStart(source: string, end: number, excluded: Span[]): number | undefined {
  if (end <= 0) return;
  const lineStart = (at: number) => source.lastIndexOf('\n', Math.max(0, at - 1)) + 1;
  let start = lineStart(end);
  const lastLine = source.slice(start, end).trim();
  const quote = /^ {0,3}>/.test(source.slice(start, end));
  const atomic = excluded.filter(span => {
    const text = source.slice(span.from, span.to);
    return text.startsWith('$$') || /^ {0,3}(`{3,}|~{3,})/.test(text);
  });
  const lastBlock = atomic.find(span => span.from < end && span.to >= end);
  if (lastBlock && !quote) return lastBlock.from;
  if (!lastLine || /^@(?:#(?:fig|tab|add)\{|\{#)/.test(lastLine)) return;
  if (/^#{1,6}\s|^!\[/.test(lastLine)) return start;
  while (start > 0) {
    const previousStart = lineStart(start - 1);
    const previous = source.slice(previousStart, start).trim();
    if (!previous || /^#{1,6}\s|^@(?:#(?:fig|tab|add)\{|\{#)/.test(previous)) break;
    if (quote !== previous.startsWith('>')) break;
    if (!quote && atomic.some(span => span.from < start && span.to > previousStart)) break;
    start = previousStart;
  }
  // YAML and hidden comments cannot be useful labeled content.
  if (excluded.some(span => span.from <= start && span.to >= end
    && /^(?:---\r?\n|<!--|%%)/.test(source.slice(span.from, span.to)))) return;
  return start;
}
