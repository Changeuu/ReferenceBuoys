import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTargetSelection, defaultProfiles, dragAction } from '../src/core/conversion';
import { indexDocument } from '../src/core/parser';

const profile = defaultProfiles()[0];
function analyze(source: string, selected: string) {
  const from = source.indexOf(selected);
  return analyzeTargetSelection(indexDocument(source), { from, to: from + selected.length }, profile);
}

test('caption marking preserves the remaining title and creates a bound figure target', () => {
  const source = '![[figure.png]]\n 图（1.3） 磁场的方向\n\n另一处图（1.3）';
  const result = analyze(source, ' 图（1.3） ');
  assert.deepEqual(result.matches.map(m => m.replacement), [' @#fig{1.3} ']);
  const replaced = source.replace(' 图（1.3） ', result.matches[0].replacement);
  const targets = indexDocument(replaced).targets;
  assert.equal(targets.length, 1);
  assert.equal(targets[0].caption, '磁场的方向');
  assert.equal(targets[0].markdown, '![[figure.png]]');
  assert.ok(replaced.endsWith('另一处图（1.3）'));
});

test('table and content markers use the matching typed syntax', () => {
  for (const [source, selection, expected] of [
    ['| a | b |\n| --- | --- |\n| 1 | 2 |\n表1.1', '表1.1', '@#tab{1.1}'],
    ['附加说明。\n附A.1', '附A.1', '@#add{A.1}'],
    ['完整定义。\n定义1.1.b', '定义1.1.b', '@#def{1.1.b}'],
    ['完整定理。\n定理1.1.Gauss', '定理1.1.Gauss', '@#thm{1.1.Gauss}']
  ]) assert.deepEqual(analyze(source, selection).matches.map(m => m.replacement), [expected]);
});

test('unsupported equations, unbound captions and protected text remain untouched', () => {
  assert.match(analyze('式1.3', '式1.3').error!, /tag/);
  for (const [source, selection] of [
    ['图1.3', '图1.3'], ['![图](a.png)\n见图1.3', '图1.3'],
    ['普通段落\n图1.3', '图1.3'], ['![图](a.png)\n`图1.3`', '图1.3'],
    ['$$ \\text{图1.3} $$', '图1.3'], ['![图](a.png)\n@fig{1.3}', '@fig{1.3}']
  ]) assert.equal(analyze(source, selection).matches.length, 0, source);
});

test('target drag is the exact Ctrl+Alt chord and respects the off setting', () => {
  const chord = { altKey: true, ctrlKey: true, metaKey: false, shiftKey: false };
  for (const setting of ['Alt', 'Control'] as const) assert.equal(dragAction(chord, setting), 'target');
  assert.equal(dragAction(chord, 'off'), undefined);
  assert.equal(dragAction({ ...chord, shiftKey: true }, 'Alt'), undefined);
  assert.equal(dragAction({ ...chord, metaKey: true }, 'Alt'), undefined);
  assert.equal(dragAction({ ...chord, ctrlKey: false }, 'Alt'), 'reference');
  assert.equal(dragAction({ ...chord, altKey: false }, 'Alt'), undefined);
});
