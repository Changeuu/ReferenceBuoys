import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeSet } from '@codemirror/state';
import { contiguousEdit, mapReturnPoint, type ReturnPoint } from '../src/core/anchors';

function point(): ReturnPoint {
  return { id: 1, path: 'test.md', from: 10, to: 16, cursorAnchor: 10, cursorHead: 10,
    viewportFrom: 3, viewportOffset: 15, scrollLeft: 0, excerpt: '原文', heading: '正文', lost: false };
}
test('inserting earlier paragraphs moves both return and viewport anchors', () => {
  const p = point(); mapReturnPoint(p, ChangeSet.of({ from: 0, insert: 'new\n' }, 30));
  assert.equal(p.from, 14); assert.equal(p.to, 20); assert.equal(p.viewportFrom, 7); assert.equal(p.viewportOffset, 15); assert.equal(p.lost, false);
});
test('editing elsewhere does not invalidate the departure', () => {
  const p = point(); mapReturnPoint(p, ChangeSet.of({ from: 20, to: 25, insert: 'changed' }, 30));
  assert.equal(p.from, 10); assert.equal(p.lost, false);
});
test('removing the departure marks it lost instead of silently identifying a replacement', () => {
  const p = point(); mapReturnPoint(p, ChangeSet.of({ from: 8, to: 18, insert: '' }, 30));
  assert.equal(p.from, 8); assert.equal(p.lost, true);
});
test('several buoys survive independent mapping', () => {
  const a = point(), b = { ...point(), id: 2, from: 22, to: 26 };
  const changes = ChangeSet.of({ from: 0, insert: 'XX' }, 30);
  [a, b].forEach(p => mapReturnPoint(p, changes));
  assert.equal(a.from, 12); assert.equal(b.from, 24);
});
test('external file edits are reduced to one precise replacement', () => {
  assert.deepEqual(contiguousEdit('alpha BETA end', 'alpha gamma end'), { from: 6, to: 10, insert: 'gamma' });
  assert.equal(contiguousEdit('same', 'same'), undefined);
});
