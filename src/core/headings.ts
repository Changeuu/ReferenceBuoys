import type { Span, Target } from './model';

export interface HeadingReference extends Span {
  kind: 'heading';
  label: string;
  key: string;
  linkpath: string;
  alias?: string;
}
export interface HeadingTarget extends Omit<Target, 'kind'> {
  kind: 'heading';
  level: number;
}
export type NavigationTarget = Target | HeadingTarget;
export type PreviewReference = Pick<Target, 'kind' | 'key' | 'label'> | Pick<HeadingReference, 'kind' | 'key' | 'label' | 'linkpath'>;
export const headingKey = (heading: string): string => `heading\u0000${heading}`;

export function parseHeadingLink(raw: string, from = 0): HeadingReference | undefined {
  const match = /^\[\[([^\[\]\r\n|]*?)(?:\|([^\]\r\n]*))?\]\]$/.exec(raw);
  if (!match) return;
  const hash = match[1].indexOf('#');
  if (hash < 0) return;
  const linkpath = match[1].slice(0, hash).trim();
  const label = match[1].slice(hash + 1).trim();
  if (!label || label.startsWith('^')) return;
  return { from, to: from + raw.length, kind: 'heading', label, key: headingKey(label), linkpath, alias: match[2] };
}

export function indexHeadingLinks(source: string, excluded: Span[]): HeadingReference[] {
  const result: HeadingReference[] = [];
  for (const match of source.matchAll(/\[\[[^\[\]\r\n]+\]\]/g)) {
    const from = match.index!, to = from + match[0].length;
    if (source[from - 1] === '!' || (/\\+$/.exec(source.slice(0, from))?.[0].length ?? 0) % 2
      || excluded.some(r => r.from < to && r.to > from)) continue;
    const ref = parseHeadingLink(match[0], from);
    if (ref) result.push(ref);
  }
  return result;
}

/** Source offsets come from the live document, including edits not yet in Obsidian's metadata cache. */
export function indexHeadings(source: string, excluded: Span[]): HeadingTarget[] {
  const result: HeadingTarget[] = [];
  const lines = source.split('\n');
  let from = 0;
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line].replace(/\r$/, '');
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(text);
    const setext = !atx && text.trim() && !/^\s*(?:>|[-*+]\s|\d+[.)]\s)/.test(text)
      && /^ {0,3}(=+|-+)[ \t]*\r?$/.exec(lines[line + 1] ?? '');
    const label = atx ? (atx[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim() : setext ? text.trim() : '';
    const end = from + text.length + (setext ? 1 + lines[line + 1].replace(/\r$/, '').length : 0);
    // Inline code is valid in a heading. Only its opening line position must be outside literals.
    if (label && !excluded.some(r => r.from <= from && r.to > from)) {
      result.push({ kind: 'heading', key: headingKey(label), label, heading: label, caption: '',
        from, to: end, focus: { from, to: end }, line,
        level: atx ? atx[1].length : setext && setext[1][0] === '=' ? 1 : 2, markdown: '' });
    }
    from += lines[line].length + 1;
    if (setext) { line++; from += lines[line].length + 1; }
  }
  result.forEach((heading, i) => {
    heading.to = result.slice(i + 1).find(next => next.level <= heading.level)?.from ?? source.length;
    heading.markdown = source.slice(heading.from, heading.to).trimEnd();
  });
  return result;
}
