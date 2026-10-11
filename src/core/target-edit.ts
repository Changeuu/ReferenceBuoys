import { indexDocument } from './parser';
import { kindName, referenceSource, targetKey, type DocumentIndex, type Span } from './model';

export type ContentKind = 'definition' | 'theorem';
export interface TargetSelection extends Span { content: string }
export interface TargetEdit extends Span { insert: string; markdown: string; reference: string; wrapped: boolean }
export type TargetPlan = { edit: TargetEdit; error?: undefined } | { edit?: undefined; error: string };

/** Require complete lines and complete embedded blocks; never expand into unselected prose. */
export function targetSelection(source: string, range: Span, index: DocumentIndex = indexDocument(source)):
  { selection: TargetSelection; error?: undefined } | { selection?: undefined; error: string } {
  if (range.from < 0 || range.to > source.length || range.from >= range.to || !source.slice(range.from, range.to).trim()) {
    return { error: '请先选中完整的定义或定理内容。' };
  }
  if (range.to - range.from > 100_000) return { error: '选区超过 10 万字符，请只选中这一条定义或定理。' };
  let from = source.lastIndexOf('\n', range.from - 1) + 1;
  const nextLine = source.indexOf('\n', range.to - 1);
  let to = nextLine < 0 ? source.length : nextLine;
  if (source[to - 1] === '\r') to--;
  if (source.slice(from, range.from).trim() || source.slice(range.to, to).trim()) {
    return { error: '请从首行开头选到末行结尾，包含完整的 Markdown 标记。' };
  }
  let content = source.slice(from, to);
  const leading = /^(?:[ \t]*\r?\n)+/.exec(content)?.[0].length ?? 0;
  from += leading; content = content.slice(leading);
  const trailing = /(?:\r?\n[ \t]*)+$/.exec(content)?.[0].length ?? 0;
  to -= trailing; content = source.slice(from, to);
  const overlaps = (span: Span) => span.from < to && from < span.to;
  for (const span of index.excluded.filter(overlaps)) {
    const literal = source.slice(span.from, span.to);
    if (span.from === 0 && /^---\r?\n/.test(literal)) return { error: '笔记属性不能作为定义或定理内容。' };
    const end = span.from + literal.trimEnd().length;
    if (span.from < from || end > to) return { error: '选区截断了公式、代码或注释，请选中完整内容。' };
  }
  if (index.references.some(ref => ref.definition && overlaps(ref))) return { error: '选区已包含编号标记，请先移除旧标记或缩小选区。' };
  if (index.targets.some(target => target.kind !== 'equation' && overlaps(target))) return { error: '这段内容已有引用目标标记，请编辑原标记。' };
  // An unfinished display formula/fence cannot be safely enclosed in a new callout.
  const local = indexDocument(content + '\n\n@#add{reflo-selection-end}');
  if (!local.references.some(ref => ref.definition && ref.label === 'reflo-selection-end')) {
    return { error: '选区含有未闭合的公式、代码块或注释，请先补全。' };
  }
  return { selection: { from, to, content } };
}

export function inferTarget(content: string): { kind: ContentKind; label: string } {
  const first = content.split(/\r?\n/, 1)[0].replace(/^\s*(?:>\s*)*/, '').replace(/^\[![^\]]+\][+-]?\s*/, '')
    .replace(/^#{1,6}\s+/, '').replace(/\*\*|__/g, ' ').trim();
  const match = /^(定义|定理|Definition|Def\.?|Theorem|Thm\.?)\s*[（(]?\s*([A-Za-z0-9]+(?:[.\-][A-Za-z0-9]+)*(?:\([A-Za-z0-9]+\))?)/i.exec(first);
  const kind = match && /^(定理|Theorem|Thm)/i.test(match[1]) ? 'theorem' : 'definition';
  return { kind, label: match?.[2] ?? '' };
}

export function planTarget(source: string, selection: TargetSelection, kind: ContentKind, label: string,
  index: DocumentIndex = indexDocument(source)): TargetPlan {
  label = label.trim();
  if (!label || label.length > 100 || !/^[A-Za-z0-9]+(?:[.\-][A-Za-z0-9]+)*(?:\([A-Za-z0-9]+\))?$/.test(label)) {
    return { error: '请输入完整编号，例如 1.1.1、1.13a 或 A.1。' };
  }
  if (index.byKey.has(targetKey(kind, label))) return { error: `本篇已有${kindName[kind]} ${label}，请使用其他编号或编辑已有目标。` };
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const reference = referenceSource({ kind, label }), marker = reference.replace('@', '@#');
  const { content, from, to } = selection;
  const direct = indexDocument(content + eol + eol + marker).byKey.get(targetKey(kind, label))?.[0];
  const wrapped = !direct || direct.focus.from !== 0 || direct.markdown !== content.trimEnd();
  const markdown = wrapped ? `> [!${kind}] ${kindName[kind]} ${label}${eol}` + content.split(/\r?\n/).map(line => line ? `> ${line}` : '>').join(eol) : content;
  // Separate the chosen lines from adjacent prose, even when the source has no blank lines.
  const before = source.slice(0, from), after = source.slice(to);
  const prefix = before && !/\n[ \t]*\r?\n$/.test(before) ? eol : '';
  const suffix = !after ? '' : /^\r?\n[ \t]*\r?\n/.test(after) ? '' : eol;
  const insert = prefix + markdown + eol + eol + marker + suffix;
  // Validate the exact prospective document so the target cannot capture nearby prose.
  const prospective = indexDocument(before + insert + after).byKey.get(targetKey(kind, label));
  if (prospective?.length !== 1 || prospective[0].markdown !== markdown.trimEnd()) {
    return { error: '无法准确界定这段内容，请检查选区是否包含完整的段落或 Callout。' };
  }
  return { edit: { from, to, insert, markdown, reference, wrapped } };
}
