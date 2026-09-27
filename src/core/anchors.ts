import type { ChangeDesc } from '@codemirror/state';

export interface ReturnPoint {
  id: number;
  path: string;
  from: number;
  to: number;
  cursorAnchor: number;
  cursorHead: number;
  viewportFrom: number;
  viewportOffset: number;
  scrollLeft: number;
  excerpt: string;
  heading: string;
  lost: boolean;
}

/** Positions follow CM6 transactions; matching repeated sentences by text alone is ambiguous. */
export function mapReturnPoint(point: ReturnPoint, changes: ChangeDesc): void {
  changes.iterChangedRanges((from, to) => {
    if (to > from && from <= point.from && to >= point.to && point.to > point.from) point.lost = true;
  });
  point.from = changes.mapPos(point.from, 1);
  point.to = Math.max(point.from, changes.mapPos(point.to, -1));
  point.cursorAnchor = changes.mapPos(point.cursorAnchor, 1);
  point.cursorHead = changes.mapPos(point.cursorHead, 1);
  point.viewportFrom = changes.mapPos(point.viewportFrom, 1);
}

export function contiguousEdit(before: string, after: string): { from: number; to: number; insert: string } | undefined {
  if (before === after) return;
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > from && newEnd > from && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  return { from, to: oldEnd, insert: after.slice(from, newEnd) };
}
