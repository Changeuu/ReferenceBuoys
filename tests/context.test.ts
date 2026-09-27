import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexDocument } from '../src/core/parser';
import { contextAround } from '../src/core/context';

function context(source: string) {
  const index = indexDocument(source);
  return contextAround(index, index.targets.find(t => t.label === 'target')!);
}
const target = '$$ x=1 \\tag{target} $$';

test('context includes prose and adjacent complete display formulas', () => {
  const before = '已知动量\n\n$$\np=mv\n$$';
  const after = '代入得到\n\n$$\nE=p^2/(2m)\n$$';
  assert.deepEqual(context(`# 标题\n\n${before}\n\n${target}\n\n${after}\n\n更多段落`), { before, after });
});

test('blank lines inside display math remain intact', () => {
  const math = '$$\n\\begin{aligned}\na&=b\\\\\n\nc&=d\n\\end{aligned}\n$$';
  const result = context(`${math}\n\n${target}\n\n${math}`);
  assert.equal(result.before, math); assert.equal(result.after, math);
});

test('consecutive display formulas need no blank separator', () => {
  const result = context(`说明\n$$ a=b $$\n${target}\n$$ c=d $$\n所以成立`);
  assert.equal(result.before, '说明\n\n$$ a=b $$');
  assert.equal(result.after, '$$ c=d $$\n\n所以成立');
});

test('long formulas are never cut at a character budget', () => {
  const math = `$$\n${'x+'.repeat(1500)}1\n$$`;
  assert.equal(context(`${math}\n\n${target}`).before, math);
});

test('context stays inside its section and handles the start and end of a note', () => {
  assert.deepEqual(context(`旧内容\n\n# 当前章节\n${target}\n# 下一节\n\n新内容`), { before: '', after: '' });
  assert.deepEqual(context(target), { before: '', after: '' });
});

test('Windows line endings and fenced blocks retain complete contents', () => {
  const code = '```tex\r\na=b\r\n\r\nc=d\r\n```';
  const math = '$$\r\na=b\r\n\r\nc=d\r\n$$';
  assert.deepEqual(context(`${code}\r\n\r\n${target}\r\n\r\n${math}`), { before: code, after: math });
});

test('an unfinished display formula is not fed to the context renderer', () => {
  assert.equal(context(`${target}\n\n所以\n\n$$\nx=`).after, '所以');
});
