import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});
test('real MathJax hover, pointer transfer, pinning, multiple windows and Escape', async ({ page }) => {
  const a = page.locator('.reflo-reference').filter({ hasText: '1.13a' }).first();
  await expect(a).not.toHaveAttribute('title');
  await expect(a).not.toHaveAttribute('aria-label');
  await a.hover();
  const popup = page.locator('.reflo-preview');
  await expect(popup).toHaveCount(1); await expect(popup.locator('mjx-container')).toHaveCount(1);
  await expect(popup.locator('.reflo-preview-kind')).toHaveCount(0);
  await expect(popup.locator('.reflo-preview-hint')).toHaveCount(0);
  await popup.locator('.reflo-preview-header').hover();
  await page.waitForTimeout(450); await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: '固定此预览，留在旁边对照', exact: true }).click();
  await expect(page.locator('.reflo-preview.is-pinned')).toHaveCount(1);
  await page.locator('.reflo-reference').filter({ hasText: '1.13b' }).first().hover();
  await expect(popup).toHaveCount(2);
  await page.keyboard.press('Escape'); await expect(popup).toHaveCount(1);
  await expect(popup.locator('.reflo-preview-identity strong')).toHaveText('式 1.13a');
  expect(await page.evaluate(() => window.lab.plugin.points.size)).toBe(0);
  await page.screenshot({ path: '.qa/preview-light.png', animations: 'disabled' });
});
test('jump, stacked buoys, precise return and anchors after insertion', async ({ page }) => {
  const a = page.locator('.reflo-reference').filter({ hasText: '1.13a' }).first();
  const before = await page.evaluate(() => window.lab.cm.scrollDOM.scrollTop);
  await a.click(); await expect(page.locator('.reflo-buoy')).toHaveCount(1);
  await page.evaluate(async () => {
    const { plugin, cm, file } = window.lab; const index = await window.lab.index();
    const ref = index.references.find((r: any) => r.label === '1.13b' && !r.definition);
    await plugin.jump(index.targets.find((t: any) => t.label === '1.13b'), { path: file.path, from: ref.from, to: ref.to, cm });
  });
  await expect(page.locator('.reflo-buoy')).toHaveCount(2);
  await page.screenshot({ path: '.qa/buoys-light.png', animations: 'disabled' });
  const position = await page.evaluate(() => {
    const { plugin, file } = window.lab; const point = plugin.points.get(file.path)[0]; const old = point.from;
    window.lab.replace(0, 0, '新增段落\n\n'); return { old, now: point.from };
  });
  expect(position.now - position.old).toBe(6);
  await page.locator('.reflo-buoy-go').last().click();
  await page.waitForTimeout(250);
  await expect(page.locator('.reflo-buoy')).toHaveCount(1);
  expect(await page.evaluate(() => window.lab.plugin.points.get(window.lab.file.path).map((p: any) => p.id))).toEqual([2]);
  await page.getByRole('button', { name: '移除浮标 2', exact: true }).click();
  await expect(page.locator('.reflo-buoys')).toBeHidden();
});
test('image, table and selected row in a full multi-tag equation', async ({ page }) => {
  for (const label of ['图1.3', '表1.3', '2.1b']) {
    await page.evaluate(async label => {
      const index = await window.lab.index(); const key = label.startsWith('图') ? 'figure\u00001.3' : label.startsWith('表') ? 'table\u00001.3' : 'equation\u00002.1b';
      const ref = index.references.find((r: any) => r.key === key && !r.definition);
      await window.lab.plugin.previews.open(document.querySelector('.reflo-reference'), ref, { path: window.lab.file.path, from: ref.from, to: ref.to, cm: window.lab.cm });
    }, label);
    const popup = page.locator('.reflo-preview'); await expect(popup).toHaveCount(1);
    if (label.startsWith('图')) { await expect(popup.locator('img')).toBeVisible(); expect(await popup.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0); }
    else if (label.startsWith('表')) await expect(popup.locator('tbody tr')).toHaveCount(4);
    else {
      await expect(popup.locator('mjx-merror')).toHaveCount(0);
      await expect(popup.locator('.reflo-math-focus').first()).toBeVisible();
      await expect(popup.locator('mjx-assistive-mml')).toContainText('2.1a'); await expect(popup.locator('mjx-assistive-mml')).toContainText('2.1c');
      await expect(popup.locator('mjx-table > mjx-itable > .reflo-math-focus')).toHaveCount(1);
      await page.screenshot({ path: '.qa/multi-equation.png' });
    }
    await popup.getByRole('button', { name: '关闭预览', exact: true }).click();
  }
});
test('missing targets and duplicate numbers never silently jump', async ({ page }) => {
  await page.evaluate(() => window.lab.replace(window.lab.cm.state.doc.length, window.lab.cm.state.doc.length, '\n\n$$ z=1 \\tag{1.13a} $$\n\n@{missing}\n'));
  await page.locator('.reflo-reference').filter({ hasText: '1.13a' }).first().click();
  await expect(page.locator('.reflo-candidate')).toHaveCount(2);
  expect(await page.evaluate(() => window.lab.plugin.points.size)).toBe(0);
  await page.locator('.reflo-candidate').first().click();
  await expect(page.locator('.reflo-preview mjx-container')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const index = await window.lab.index(); const ref = index.references.find((r: any) => r.label === 'missing');
    await window.lab.plugin.previews.open(document.querySelector('.reflo-reference'), ref, { path: window.lab.file.path, from: ref.from, to: ref.to });
  });
  await expect(page.locator('.reflo-preview')).toContainText('未找到这个编号');
});
test('macro caret completion replaces its existing closing brace exactly once', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { cm, suggest, view, file } = window.lab;
    const start = cm.state.doc.length;
    window.lab.replace(start, start, '\n\n@{1.13}');
    const line = cm.state.doc.lines - 1;
    const trigger = suggest.onTrigger({ line, ch: 6 }, view.editor, file);
    suggest.context = { ...trigger, editor: view.editor, file };
    const target = (await window.lab.index()).targets.find((t: any) => t.label === '1.13a');
    suggest.selectSuggestion(target);
    return cm.state.doc.line(cm.state.doc.lines).text;
  });
  expect(result).toBe('@{1.13a}');
});
test('keyboard access exposes the exact source; unloading removes temporary UI', async ({ page }) => {
  await page.locator('.reflo-reference').filter({ hasText: '1.13a' }).first().hover();
  await expect(page.locator('.reflo-preview')).toHaveCount(1);
  await page.evaluate(() => { window.lab.plugin.onunload(); window.lab.plugin.unload(); });
  await expect(page.locator('.reflo-preview,.reflo-buoys')).toHaveCount(0);
  const saved = await page.evaluate(() => (window as any).savedData);
  expect(saved).toBeUndefined();
});

test('a distant reference returns to the original viewport and cursor', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { plugin, cm, file, view, EditorView } = window.lab;
    const index = await window.lab.index(); const ref = index.references.filter((r: any) => r.label === '1.14' && !r.definition).at(-1);
    cm.dispatch({ selection: { anchor: ref.from - 2 }, effects: EditorView.scrollIntoView(ref.from, { y: 'center' }) });
    await new Promise(r => setTimeout(r, 200));
    const before = cm.scrollDOM.scrollTop, cursor = cm.state.selection.main.head;
    const beforeY = cm.coordsAtPos(ref.from)?.top;
    await plugin.jump(index.targets.find((t: any) => t.label === '1.14'), { path: file.path, from: ref.from, to: ref.to, cm });
    await new Promise(r => setTimeout(r, 150));
    const jumped = cm.scrollDOM.scrollTop;
    await plugin.returnTo(plugin.points.get(file.path)[0], view);
    await new Promise(r => setTimeout(r, 260));
    return { before, jumped, cursor, restoredCursor: cm.state.selection.main.head,
      beforeY, afterY: cm.coordsAtPos(ref.from)?.top };
  });
  expect(Math.abs(result.before - result.jumped)).toBeGreaterThan(500);
  // CM can refine estimated heights outside the viewport. Compare the visible
  // reading position, not scrollTop, which changes when those estimates change.
  expect(result.beforeY).toBeDefined(); expect(result.afterY).toBeDefined();
  expect(Math.abs(result.beforeY! - result.afterY!), JSON.stringify(result)).toBeLessThan(4);
  expect(result.restoredCursor).toBe(result.cursor);
});

test('pinned previews update after edits and can be dragged without losing other cards', async ({ page }) => {
  await page.locator('.reflo-reference').filter({ hasText: '1.13a' }).first().hover();
  const popup = page.locator('.reflo-preview');
  await popup.getByRole('button', { name: '固定此预览，留在旁边对照', exact: true }).click();
  const before = await popup.boundingBox();
  const header = await popup.locator('.reflo-preview-identity').boundingBox();
  await page.mouse.move(header!.x + 20, header!.y + 20); await page.mouse.down();
  await page.mouse.move(header!.x + 160, header!.y + 90, { steps: 8 }); await page.mouse.up();
  const after = await popup.boundingBox(); expect(after!.x - before!.x).toBeGreaterThan(100);
  await page.evaluate(() => { const source = window.lab.cm.state.doc.toString(); const at = source.indexOf('p = mv'); window.lab.replace(at, at + 6, 'p = 2mv'); });
  await expect(popup.locator('mjx-assistive-mml')).toContainText('2');
  await page.evaluate(() => {
    const vars = { '--background-primary': '#202825', '--background-secondary': '#2b3631', '--background-modifier-border': '#3d4b43', '--background-modifier-hover': '#34473d', '--text-normal': '#e1ebe5', '--text-muted': '#a0b1a5', '--text-faint': '#82998b', '--text-accent': '#8dc4ab', '--interactive-accent': '#8dc4ab' };
    for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(key, value);
  });
  await page.screenshot({ path: '.qa/preview-dark.png', animations: 'disabled' });
});

test('expanded context renders neighboring display formulas and remains collapsible', async ({ page }) => {
  await page.locator('.reflo-reference').filter({ hasText: '1.13b' }).first().hover();
  const popup = page.locator('.reflo-preview');
  await popup.getByRole('button', { name: '展开上下文' }).click();
  const context = popup.locator('.reflo-preview-context');
  await expect(context).toBeVisible();
  await expect(context.locator('mjx-container[display="true"]')).toHaveCount(2);
  await expect(context.locator('mjx-container[display="true"] mjx-assistive-mml').first()).toContainText('1.13a');
  await expect(context.locator('mjx-container[display="true"] mjx-assistive-mml').last()).toContainText('1.14');
  await expect(context.locator('mjx-merror')).toHaveCount(0);
  expect((await context.boundingBox())!.height).toBeGreaterThan(80);
  await popup.screenshot({ path: '.qa/context-light.png', animations: 'disabled' });
  await popup.getByRole('button', { name: '收起上下文' }).click();
  await expect(context).toBeHidden();
});

test('English macro completion filters kinds and shift-click edits only the label', async ({ page }) => {
  for (const [prefix, kind] of [['fig', 'figure'], ['tab', 'table'], ['add', 'addon']]) {
    const result = await page.evaluate(async ({ prefix, kind }) => {
      const { cm, suggest, view, file } = window.lab;
      window.lab.replace(cm.state.doc.length, cm.state.doc.length, `\n\n@${prefix}{1.}`);
      const trigger = suggest.onTrigger({ line: cm.state.doc.lines - 1, ch: 7 }, view.editor, file);
      const context = { ...trigger, editor: view.editor, file };
      const suggestions = suggest.getSuggestions(context);
      suggest.context = context;
      suggest.selectSuggestion(suggestions[0]);
      return { source: cm.state.doc.line(cm.state.doc.lines).text, kinds: suggestions.map((t: any) => t.kind) };
    }, { prefix, kind });
    expect(result.source).toBe(`@${prefix}{1.3}`);
    expect(result.kinds.length).toBeGreaterThan(0);
    expect(result.kinds.every((value: string) => value === kind)).toBe(true);
  }
  await page.locator('.reflo-reference').filter({ hasText: '图 1.3' }).first().click({ modifiers: ['Shift'] });
  expect(await page.evaluate(() => {
    const { cm } = window.lab; return cm.state.sliceDoc(cm.state.selection.main.from, cm.state.selection.main.to);
  })).toBe('1.3');
});

test('reading mode recognizes English references and definition commands place the caret inside braces', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { plugin, view, cm, file } = window.lab;
    const el = document.createElement('div');
    el.textContent = '@fig{1.3} @tab{1.3} @add{1.3} @#fig{1.3} @#tab{1.3} @#add{1.3}';
    await plugin.processors[0](el, { sourcePath: file.path, getSectionInfo: () => null });
    const commands = [];
    for (const id of ['insert-figure-label', 'insert-table-label', 'insert-addon-label']) {
      window.lab.replace(cm.state.doc.length, cm.state.doc.length, '\n');
      cm.dispatch({ selection: { anchor: cm.state.doc.length } });
      plugin.commands.find((c: any) => c.id === id).editorCallback(view.editor);
      commands.push({ text: cm.state.doc.line(cm.state.doc.lines).text, cursor: view.editor.getCursor().ch });
    }
    return { refs: [...el.querySelectorAll('button')].map(node => node.textContent), captions: [...el.querySelectorAll('.reflo-caption-label')].map(node => node.textContent), commands, tooltips: el.querySelectorAll('[aria-label],[title]').length };
  });
  expect(result.refs).toEqual(['（图 1.3）', '（表 1.3）', '（附 1.3）']);
  expect(result.captions).toEqual(['图 1.3', '表 1.3', '附 1.3']);
  expect(result.commands).toEqual([{ text: '@#fig{}', cursor: 6 }, { text: '@#tab{}', cursor: 6 }, { text: '@#add{}', cursor: 6 }]);
  expect(result.tooltips).toBe(0);
});

test('return command consumes the newest buoy; a failed return keeps its buoy', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { plugin, cm, file, view } = window.lab;
    const index = await window.lab.index();
    const ref = index.references.find((r: any) => r.label === '1.13a');
    for (let i = 0; i < 2; i++) await plugin.jump(index.targets[0], { path: file.path, from: ref.from, to: ref.to, cm });
    const findFile = plugin.app.vault.getAbstractFileByPath;
    plugin.app.vault.getAbstractFileByPath = () => null;
    await plugin.returnTo(plugin.points.get(file.path)[0], view);
    const failedIds = plugin.points.get(file.path).map((p: any) => p.id);
    plugin.app.vault.getAbstractFileByPath = findFile;
    const command = plugin.commands.find((c: any) => c.id === 'return-to-buoy');
    command.checkCallback(false);
    const remainingIds = plugin.points.get(file.path).map((p: any) => p.id);
    command.checkCallback(false);
    return { failedIds, remainingIds, available: command.checkCallback(true), count: plugin.points.size };
  });
  expect(result).toEqual({ failedIds: [1, 2], remainingIds: [1], available: false, count: 0 });
});

test('generic add previews a full quote or code block, pins, jumps and returns', async ({ page }) => {
  await page.evaluate(async () => {
    const index = await window.lab.index();
    const ref = index.references.find((r: any) => r.kind === 'addon' && !r.definition);
    await window.lab.plugin.previews.open(document.querySelector('.reflo-reference'), ref, { path: window.lab.file.path, from: ref.from, to: ref.to, cm: window.lab.cm });
  });
  const popup = page.locator('.reflo-preview');
  await expect(popup.locator('.reflo-preview-identity strong')).toHaveText('附 1.3');
  await expect(popup.locator('blockquote')).toContainText('适用条件');
  await expect(popup.locator('blockquote')).toContainText('单位必须一致');
  await popup.getByRole('button', { name: '固定此预览，留在旁边对照', exact: true }).click();
  await popup.getByRole('button', { name: '跳到原文并留下返回浮标', exact: true }).click();
  await expect(page.locator('.reflo-buoy')).toHaveCount(1);
  await page.locator('.reflo-buoy-go').click();
  await expect(page.locator('.reflo-buoys')).toBeHidden();
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: '关闭预览', exact: true }).click();
  await page.evaluate(async () => {
    const { cm, file, plugin } = window.lab;
    window.lab.replace(cm.state.doc.length, cm.state.doc.length, '\n\n```js\nconst x = 1;\n\nconsole.log(x);\n```\n@#add{code}\n\n@add{code}');
    const index = await window.lab.index(); const ref = index.references.find((r: any) => r.label === 'code' && !r.definition);
    await plugin.previews.open(document.querySelector('.reflo-reference'), ref, { path: file.path, from: ref.from, to: ref.to, cm });
  });
  await expect(popup.locator('pre code')).toHaveText('const x = 1;\n\nconsole.log(x);\n');
});
