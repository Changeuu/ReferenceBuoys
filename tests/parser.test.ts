import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextExcerpt, indexDocument, parseReference } from '../src/core/parser';
import { referenceSource, targetKey } from '../src/core/model';

test('manual sublabels are exact and never renumbered', () => {
  const source = '# 能量\n\n$$ E=mc^2 \\tag{1.13a} $$\n\n$$ F=ma \\tag{1.13b} $$\n\n代入 @{1.13a} 和 @{1.13b}。';
  const index = indexDocument(source);
  assert.deepEqual(index.targets.map(t => t.label), ['1.13a', '1.13b']);
  assert.equal(index.byKey.get(targetKey('equation', '1.13'))?.length ?? 0, 0);
  assert.equal(index.references.length, 2);
  assert.equal(index.targets[0].heading, '能量');
  assert.equal(index.source, source);
});
test('multi-tag align keeps the whole block and identifies each source row', () => {
  const source = '$$\n\\begin{align}\na&=b \\tag{1.13a}\\\\\nc&=d \\tag{1.13b}\n\\end{align}\n$$';
  const index = indexDocument(source);
  assert.equal(index.targets.length, 2);
  assert.equal(index.targets[1].tagCount, 2);
  assert.equal(index.targets[1].tagIndex, 1);
  assert.equal(index.targets[0].markdown, index.targets[1].markdown);
  assert.match(source.slice(index.targets[1].focus.from, index.targets[1].focus.to), /c&=d/);
});
test('only complete tag commands count; comments, escaped tags and nested TeX labels do not', () => {
  const index = indexDocument('$$\nx=1 % \\tag{bad}\n\\\\tag{escaped}\ny=2 \\tag*{A.1}\nz=3 \\tag{\\text{weird}}\n$$');
  assert.deepEqual(index.targets.map(t => t.label), ['A.1']);
});
test('code fences, inline code, YAML and comments remain literal', () => {
  const source = ['---', 'example: "@{1}"', '---', '```md', '$$ a \\tag{fake} $$', '@{fake}', '```',
    '``a ` @{1}` b``', '<!-- @{1} -->', '%% @{1} %%', '    @{1}', '\\@{1}', '@{real}'].join('\n');
  const index = indexDocument(source);
  assert.equal(index.targets.length, 0);
  assert.deepEqual(index.references.map(r => r.label), ['real']);
});
test('same numbers for formulas, figures and tables remain separate', () => {
  const index = indexDocument('$$ a \\tag{1.3} $$\n\n![[field.png]]\n\n@{#图1.3} 场线\n\n| A | B |\n| --- | :---: |\n| 1 | 2 |\n\n@{#表1.3} 参数\n\n@{1.3} @{图1.3} @{表1.3}');
  assert.equal(index.targets.length, 3);
  assert.deepEqual(index.targets.map(t => t.kind), ['equation', 'figure', 'table']);
  assert.equal(index.byKey.get(targetKey('figure', '1.3'))?.[0].caption, '场线');
  assert.match(index.byKey.get(targetKey('table', '1.3'))![0].markdown, /\| 1 \| 2 \|/);
});
test('standard Markdown images and tables without outer pipes work', () => {
  const index = indexDocument('![图](assets/field.png)\n@{#图2.4b}\n\nA | B\n--- | ---\n1 | 2\n@{#表2.4b} 参数');
  assert.equal(index.targets.length, 2);
  assert.deepEqual(index.targets.map(t => t.label), ['2.4b', '2.4b']);
});
test('caption labels never guess across unrelated prose', () => {
  const index = indexDocument('![[x.png]]\n\n这里是别的正文。\n@{#图1}\n\nnot a table\n@{#表1}');
  assert.equal(index.targets.length, 0);
  assert.equal(index.references.length, 2);
});
test('duplicate numbers remain explicit candidates', () => {
  const index = indexDocument('$$ a \\tag{1} $$\n\n$$ b \\tag{1} $$\n\n@{1}');
  assert.equal(index.byKey.get(targetKey('equation', '1'))?.length, 2);
});
test('unclosed display math does not create accidental references', () => {
  const index = indexDocument('$$\n\\text{@{1}}\n');
  assert.equal(index.references.length, 0);
  assert.equal(index.targets.length, 0);
});
test('references in complete math and image paths are not replaced', () => {
  const index = indexDocument('$\\text{@{1}}$\n\n![@{1}](x.png)\n\n![x](file@{1}.png)\n\n@{1}');
  assert.equal(index.references.length, 1);
});
test('reference grammar keeps source offsets and accepts sublabels', () => {
  assert.deepEqual(parseReference('@{图1.13a}', 12), { from: 12, to: 21, label: '1.13a', kind: 'figure', key: targetKey('figure', '1.13a'), definition: false });
  assert.equal(parseReference('@{}'), undefined);
  assert.equal(parseReference('@{#1.3}'), undefined);
});
test('CRLF Windows notes retain accurate offsets', () => {
  const source = '# 标题\r\n\r\n$$\r\nx=1 \\tag{2.1}\r\n$$\r\n\r\n引用 @{2.1}';
  const index = indexDocument(source);
  assert.equal(index.targets.length, 1);
  assert.equal(source.slice(index.references[0].from, index.references[0].to), '@{2.1}');
});
test('indented TeX inside a display block remains math, including the closing delimiter', () => {
  const index = indexDocument('$$\n    E=mc^2 \\tag{1.13a}\n    $$\n\n@{1.13a}');
  assert.equal(index.targets.length, 1);
  assert.equal(index.references.length, 1);
});

test('English figure and table syntax supports sublabels and exact source spans', () => {
  const source = '![[field.png]]\n@#fig{1.13a} 场线\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n@#tab{1.13b} 参数\n\n看 @fig{1.13a} 和 @tab{1.13b}。';
  const index = indexDocument(source);
  assert.deepEqual(index.targets.map(t => [t.kind, t.label]), [['figure', '1.13a'], ['table', '1.13b']]);
  assert.deepEqual(index.references.map(r => source.slice(r.from, r.to)), ['@#fig{1.13a}', '@#tab{1.13b}', '@fig{1.13a}', '@tab{1.13b}']);
  assert.equal(contextExcerpt(source, source.indexOf('看')), '看 图 1.13a 和 表 1.13b。');
  for (const ref of index.references.filter(r => !r.definition)) {
    assert.equal(referenceSource(ref), source.slice(ref.from, ref.to));
    assert.equal(index.byKey.get(ref.key)?.length, 1);
  }
  assert.equal(referenceSource({ kind: 'equation', label: '1.13a' }), '@{1.13a}');
});

test('new syntax stays literal in code, math, comments, escaped text and destinations', () => {
  const source = '`@fig{1}`\n```md\n@#fig{1}\n```\n<!-- @tab{1} -->\n\\@tab{1}\n$$\\text{@fig{1}}$$\n![x](file@fig{1}.png)\n@fig{real}';
  assert.deepEqual(indexDocument(source).references.map(r => r.label), ['real']);
  for (const raw of ['@fig{}', '@tab{}', '@#fig{}', '@#tab{}', '@#{}', '@fig{#1}', '@fig{a\nb}', '@sheet{1}']) {
    assert.equal(parseReference(raw), undefined, raw);
  }
});

test('old Chinese tokens still resolve to new definitions and vice versa', () => {
  const index = indexDocument('![[a.png]]\n@#fig{1}\n\n![[b.png]]\n@{#图2}\n\n@{图1} @fig{2}');
  for (const ref of index.references.filter(r => !r.definition)) assert.equal(index.byKey.get(ref.key)?.length, 1);
});

test('add labels paragraphs, quotes, lists, tables, images, full code and full math blocks', () => {
  const blocks = [
    '这是含 $m$ 的一段说明。\n下一行也属于本段。',
    '> [!note] 适用条件\n> 第一段\n>\n> 第二段',
    '- 第一项\n- 第二项\n  - 子项',
    '| A | B |\n| --- | --- |\n| 1 | 2 |',
    '![[example.png]]',
    '```js\nconst text = "@add{literal}";\n\nconsole.log(text);\n```',
    '$$\n\\begin{aligned}\na&=b\\\\\n\nc&=d\n\\end{aligned}\n$$'
  ];
  for (const block of blocks) {
    const source = `# 标题\n\n更早的段落\n\n${block}\n\n@#add{1.3a} 补充说明\n\n见 @add{1.3a}`;
    const index = indexDocument(source);
    const target = index.byKey.get(targetKey('addon', '1.3a'))?.[0];
    assert.ok(target, block);
    assert.equal(target.markdown, block);
    assert.equal(source.slice(target.focus.from, target.focus.to), block);
    assert.equal(target.caption, '补充说明');
    assert.equal(index.references.length, 2);
    assert.equal(referenceSource(target), '@add{1.3a}');
  }
});

test('add resolves an independent namespace and never labels a preceding marker or hidden metadata', () => {
  const index = indexDocument('$$ x=1 \\tag{1} $$\n\n说明\n@#add{1}\n@#add{2}\n\n@add{1} @{1}');
  assert.equal(index.byKey.get(targetKey('addon', '1'))?.length, 1);
  assert.equal(index.byKey.get(targetKey('equation', '1'))?.length, 1);
  assert.equal(index.byKey.has(targetKey('addon', '2')), false);
  for (const source of ['@#add{1}', '<!-- hidden -->\n@#add{1}', '---\ntitle: note\n---\n@#add{1}']) {
    assert.equal(indexDocument(source).targets.length, 0);
  }
});

test('add keeps adjacent display blocks separate from a following paragraph', () => {
  const source = '$$ a=b $$\n说明\n@#add{1}';
  assert.equal(indexDocument(source).targets[0].markdown, '说明');
});

test('buoy summaries show readable text without markup or input tokens', () => {
  assert.equal(contextExcerpt('**先试试：** 查看 @fig{1.3} 和 @add{A.1}', 0), '先试试： 查看 图 1.3 和 附 A.1');
});
