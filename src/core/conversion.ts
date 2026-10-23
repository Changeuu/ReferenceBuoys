import { kindName, referenceSource, type DocumentIndex, type Span, type TargetKind } from './model';

export interface ConversionTemplate { pattern: string; kind: TargetKind }
export interface ConversionProfile {
  id: string;
  name: string;
  includePresets: boolean;
  templates: ConversionTemplate[];
}
export interface ConversionMatch { kind: TargetKind; label: string; replacement: string; template: string }
export type DragModifier = 'off' | 'Alt' | 'Control';
export const PRESET_TEMPLATES: ConversionTemplate[] = [
  ...['式{n}', '式({n})', '(式{n})', '公式{n}', '公式({n})', '({n})', 'Eq. ({n})', 'Eq. {n}', 'Equation ({n})']
    .map(pattern => ({ pattern, kind: 'equation' as const })),
  ...['图{n}', '图({n})', '(图{n})', 'Fig. {n}', 'Fig. ({n})', 'Figure {n}']
    .map(pattern => ({ pattern, kind: 'figure' as const })),
  ...['表{n}', '表({n})', '(表{n})', 'Table {n}'].map(pattern => ({ pattern, kind: 'table' as const })),
  ...['附{n}', '附({n})', '(附{n})'].map(pattern => ({ pattern, kind: 'addon' as const })),
  ...['定义{n}', '定义({n})', '(定义{n})', 'Definition {n}', 'Def. {n}', 'Def. ({n})'].map(pattern => ({ pattern, kind: 'definition' as const })),
  ...['定理{n}', '定理({n})', '(定理{n})', 'Theorem {n}', 'Thm. {n}', 'Thm. ({n})'].map(pattern => ({ pattern, kind: 'theorem' as const }))
];
export function defaultProfiles(): ConversionProfile[] {
  return [{ id: 'default', name: '通用', includePresets: true, templates: [] }];
}

const isKind = (value: unknown): value is TargetKind => typeof value === 'string' && Object.hasOwn(kindName, value);
export function loadProfiles(raw: unknown): ConversionProfile[] {
  if (!Array.isArray(raw)) return defaultProfiles();
  const seen = new Set<string>();
  const profiles: ConversionProfile[] = [];
  for (const item of raw) {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    profiles.push({ id: item.id, name: typeof item.name === 'string' ? item.name : '未命名', includePresets: item.includePresets !== false,
      templates: Array.isArray(item.templates) ? item.templates.filter((t: any) => t && typeof t.pattern === 'string' && isKind(t.kind))
        .map((t: ConversionTemplate) => ({ pattern: t.pattern, kind: t.kind })) : [] });
  }
  return profiles.length ? profiles : defaultProfiles();
}

export function templateError(pattern: string): string | undefined {
  if (!pattern.trim()) return '请输入模板，例如 式({n})。';
  if (pattern.length > 200 || /[\r\n]/.test(pattern)) return '模板需要在一行内，长度不超过 200 字符。';
  if (!pattern.includes('{n}')) return '模板至少需要一个 {n} 来提取编号。';
  if (/[{}]/.test(pattern.replace(/\{(?:n|\*)\}/g, ''))) return '只支持 {n}（编号）和 {*}（忽略内容）占位符。';
}

const labelSyntax = /^[A-Za-z0-9]+(?:[.\-][A-Za-z0-9]+)*(?:\([A-Za-z0-9]+\))?$/;
const validLabel = (text: string) => text.length <= 100 && labelSyntax.test(text);
const brackets: Record<string, string> = { '（': '(', '）': ')', '［': '[', '］': ']' };
const canonical = (char: string) => brackets[char] ?? char;
type Token = { type: 'literal'; char: string } | { type: 'space' | 'label' | 'wildcard' };
function tokenize(pattern: string): Token[] {
  const tokens: Token[] = [];
  const space = () => { if (tokens.at(-1)?.type !== 'space') tokens.push({ type: 'space' }); };
  for (let i = 0; i < pattern.length; i++) {
    const placeholder = pattern.slice(i, i + 3);
    if (placeholder === '{n}' || placeholder === '{*}') {
      space(); tokens.push({ type: placeholder === '{n}' ? 'label' : 'wildcard' }); space(); i += 2;
    } else if (/\s/.test(pattern[i])) space();
    else {
      const char = canonical(pattern[i]);
      if ('()[]'.includes(char)) space();
      tokens.push({ type: 'literal', char });
      if ('()[]'.includes(char)) space();
    }
  }
  return tokens;
}

export interface ConversionAnalysis { matches: ConversionMatch[]; error?: string }

/** A finite-state table avoids regex backtracking with repeated wildcards.
 * Inspect every accepting path, so an ambiguous wildcard never silently picks a label. */
function extractLabel(input: string, pattern: string): { label?: string; error?: string } {
  const tokens = tokenize(pattern.trim()), length = input.length;
  const table = Array.from({ length: tokens.length + 1 }, () => new Uint8Array(length + 1));
  table[tokens.length][length] = 1;
  const ends = Array.from({ length: length + 1 }, (_, start) => {
    const result: number[] = [];
    for (let end = start + 1; end <= Math.min(length, start + 100); end++) {
      if (validLabel(input.slice(start, end))) result.push(end);
    }
    return result;
  });
  let operations = 0;
  for (let t = tokens.length - 1; t >= 0; t--) {
    const token = tokens[t], row = table[t], next = table[t + 1];
    for (let p = length; p >= 0; p--) {
      if (++operations > 500_000) return { error: '模板匹配过于复杂，请增加固定文字或减少占位符。' };
      if (token.type === 'label') {
        for (const end of ends[p]) {
          if (++operations > 500_000) return { error: '模板匹配过于复杂，请增加固定文字或减少占位符。' };
          if (next[end]) { row[p] = 1; break; }
        }
      } else if (token.type === 'literal') row[p] = Number(p < length && canonical(input[p]) === token.char && Boolean(next[p + 1]));
      else row[p] = Number(Boolean(next[p]) || (p < length && Boolean(row[p + 1]) && (token.type === 'wildcard' || /\s/.test(input[p]))));
    }
  }
  if (!table[0][0]) return {};
  const labels = new Set<string>();
  const seen = new Set<number>();
  const pending: Array<[number, number]> = [[0, 0]];
  while (pending.length) {
    const [t, p] = pending.pop()!;
    const key = t * (length + 1) + p;
    if (seen.has(key) || !table[t][p] || t === tokens.length) continue;
    seen.add(key);
    const token = tokens[t];
    if (token.type === 'label') {
      for (const end of ends[p]) if (table[t + 1][end]) {
        labels.add(input.slice(p, end));
        if (labels.size > 1) {
          const repeated = tokens.filter(t => t.type === 'label').length > 1;
          return { error: repeated
            ? `多个 {n} 提取到不一致或不明确的编号：${[...labels].join('、')}。不同写法可改用 {*} 忽略。`
            : '占位符可以提取出不同编号，请在 {n} 周围增加固定文字或括号。' };
        }
        pending.push([t + 1, end]);
      }
    } else if (token.type === 'literal') pending.push([t + 1, p + 1]);
    else {
      pending.push([t + 1, p]);
      if (p < length && (token.type === 'wildcard' || /\s/.test(input[p]))) pending.push([t, p + 1]);
    }
  }
  return { label: [...labels][0] };
}

/** Anchored matching on one explicitly selected reference, never a document search. */
export function analyzeSelectedReference(text: string, profile: ConversionProfile): ConversionAnalysis {
  if (!text.trim() || text.length > 500 || /[\r\n]/.test(text)) return { matches: [] };
  if ((text.match(/\[\[|［［/g) ?? []).length > 1) return { matches: [], error: '请一次只选中一个完整引用。' };
  const leading = /^\s*/.exec(text)![0], trailing = /\s*$/.exec(text)![0];
  const input = text.trim();
  const templates = [...(profile.includePresets ? PRESET_TEMPLATES : []), ...profile.templates];
  const matches = new Map<string, ConversionMatch>();
  let error: string | undefined;
  for (const template of templates) {
    if (templateError(template.pattern)) continue;
    const extracted = extractLabel(input, template.pattern);
    error ??= extracted.error;
    if (!extracted.label) continue;
    const replacement = leading + referenceSource({ kind: template.kind, label: extracted.label }) + trailing;
    matches.set(replacement, { kind: template.kind, label: extracted.label, replacement, template: template.pattern });
  }
  return matches.size ? { matches: [...matches.values()] } : { matches: [], error };
}

export function matchSelectedReference(text: string, profile: ConversionProfile): ConversionMatch[] {
  return analyzeSelectedReference(text, profile).matches;
}

/** A citation may use $...$ to typeset its label. Only a complete, label-only inline
 * math span can participate; templates cannot bypass protection of other content. */
export function analyzeDocumentSelection(index: DocumentIndex, range: Span, profile: ConversionProfile): ConversionAnalysis {
  const overlaps = (span: Span) => span.from < range.to && range.from < span.to;
  const mathLabels: string[] = [];
  for (const span of index.excluded.filter(overlaps)) {
    const raw = index.source.slice(span.from, span.to);
    const label = /^\$([^$\r\n]+)\$$/.exec(raw)?.[1].trim();
    // Code, comments, metadata and display math do not have this exact shape.
    // Containment also prevents replacing a fragment inside a larger formula.
    if (span.from < range.from || span.to > range.to || !label || !validLabel(label)) {
      return { matches: [], error: '代码和公式内容保持原样。若是用 $…$ 排版的引用编号，请连同完整引用一起选中并匹配模板。' };
    }
    mathLabels.push(label);
  }
  if (index.references.some(overlaps)) return { matches: [], error: '所选内容已包含标准引用。' };
  const analysis = analyzeSelectedReference(index.source.slice(range.from, range.to), profile);
  if (!mathLabels.length || !analysis.matches.length) return analysis;
  const matches = analysis.matches.filter(match => mathLabels.every(label => label === match.label));
  return matches.length ? { matches } : {
    matches: [], error: '所选行内数学中的编号与模板提取的编号不一致，已保留原文。'
  };
}

/** Local suggestion from one example; callers keep it editable and require an explicit save. */
export function suggestTemplate(sample: string, label: string, kind: TargetKind): { pattern?: string; error?: string } {
  label = label.trim(); sample = sample.trim();
  if (!validLabel(label)) return { error: '请输入完整编号，例如 1.1.4 或 1.13a。' };
  if (!sample || sample.length > 500 || /[\r\n{}]/.test(sample)) return { error: '请粘贴一行原始引用，不包含占位符。' };
  const part = (text: string) => {
    let result = '';
    for (let i = 0; i < text.length;) {
      if (text.startsWith(label, i) && !/[A-Za-z0-9.\-]/.test(text[i - 1] ?? '')
        && !/[A-Za-z0-9.\-]/.test(text[i + label.length] ?? '')) { result += '{n}'; i += label.length; }
      else result += text[i++];
    }
    return result;
  };
  // Keep a wiki anchor's prefix but ignore its encoded number (1-1-4 vs 1.1.4).
  const wiki = /^(.*?\[\[#\^)([^|\]\r\n]+)(\|)([^\]\r\n]+)(\]\].*)$/.exec([...sample].map(canonical).join(''));
  let pattern: string;
  if (wiki && part(wiki[4]).includes('{n}')) {
    const anchor = wiki[2], alias = label.replaceAll('.', '-');
    const suffix = anchor.endsWith(label) ? label : anchor.endsWith(alias) ? alias : undefined;
    const prefix = suffix ? anchor.slice(0, -suffix.length) : '';
    const anchorPattern = suffix && (!prefix || /[-_:]$/.test(prefix))
      ? prefix + (suffix === label ? '{n}' : '{*}') : '{*}';
    pattern = part(wiki[1]) + anchorPattern + wiki[3] + part(wiki[4]) + part(wiki[5]);
  } else pattern = part(sample);
  const error = templateError(pattern);
  if (error) return { error: pattern.includes('{n}') ? error : '示例中没有找到这个完整编号，请检查实际编号。' };
  const trial = analyzeSelectedReference(sample, { id: '', name: '', includePresets: false, templates: [{ pattern, kind }] });
  if (trial.matches.length !== 1 || trial.matches[0].label !== label) return { error: trial.error ?? '无法确定模板，请手动填写。' };
  return { pattern };
}

export function modifierHeld(event: Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>, mode: DragModifier): boolean {
  if (event.metaKey || event.shiftKey) return false;
  return mode === 'Alt' ? event.altKey && !event.ctrlKey : mode === 'Control' ? event.ctrlKey && !event.altKey : false;
}
