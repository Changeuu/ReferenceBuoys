import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { focusMath } from '../src/core/math-preview';

const reproduction = readFileSync(new URL('./fixtures/multi-tag.tex', import.meta.url), 'utf8');
const chain = String.raw`\begin{align}
F(x) &= a\tag{1}\\
&= b\notag\\
&= c\tag{2}\\
&= d\notag\\
&= e\tag{3}\\
&\quad + f\notag
\end{align}`;

test('the reported final row retains its original left side and explicitly omits intermediate steps', () => {
  const result = focusMath(reproduction, '2.1.36')!;
  assert.equal(result.omittedRows, 4);
  assert.match(result.math, /\\eta_n\(\\mathbf r,t\)/);
  assert.match(result.math, /\\tag\{2\.1\.36\}/);
  assert.match(result.math, /省略 4 行/);
  assert.match(result.math, /q_n\\delta/);
  assert.doesNotMatch(result.math, /\\tag\{2\.1\.35\}/);
});

test('retain preceding unnumbered derivation rows and mark omitted following steps', () => {
  const result = focusMath(reproduction, '2.1.35')!;
  assert.match(result.math, /拆分积分/);
  assert.match(result.math, /\\quad-\\mathbf p_n/);
  assert.match(result.math, /构造傅里叶逆变换/);
  assert.equal(result.omittedRows, 2);
  assert.equal((result.math.match(/省略 1 行/g) ?? []).length, 2);
  const first = focusMath(reproduction, '2.1.34')!;
  assert.match(first.math, /\\eta_n\(\\mathbf r,t\)/);
  assert.match(first.math, /代入/);
  assert.equal(first.omittedRows, 4);
});

test('keep trailing continuations after the final tag and preserve tag stars and sublabels', () => {
  const result = focusMath(chain.replace('\\tag{3}', '\\tag*{1.13b}'), '1.13b')!;
  assert.match(result.math, /F\(x\)/);
  assert.match(result.math, /\\tag\*\{1\.13b\}/);
  assert.match(result.math, /\\quad \+ f/);
  assert.match(result.math, /省略 2 行/);
});

test('nested cases, arrays, grouped line breaks, comments and escaped ampersands stay intact', () => {
  for (const nested of [
    String.raw`\begin{cases}x & x>0\\ -x & x<0\end{cases}`,
    String.raw`\begin{aligned}x &= y\\ &=z\end{aligned}`,
    String.raw`\begin{array}{cc}x & y\\ z & w\end{array}`,
    String.raw`\substack{x\\y}`,
  ]) {
    const input = chain.replace('= e', `= ${nested} + \\text{a\\&b} + 10\\% % \\tag{fake} \\\\\n`);
    const result = focusMath(input, '3')!;
    assert.ok(result.math.includes(nested));
    assert.match(result.math, /\\text\{a\\&b\}/);
    assert.match(result.math, /10\\%/);
    assert.doesNotMatch(result.math, /fake/);
    assert.equal(result.omittedRows, 2);
  }
});

test('spacing and starred separators remain parseable; align star is supported', () => {
  const input = chain.replaceAll('{align}', '{align*}').replace('\\\\', '\\\\*[2pt]');
  assert.match(focusMath(input, '3')!.math, /\\begin\{align\*\}/);
});

test('short groups, independent left sides, duplicate tags and unsupported structures stay complete', () => {
  const unsafe = [
    String.raw`\begin{align}x&=1\tag{1}\\ &=2\tag{2}\end{align}`,
    chain.replace('&= c', 'G(x) &= c'),
    chain.replace('\\tag{2}', '\\tag{3}'),
    chain.replace('F(x)', ''),
    chain.replace('= d', '= d & + x'),
    chain.replace('= c', '= \\newcommand{\\foo}{x}c'),
    chain.replace('= c', '= \\color{red}c'),
    chain.replace('= c', '= \\left(c'),
    chain.replace('= c', '= {c'),
    chain.replaceAll('{align}', '{gather}'),
    chain.replace('= c', '= \\begin{cases}c'),
    chain.replace('= c', '\\intertext{explanation} = c'),
    `\\newcommand{\\foo}{x}${chain}`,
  ];
  for (const math of unsafe) assert.equal(focusMath(math, '3'), undefined, math);
  assert.equal(focusMath(chain, 'missing'), undefined);
});
