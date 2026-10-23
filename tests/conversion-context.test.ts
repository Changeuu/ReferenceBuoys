import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocumentSelection, suggestTemplate, type ConversionProfile } from '../src/core/conversion';
import { indexDocument } from '../src/core/parser';

const profile = (pattern: string): ConversionProfile => ({
  id: 'book', name: 'Book', includePresets: false, templates: [{ kind: 'equation', pattern }]
});
function convert(source: string, selected: string, pattern = '（${n}$）') {
  const from = source.indexOf(selected);
  assert.ok(from >= 0);
  return analyzeDocumentSelection(indexDocument(source), { from, to: from + selected.length }, profile(pattern));
}

test('complete inline math labels match explicit templates, including sublabels and Windows notes', () => {
  for (const label of ['2.1.1', '1.13a', '1.13b', 'A.1', '1.1(a)', '1-1-4']) {
    for (const selected of [`（$${label}$）`, `($ ${label} $)`]) {
      const result = convert(`前文\r\n根据${selected}可得结论。`, selected);
      assert.equal(result.matches[0]?.replacement, `@{${label}}`, selected);
    }
  }
  assert.equal(convert('根据式 $2.1.1$ 可知。', '式 $2.1.1$', '式 ${n}$').matches[0]?.replacement, '@{2.1.1}');
  assert.equal(convert('参照 $2.1.1$。', '$2.1.1$', '${n}$').matches[0]?.replacement, '@{2.1.1}');
  assert.deepEqual(suggestTemplate('（$2.1.1$）', '2.1.1', 'equation'), { pattern: '（${n}$）' });
});

test('math formatting is not silently stripped when no template matches', () => {
  assert.deepEqual(convert('（$2.1.1$）', '（$2.1.1$）', '（{n}）').matches, []);
  assert.deepEqual(convert('根据（$2.1.1$）可知。', '根据（$2.1.1$）可知。').matches, []);
});

test('code, metadata, comments and display formulas remain protected even with matching templates', () => {
  const sample = '（$2.1.1$）';
  for (const source of [
    `\`${sample}\``, `\`\`${sample}\`\``, `\`\`\`md\n${sample}\n\`\`\``, `    ${sample}`, `\t${sample}`,
    `---\nreference: ${sample}\n---\n正文`, `<!-- ${sample} -->`, `%% ${sample} %%`,
    `$$\n${sample}\n$$`, `$$ ${sample} $$`, `$$ 未闭合 ${sample}`
  ]) {
    const result = convert(source, sample);
    assert.equal(result.matches.length, 0, source);
    assert.match(result.error!, /保持原样/, source);
  }
  assert.equal(convert('（$$2.1.1$$）', '（$$2.1.1$$）', '（$${n}$$）').matches.length, 0);
});

test('partial math selections and formulas disguised by wildcards remain protected', () => {
  for (const [source, selected, pattern] of [
    ['（$2.1.1$）', '2.1.1', '{n}'],
    ['（$2.1.1$）', '（$2.1.1', '（${n}'],
    ['（$2.1.1$）', '2.1.1$）', '{n}$）'],
    ['$（2.1.1）$', '（2.1.1）', '（{n}）'],
    ['式2.1.1 $x+1$', '式2.1.1 $x+1$', '式{n} {*}'],
    ['式2.1.1 $\\tag{2.1.1}$', '式2.1.1 $\\tag{2.1.1}$', '式{n} {*}'],
    ['式2.1.1 $\\text{2.1.1}$', '式2.1.1 $\\text{2.1.1}$', '式{n} {*}']
  ]) assert.equal(convert(source, selected, pattern).matches.length, 0, source);
});

test('every inline math label must agree with the extracted label, even when ignored by a wildcard', () => {
  const pattern = '式{n}（${*}$）';
  assert.equal(convert('式2.1.1（$2.1.1$）', '式2.1.1（$2.1.1$）', pattern).matches[0]?.replacement, '@{2.1.1}');
  const conflict = convert('式2.1.1（$2.1.2$）', '式2.1.1（$2.1.2$）', pattern);
  assert.equal(conflict.matches.length, 0); assert.match(conflict.error!, /不一致/);
  assert.equal(convert('式2.1.1（$2.1.1$ = $2.1.2$）', '式2.1.1（$2.1.1$ = $2.1.2$）', '式{n}（{*}）').matches.length, 0);
  assert.equal(convert('式2.1.1（$2.1.1$）', '式2.1.1（$2.1.1$）', '式{n}（${n}$）').matches[0]?.replacement, '@{2.1.1}');
});

test('existing plugin references remain protected beside a permitted inline label', () => {
  const result = convert('（$2.1.1$）@{2.1.1}', '（$2.1.1$）@{2.1.1}', '（${n}$）{*}');
  assert.equal(result.matches.length, 0); assert.match(result.error!, /已包含标准引用/);
});
