import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FolderReferences } from '../src/folder-references';
import { indexDocument } from '../src/core/parser';
import { targetKey } from '../src/core/model';

const equation = (label: string, value = '1') => `$$ x = ${value} \\tag{${label}} $$`;
const key = (label: string) => targetKey('equation', label);

function fixture(sources: Record<string, string>) {
  const reads: string[] = [];
  const resolver = new FolderReferences(async path => {
    reads.push(path);
    return path in sources ? indexDocument(sources[path]) : undefined;
  }, () => Object.keys(sources));
  return { resolver, reads };
}

test('local labels have priority without loading siblings, including duplicate local labels', async () => {
  const { resolver, reads } = fixture({
    'Book/3.md': `${equation('1.1')}\n\n${equation('1.1', '2')}`,
    'Book/2.md': equation('1.1', '3')
  });
  const matches = await resolver.resolve('Book/3.md', key('1.1'));
  assert.equal(matches.length, 2);
  assert.ok(matches.every(match => match.path === 'Book/3.md'));
  assert.deepEqual(reads, ['Book/3.md']);
});

test('same-folder matches preserve all duplicate candidates and exclude nested, parent and unrelated notes', async () => {
  const { resolver, reads } = fixture({
    'Book/3.md': 'See @{2.1}',
    'Book/2.md': equation('2.1', '2'),
    'Book/1.md': equation('2.1'),
    'Book/appendix/4.md': equation('2.1', '4'),
    'Other/2.md': equation('2.1'),
    '2.md': equation('2.1'),
    'Book/data.txt': equation('2.1')
  });
  assert.deepEqual((await resolver.resolve('Book/3.md', key('2.1'))).map(match => match.path), ['Book/1.md', 'Book/2.md']);
  assert.deepEqual(reads, ['Book/3.md', 'Book/1.md', 'Book/2.md']);
});

test('root-level notes resolve only root-level siblings and duplicate provider entries are read once', async () => {
  const reads: string[] = [];
  const resolver = new FolderReferences(async path => {
    reads.push(path);
    return indexDocument(path === '3.md' ? '' : equation('2.1'));
  }, () => ['3.md', '2.md', '2.md', 'Folder/2.md']);
  assert.deepEqual((await resolver.resolve('3.md', key('2.1'))).map(match => match.path), ['2.md']);
  assert.deepEqual(reads, ['3.md', '2.md']);
});

test('typed targets and mixed formula labels resolve with exact kind, spelling and case', async () => {
  const { resolver } = fixture({
    'Book/3.md': '',
    'Book/2.md': [
      equation('1.1.b'), equation('1.1.52c'), equation('1.1.Gauss'),
      '![plot](plot.png)\n@#fig{1.1.b} Field plot',
      'A result\n@#thm{1.1.Gauss}'
    ].join('\n\n')
  });
  for (const label of ['1.1.b', '1.1.52c', '1.1.Gauss']) {
    const matches = await resolver.resolve('Book/3.md', key(label));
    assert.equal(matches.length, 1);
    assert.equal(matches[0].target.kind, 'equation');
    assert.equal(matches[0].target.label, label);
  }
  const figures = await resolver.resolve('Book/3.md', targetKey('figure', '1.1.b'));
  assert.equal(figures.length, 1);
  assert.equal(figures[0].target.caption, 'Field plot');
  assert.equal((await resolver.resolve('Book/3.md', targetKey('theorem', '1.1.Gauss'))).length, 1);
  assert.deepEqual(await resolver.resolve('Book/3.md', key('1.1.gauss')), []);
});

test('suggestions suppress shadowed sibling keys but retain duplicate sibling choices and other kinds', async () => {
  const { resolver } = fixture({
    'Book/3.md': equation('1.1'),
    'Book/2.md': `${equation('1.1')}\n\n${equation('2.1')}\n\n![plot](plot.png)\n@#fig{1.1}`,
    'Book/1.md': equation('2.1')
  });
  const suggestions = await resolver.suggestions('Book/3.md');
  assert.deepEqual(suggestions.filter(match => match.target.key === key('1.1')).map(match => match.path), ['Book/3.md']);
  assert.deepEqual(suggestions.filter(match => match.target.key === key('2.1')).map(match => match.path), ['Book/1.md', 'Book/2.md']);
  assert.equal(suggestions.filter(match => match.target.kind === 'figure').length, 1);
});

test('missing or unreadable siblings do not block other matches; source read failures remain visible', async () => {
  const resolver = new FolderReferences(async path => {
    if (path === 'Book/blocked.md') throw new Error('read failed');
    if (path === 'Book/gone.md') return;
    return indexDocument(path === 'Book/3.md' ? '' : equation('2.1'));
  }, () => ['Book/blocked.md', 'Book/gone.md', 'Book/2.md']);
  assert.deepEqual((await resolver.resolve('Book/3.md', key('2.1'))).map(match => match.path), ['Book/2.md']);
  await assert.rejects(() => resolver.resolve('Book/blocked.md', key('2.1')), /read failed/);
});

test('later lookups observe live edits, additions, removals and new local priority', async () => {
  const sources: Record<string, string> = { 'Book/3.md': '', 'Book/2.md': equation('2.1') };
  const { resolver } = fixture(sources);
  assert.equal((await resolver.resolve('Book/3.md', key('2.1'))).length, 1);
  sources['Book/2.md'] = equation('2.2');
  assert.deepEqual(await resolver.resolve('Book/3.md', key('2.1')), []);
  sources['Book/1.md'] = equation('2.1');
  assert.equal((await resolver.resolve('Book/3.md', key('2.1')))[0].path, 'Book/1.md');
  sources['Book/3.md'] = equation('2.1', '3');
  assert.equal((await resolver.resolve('Book/3.md', key('2.1')))[0].path, 'Book/3.md');
  delete sources['Book/1.md'];
  sources['Book/3.md'] = '';
  assert.deepEqual(await resolver.resolve('Book/3.md', key('2.1')), []);
});

test('sibling loading uses bounded parallelism and keeps deterministic path order', async () => {
  const paths = Array.from({ length: 13 }, (_, i) => `Book/${i + 1}.md`);
  let active = 0, peak = 0;
  const resolver = new FolderReferences(async path => {
    if (path === 'Book/source.md') return indexDocument('');
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return indexDocument(equation('2.1'));
  }, () => [...paths].reverse());
  const matches = await resolver.resolve('Book/source.md', key('2.1'));
  assert.equal(peak, 4);
  assert.deepEqual(matches.map(match => match.path), paths);
});
