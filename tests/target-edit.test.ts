import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferTarget, planTarget, targetSelection, type ContentKind } from '../src/core/target-edit';
import { indexDocument } from '../src/core/parser';
import { targetKey } from '../src/core/model';

function plan(source: string, content: string, kind: ContentKind = 'definition', label = '1.1.1') {
  const from = source.indexOf(content);
  const prepared = targetSelection(source, { from, to: from + content.length });
  assert.ok(prepared.selection, prepared.error);
  return planTarget(source, prepared.selection, kind, label);
}

test('single paragraph receives a marker and keeps adjacent prose outside the target', () => {
  const content = '**定义 1.1.1** 完整内容。\n正常换行仍属本段。';
  const source = '前文\n' + content + '\n后文';
  const result = plan(source, content); assert.ok(result.edit, result.error);
  const edit = result.edit;
  assert.equal(edit.wrapped, false);
  assert.equal(edit.markdown, content);
  assert.equal(edit.reference, '@def{1.1.1}');
  const after = source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
  assert.equal(after, '前文\n\n' + content + '\n\n@#def{1.1.1}\n\n后文');
  assert.equal(indexDocument(after).byKey.get(targetKey('definition', '1.1.1'))![0].markdown, content);
});

test('multiple paragraphs, display math and lists are enclosed without deleting their content', () => {
  const content = '**定理 1.13a** 第一个条件。\n\n$$\na=b \\tag{eq.1}\n$$\n\n- 条件一\n- 条件二';
  const result = plan(content, content, 'theorem', '1.13a'); assert.ok(result.edit, result.error);
  const edit = result.edit;
  assert.equal(edit.wrapped, true);
  assert.equal(edit.markdown.split('\n').slice(1).map(line => line === '>' ? '' : line.slice(2)).join('\n'), content);
  const index = indexDocument(edit.insert);
  assert.equal(index.byKey.get(targetKey('theorem', '1.13a'))?.length, 1);
  const equation = index.byKey.get(targetKey('equation', 'eq.1'))![0];
  assert.equal(equation.math!.trim(), 'a=b \\tag{eq.1}');
  assert.ok(edit.insert.slice(equation.focus.from, equation.focus.to).includes('a=b'));
});

test('an existing complete callout is preserved without another wrapper', () => {
  const content = '> [!definition] 定义 A.1\n> 第一段\n>\n> $$ x=1 $$\n>\n> 最后一个条件。';
  const result = plan(content, content, 'definition', 'A.1'); assert.ok(result.edit, result.error);
  assert.equal(result.edit.wrapped, false); assert.equal(result.edit.markdown, content);
});

test('Windows line endings and selected surrounding blank lines remain consistent', () => {
  const content = '**定义 1.1.1** 正文\r\n\r\n第二段';
  const source = '前文\r\n\r\n' + content + '\r\n\r\n后文';
  const result = plan(source, '\r\n' + content + '\r\n'); assert.ok(result.edit, result.error);
  assert.equal(result.edit.insert.replaceAll('\r\n', '').includes('\n'), false);
  const after = source.slice(0, result.edit.from) + result.edit.insert + source.slice(result.edit.to);
  assert.ok(after.startsWith('前文\r\n\r\n> [!definition]'));
  assert.ok(after.endsWith('@#def{1.1.1}\r\n\r\n后文'));
});

test('partial lines and partially selected math, fences or metadata are refused', () => {
  const cases = [
    ['定义全文', {from:1,to:4}],
    ['$$\nx=y\n$$', {from:3,to:6}],
    ['```text\n正文\n```', {from:8,to:10}],
    ['---\ntitle: a\n---\n正文', {from:0,to:17}]
  ] as const;
  for (const [source, range] of cases) assert.ok(targetSelection(source, range).error, source);
  for (const source of ['$$\nx=y', '```text\n正文', '<!-- 未闭合']) {
    assert.ok(targetSelection(source, {from:0,to:source.length}).error, source);
  }
});

test('complete code examples remain literal inside a multi-block target', () => {
  const content = '**定义 1.1.1** 说明。\n\n```text\n@def{literal}\n\n末行\n```';
  const result = plan(content, content); assert.ok(result.edit, result.error);
  const index = indexDocument(result.edit.insert);
  assert.deepEqual(index.references.map(ref => ref.label), ['1.1.1']);
  assert.equal(index.targets[0].kind, 'definition');
});

test('duplicate numbering is refused within a kind; different kinds can share a label', () => {
  const source = '现有\n@#def{1.1.1}\n\n待标记';
  assert.match(plan(source, '待标记').error!, /已有定义/);
  assert.ok(plan(source, '待标记', 'theorem').edit);
  assert.ok(targetSelection(source, {from:0,to:2}).error);
  assert.ok(targetSelection(source, {from:0,to:source.length}).error);
});

test('type and manual label suggestions come only from the beginning of the selected content', () => {
  for (const title of ['**定义 1.1.1** 内容', '**定义 1.1.1**English content', '> [!definition] 定义 1.1.1', 'Definition (1.1.1) 内容']) {
    assert.deepEqual(inferTarget(title), {kind:'definition',label:'1.1.1'});
  }
  assert.deepEqual(inferTarget('**定理 1.13b** 内容'), {kind:'theorem',label:'1.13b'});
  assert.deepEqual(inferTarget('### Thm. A.1 条件'), {kind:'theorem',label:'A.1'});
  assert.deepEqual(inferTarget('由定义 1.1.1 可知'), {kind:'definition',label:''});
  assert.ok(plan('完整段落', '完整段落', 'definition', 'bad\nlabel').error);
});
