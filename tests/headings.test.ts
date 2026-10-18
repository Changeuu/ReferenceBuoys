import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexDocument, contextExcerpt } from '../src/core/parser';
import { parseHeadingLink } from '../src/core/headings';

test('native heading links preserve paths, aliases, hierarchy and exact source spans', () => {
  const source = '看 [[#本节]] 和 [[书本/另一篇.md#章节#小节|这部分]]。';
  const refs = indexDocument(source).headingLinks;
  assert.equal(refs.length, 2);
  assert.equal(refs[0].linkpath, '');
  assert.equal(refs[1].linkpath, '书本/另一篇.md');
  assert.equal(refs[1].label, '章节#小节');
  assert.equal(refs[1].alias, '这部分');
  assert.equal(source.slice(refs[1].from, refs[1].to), '[[书本/另一篇.md#章节#小节|这部分]]');
  for (const raw of ['[[文件]]', '[[#^block]]', '[[文件#^block|章节]]', '[[文件#]]']) assert.equal(parseHeadingLink(raw), undefined);
});

test('links in literals, embeds, escaped text, metadata and math stay native', () => {
  const source = '---\nlink: [[#yaml]]\n---\n`[[#code]]` ![[#embed]] \\[[#escape]]\n'
    + '<!-- [[#html]] --> %% [[#comment]] %%\n$$ [[#math]] $$\n```md\n[[#fence]]\n```\n[[#real]]';
  assert.deepEqual(indexDocument(source).headingLinks.map(r => r.label), ['real']);
});

test('section previews include subheadings and stop at the next equal or higher heading', () => {
  const source = '# First\nintro\n## One\nbody\n### Child\nchild\n## Two\nother\n# Next\nend';
  const index = indexDocument(source);
  assert.deepEqual(index.headings.map(h => h.label), ['First', 'One', 'Child', 'Two', 'Next']);
  assert.equal(index.headings[1].markdown, '## One\nbody\n### Child\nchild');
  assert.equal(index.headings[0].to, source.indexOf('# Next'));
  assert.equal(index.headings[1].focus.to, source.indexOf('## One') + 6);
  assert.equal(index.targets.length, 0); // Headings do not pollute numbered-reference autocomplete.
});

test('Windows setext headings, inline formatting and code/math headings retain correct bounds', () => {
  const source = 'Title\r\n=====\r\nbody\r\n## **Energy** ##\r\n$$\r\n# no\r\n$$\r\n```md\r\n# no\r\n```\r\nNext\r\n-----\r\nend';
  const headings = indexDocument(source).headings;
  assert.deepEqual(headings.map(h => [h.label, h.level]), [['Title', 1], ['**Energy**', 2], ['Next', 2]]);
  assert.equal(headings[1].from, source.indexOf('## **Energy**'));
  assert.equal(headings[1].to, source.indexOf('Next'));
  assert.equal(headings[2].line, 10);
});

test('return excerpts show wikilink aliases without raw brackets', () => {
  assert.equal(contextExcerpt('看 [[B#Energy|能量]] 与 [[#回顾]]。', 0), '看 能量 与 回顾。');
});
