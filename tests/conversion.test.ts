import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfiles, loadProfiles, matchSelectedReference, modifierHeld, templateError, type ConversionProfile } from '../src/core/conversion';

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
  for (const text of ['', '式', '式{n}{n}', '式{x}', '式{n}\n', 'x'.repeat(201) + '{n}']) assert.ok(templateError(text), text);
  assert.equal(templateError('公式({n})'), undefined);
  assert.deepEqual(result('式' + '1'.repeat(600)), []);
  assert.deepEqual(result('式1', { ...defaults, includePresets: false, templates: [{ pattern: '(.*){n}{n}', kind: 'equation' }] }), []);
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
