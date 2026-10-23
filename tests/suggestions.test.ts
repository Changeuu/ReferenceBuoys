import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexDocument } from '../src/core/parser';
import { referenceSuggestions } from '../src/core/suggestions';

const formulas = (labels: string[]) => labels.map(label => `$$ x = 1 \\tag{${label}} $$`).join('\n\n');
const numbers = Array.from({ length: 40 }, (_, i) => `1.${i + 1}`);
const userLabels = ['1.1.b', '1.1.52c', '1.1.Gauss'];

test('letter and named sublabels after many numeric formulas are discoverable from a short prefix', () => {
  const index = indexDocument(formulas([...numbers, ...userLabels]));
  const originalOrder = index.targets.map(t => t.label);
  const matches = referenceSuggestions(index.targets, '1.');
  assert.equal(matches.length, 43);
  assert.deepEqual(matches.slice(0, 5).map(t => t.label), ['1.1', '1.1.52c', '1.1.b', '1.1.Gauss', '1.2']);
  assert.deepEqual(index.targets.map(t => t.label), originalOrder);
});

test('all matching labels remain available beyond both the old limit and 100 items', () => {
  const index = indexDocument(formulas([...Array.from({ length: 160 }, (_, i) => `1.1.${i}`), ...userLabels]));
  const matches = referenceSuggestions(index.targets, '1.1.');
  assert.equal(matches.length, 163);
  for (const label of userLabels) assert.ok(matches.some(t => t.label === label));
});

test('exact labels and prefixes beat substring and full-formula matches, including sibling tags', () => {
  const index = indexDocument([
    ...Array.from({ length: 16 }, (_, i) => `$$ x=\\text{uses 1.1.Gauss}\\tag{9.${i}} $$`),
    String.raw`$$\begin{align}x&=1\tag{1.1.Gauss}\\y&=2\tag{other}\end{align}$$`,
    formulas(['1.1.Gauss.a', '21.1.Gauss']),
  ].join('\n\n'));
  const matches = referenceSuggestions(index.targets, '1.1.Gauss');
  assert.deepEqual(matches.slice(0, 3).map(t => t.label), ['1.1.Gauss', '1.1.Gauss.a', '21.1.Gauss']);
  assert.ok(matches.some(t => t.label === 'other')); // Content search still works.
});

test('case-insensitive searches retain the exact label and prefer a case-sensitive exact match', () => {
  const index = indexDocument(formulas(['1.1.gauss', '1.1.Gauss', '1.1.GAUSS']));
  assert.equal(referenceSuggestions(index.targets, ' 1.1.Gauss ')[0].label, '1.1.Gauss');
  assert.deepEqual(referenceSuggestions(index.targets, 'GAUSS').map(t => t.label), ['1.1.gauss', '1.1.Gauss', '1.1.GAUSS']);
});

test('natural ordering keeps numeric sections intuitive and typed references keep their kind', () => {
  const index = indexDocument(`${formulas(['1.10', '1.2', '1.52c'])}\n\n![figure](figure.png)\n@#fig{1.1.b}\n\nDetails\n@#add{1.1.Gauss}`);
  assert.deepEqual(referenceSuggestions(index.targets, '1.', 'equation').map(t => t.label), ['1.2', '1.10', '1.52c']);
  assert.deepEqual(referenceSuggestions(index.targets, '1.', 'figure').map(t => t.label), ['1.1.b']);
  assert.deepEqual(referenceSuggestions(index.targets, 'gauss', 'addon').map(t => t.label), ['1.1.Gauss']);
  assert.deepEqual(referenceSuggestions(index.targets, 'missing'), []);
});
