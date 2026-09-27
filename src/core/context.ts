import type { DocumentIndex, Span } from './model';

/** Read adjacent complete blocks, keeping blank lines inside TeX and code intact. */
export function contextAround(index: DocumentIndex, target: Span): { before: string; after: string } {
  const { source, excluded } = index;
  const boundaries = new Set([0, target.from, target.to, source.length]);
  const protectedAt = (at: number) => excluded.some(span => span.from <= at && at < span.to);
  for (const match of source.matchAll(/\r?\n[ \t\r]*\n/g)) {
    if (!protectedAt(match.index!)) boundaries.add(match.index! + match[0].length);
  }
  for (const span of excluded) {
    const text = source.slice(span.from, span.to);
    // Display formulas are blocks even when no blank line surrounds them.
    if (text.startsWith('$$') || /^ {0,3}(`{3,}|~{3,})/.test(text)) {
      boundaries.add(span.from); boundaries.add(Math.min(span.to, source.length));
    }
  }
  for (const match of source.matchAll(/^ {0,3}#{1,6}\s+[^\n]*/gm)) {
    if (!protectedAt(match.index!)) {
      boundaries.add(match.index!); boundaries.add(match.index! + match[0].length);
    }
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const blocks: Array<Span & { text: string }> = [];
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1], to = sorted[i];
    const text = source.slice(from, to).trim();
    if (text) blocks.push({ from, to, text });
  }
  const select = (candidates: typeof blocks, reverse: boolean): string => {
    const chosen: string[] = [];
    let size = 0;
    for (const block of candidates) {
      // Stay within the current section and never preview unfinished display math.
      if (/^#{1,6}\s|^---\r?\n/.test(block.text)) break;
      if (block.text.startsWith('$$') && (block.text.length < 4 || !block.text.endsWith('$$'))) break;
      // The first block is always kept whole. The limit never cuts a formula in half.
      if (chosen.length && size + block.text.length > 2400) break;
      chosen.push(block.text); size += block.text.length;
      if (chosen.length === 2) break;
    }
    return (reverse ? chosen.reverse() : chosen).join('\n\n');
  };
  return {
    before: select(blocks.filter(block => block.to <= target.from).reverse(), true),
    after: select(blocks.filter(block => block.from >= target.to), false)
  };
}
