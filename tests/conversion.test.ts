import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSelectedReference, suggestTemplate, defaultProfiles, loadProfiles, matchSelectedReference, modifierHeld, templateError, type ConversionProfile } from '../src/core/conversion';

const defaults = defaultProfiles()[0];
const result = (text: string, profile = defaults) => matchSelectedReference(text, profile).map(m => m.replacement);

test('equation presets convert whole selections and preserve manual sublabels', () => {
  for (const text of ['式1.13a', '式(1.13a)', '(式1.13a)', '式（1.13a）', '（式1.13a）', '公式(1.13a)', '(1.13a)', 'Eq. (1.13a)']) {
    assert.deepEqual(result(text), ['@{1.13a}'], text);
  }
  assert.deepEqual(result('Equation (A.1)'), ['@{A.1}']);
  assert.deepEqual(result('式1.1(a)'), ['@{1.1(a)}']);
});

test('spaces and full-width brackets are compatible without eating surrounding spaces', () => {
  assert.deepEqual(result(' 式 （ 1.13b ） '), [' @{1.13b} ']);
  assert.deepEqual(result('式\t(\u00a01.3\u00a0)'), ['@{1.3}']);
  assert.deepEqual(result('式(1. 3)'), []);
});

test('figure, table and addon templates use their own target kinds', () => {
  for (const [text, output] of [['图（1.3）', '@fig{1.3}'], ['Fig. 1.3', '@fig{1.3}'], ['Table 1.3', '@tab{1.3}'], ['（附A.1）', '@add{A.1}']]) {
    assert.deepEqual(result(text), [output]);
  }
});

test('definition and theorem presets convert only the selected short citation', () => {
  for (const text of ['定义 1.1.4', '定义（1.1.4）', '(定义1.1.4)', 'Definition 1.1.4', 'Def. (1.1.4)']) assert.deepEqual(result(text), ['@def{1.1.4}']);
  for (const text of ['定理 1.13a', '定理（1.13a）', '(定理1.13a)', 'Theorem 1.13a', 'Thm. (1.13a)']) assert.deepEqual(result(text), ['@thm{1.13a}']);
  assert.deepEqual(result('在定义 1.1.4 中'), []);
  assert.deepEqual(result('**定义 1.1.4** 这是内容'), []);
  assert.equal(loadProfiles([{id:'book',templates:[{kind:'definition',pattern:'定义{n}'},{kind:'theorem',pattern:'定理{n}'}]}])[0].templates.length,2);
});

test('matching is anchored: sentences, ranges, lists and multiple lines are never batch converted', () => {
  for (const text of ['', '1.3', '由式1.3可知', '式1.3、式1.4', '式(1.3), (1.4)', '式1.3\n', '式1.3\n式1.4', '式1.3—1.5', '@{1.3}']) {
    assert.deepEqual(result(text), [], text);
  }
});

test('custom templates are literal, not regular expressions', () => {
  const profile: ConversionProfile = { id: 'book', name: '书', includePresets: false, templates: [
    { kind: 'equation', pattern: '方程[{n}]' }, { kind: 'figure', pattern: 'Fig+.{n}*' }
  ] };
  assert.deepEqual(result('方程［2.13b］', profile), ['@{2.13b}']);
  assert.deepEqual(result('Fig+.2.1*', profile), ['@fig{2.1}']);
  assert.deepEqual(result('FigggX2.1', profile), []);
  assert.deepEqual(result('式1.3', profile), []);
});

test('conflicting kinds remain explicit choices while duplicate matches are deduplicated', () => {
  const profile: ConversionProfile = { ...defaults, templates: [{ kind: 'equation', pattern: '式{n}' }, { kind: 'figure', pattern: '式{n}' }] };
  assert.deepEqual(result('式1.3', profile), ['@{1.3}', '@fig{1.3}']);
});

test('invalid templates and long selections fail safely', () => {
  for (const text of ['', '式', '式{*}', '式{x}', '式{n}{x}', '式{n}\n', 'x'.repeat(201) + '{n}']) assert.ok(templateError(text), text);
  assert.equal(templateError('公式({n})'), undefined);
  assert.deepEqual(result('式' + '1'.repeat(600)), []);
  assert.deepEqual(result('式1', { ...defaults, includePresets: false, templates: [{ pattern: '(.*){n}{n}', kind: 'equation' }] }), []);
});

const custom = (pattern: string): ConversionProfile => ({ id: 'book', name: '书', includePresets: false, templates: [{ pattern, kind: 'equation' }] });
test('repeated label placeholders agree exactly, including manual sublabels and case', () => {
  const profile = custom('公式 [[#^eq-{n}|({n})]]');
  assert.equal(templateError(profile.templates[0].pattern), undefined);
  for (const label of ['1.1.4', '1.13a', 'A.1', '1.1(a)']) {
    assert.deepEqual(result(`公式 [[#^eq-${label}|(${label})]]`, profile), [`@{${label}}`]);
  }
  for (const anchor of ['1-1-4', '1.1.5', 'A.1']) {
    const trial = analyzeSelectedReference(`公式 [[#^eq-${anchor}|(1.1.4)]]`, profile);
    assert.deepEqual(trial.matches, []); assert.match(trial.error!, /不一致/);
  }
  assert.deepEqual(result('式A.1 = a.1', custom('式{n} = {n}')), []);
  assert.deepEqual(result('式1.13a = 1.13a = 1.13a', custom('式{n} = {n} = {n}')), ['@{1.13a}']);
});

test('wildcards ignore encoded wiki anchors and preserve selection boundaries', () => {
  const profile = custom('公式 [[#^eq-{*}|({n})]]');
  assert.deepEqual(result(' 公式 [[#^eq-1-1-4|(1.1.4)]] ', profile), [' @{1.1.4} ']);
  assert.deepEqual(result('公式 ［［#^eq-任意锚点|（1.13b）］］', profile), ['@{1.13b}']);
  assert.deepEqual(result('公式 [[#^eq-|(1.1.4)]]', profile), ['@{1.1.4}']);
  assert.deepEqual(result('前文公式 [[#^eq-1-1-4|(1.1.4)]]', profile), []);
  assert.deepEqual(result('公式 [[#^eq-1-1-4|(1.1.4)]]，公式 [[#^eq-1-1-5|(1.1.5)]]', profile), []);
  assert.deepEqual(result('公式 [[#^eq-1-1-4|\n(1.1.4)]]', profile), []);
  assert.deepEqual(result('prefix(first ignored: 1.2)[1.13a]suffix', custom('{*}[{n}]{*}')), ['@{1.13a}']);
});

test('ambiguous wildcard splits are rejected and pathological templates stay bounded', () => {
  const ambiguous = analyzeSelectedReference('式123', custom('式{*}{n}'));
  assert.deepEqual(ambiguous.matches, []); assert.match(ambiguous.error!, /不同编号/);
  const started = performance.now();
  const pathological = analyzeSelectedReference('a'.repeat(490), custom('{*}a'.repeat(40) + '{n}z'));
  assert.deepEqual(pathological.matches, []);
  assert.ok(performance.now() - started < 1500, 'bounded matching should not block the editor');
});

test('sample-driven templates handle wiki aliases, repeated labels and all target kinds', () => {
  assert.deepEqual(suggestTemplate('公式 [[#^eq-1-1-4|(1.1.4)]]', '1.1.4', 'equation'), { pattern: '公式 [[#^eq-{*}|({n})]]' });
  assert.deepEqual(suggestTemplate('公式 [[#^eq-1.1.4|(1.1.4)]]', '1.1.4', 'equation'), { pattern: '公式 [[#^eq-{n}|({n})]]' });
  assert.deepEqual(suggestTemplate('公式 [[#^random-anchor|(1.13a)]]', '1.13a', 'equation'), { pattern: '公式 [[#^{*}|({n})]]' });
  assert.deepEqual(suggestTemplate('方程（1.13a）', '1.13a', 'equation'), { pattern: '方程（{n}）' });
  assert.deepEqual(suggestTemplate('式1.1 = 1.1', '1.1', 'equation'), { pattern: '式{n} = {n}' });
  for (const kind of ['figure', 'table', 'addon'] as const) {
    assert.deepEqual(suggestTemplate('内容[A.1]', 'A.1', kind), { pattern: '内容[{n}]' });
  }
  for (const [sample, label] of [['式11.3', '1.3'], ['式1.13a', '1.13'], ['式1.3', '1.4'], ['式1.3\n式1.4', '1.3'], ['式{n}', '1.3'], ['式1.3', '']]) {
    assert.ok(suggestTemplate(sample, label, 'equation').error, sample);
  }
});

test('saved groups are validated and older installs receive independent defaults', () => {
  assert.deepEqual(loadProfiles(undefined), defaultProfiles());
  assert.deepEqual(loadProfiles([]), defaultProfiles());
  const groups = loadProfiles([{ id: 'a', name: 'A', includePresets: false, templates: [{ kind: 'equation', pattern: '式{n}' }, { kind: 'bad', pattern: 'X{n}' }] }, { id: 'a', name: 'duplicate' }, null]);
  assert.equal(groups.length, 1); assert.equal(groups[0].templates.length, 1); assert.equal(groups[0].includePresets, false);
  groups[0].templates[0].pattern = 'X{n}';
  assert.deepEqual(defaultProfiles()[0].templates, []);
});

test('drag modifiers require exactly the chosen key', () => {
  const event = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  assert.equal(modifierHeld({ ...event, altKey: true }, 'Alt'), true);
  assert.equal(modifierHeld({ ...event, ctrlKey: true }, 'Control'), true);
  for (const mode of ['Alt', 'Control', 'off'] as const) {
    assert.equal(modifierHeld(event, mode), false);
    assert.equal(modifierHeld({ ...event, altKey: true, ctrlKey: true }, mode), false);
    assert.equal(modifierHeld({ ...event, altKey: true, shiftKey: true }, mode), false);
  }
});
