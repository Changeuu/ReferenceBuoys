import { test, expect, type Page } from '@playwright/test';

const sourcePath = 'Physics/第三章.md';
const equationPath = 'Physics/第二章.md';

async function seed(page: Page) {
  await page.evaluate(async () => {
    window.lab.addFile('Physics/第三章.md', '# 第三章\n\n由 @{2.1.Gauss} 和 @fig{2.1} 得到结果。\n\n@{duplicate} @{outside}');
    window.lab.addFile('Physics/第二章.md', '# 第二章\n\n公式前文\n\n$$ E=mc^2 \\tag{2.1.Gauss} $$\n\n公式后文\n\n![示意图](diagram.png)\n@#fig{2.1} 第二章图片说明');
    // Same heading and source offsets in two notes exercise path-aware choices.
    window.lab.addFile('Physics/第一章.md', '# 目标\n\n$$a=1\\tag{duplicate}$$');
    window.lab.addFile('Physics/附录.md', '# 目标\n\n$$b=2\\tag{duplicate}$$');
    window.lab.addFile('Physics/sub/补充.md', '$$x=3\\tag{outside}$$');
    window.lab.addFile('Other/第二章.md', '$$y=4\\tag{outside}$$');
    await window.lab.openFile('Physics/第三章.md');
  });
}

const reference = (page: Page, text: string) => page.locator('.reflo-reference:visible').filter({ hasText: text }).first();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await seed(page);
});

test('sibling equations and figures preview with destination context and image base path', async ({ page }) => {
  await reference(page, '2.1.Gauss').hover();
  const popup = page.locator('.reflo-preview');
  await expect(popup.locator('mjx-container')).toHaveCount(1);
  await expect(popup.locator('mjx-merror')).toHaveCount(0);
  await expect(popup.locator('.reflo-preview-location')).toContainText('第二章');
  await popup.getByRole('button', { name: '展开上下文', exact: true }).click();
  await expect(popup.locator('.reflo-preview-context')).toContainText('公式前文');
  await expect(popup.locator('.reflo-preview-context')).toContainText('公式后文');
  await expect(popup.locator('.reflo-preview-context [data-render-path]').first()).toHaveAttribute('data-render-path', equationPath);
  await popup.getByRole('button', { name: '关闭预览', exact: true }).click();
  await reference(page, '图 2.1').hover();
  await expect(popup.locator('.reflo-preview-body')).toHaveAttribute('data-render-path', equationPath);
  await expect(popup.locator('img')).toHaveAttribute('src', 'diagram.png');
  await expect(popup).toContainText('第二章图片说明');
  expect(await page.evaluate(() => window.lab.cm.state.doc.toString())).toContain('@fig{2.1}');
});

test('cross-note formula click opens a new tab and return restores the source tab once', async ({ page }) => {
  const original = await page.evaluate(() => ({ source: window.lab.cm.state.doc.toString(), cursor: window.lab.cm.state.selection.main.head }));
  await reference(page, '2.1.Gauss').click();
  await expect.poll(() => page.evaluate(() => window.lab.app.workspace.getActiveFile().path)).toBe(equationPath);
  expect(await page.evaluate(() => window.lab.view.file.path)).toBe(sourcePath);
  expect(await page.evaluate(() => window.lab.leaves.map((leaf: any) => leaf.view.file.path))).toEqual([sourcePath, equationPath]);
  expect(await page.evaluate(() => ({ source: window.lab.cm.state.doc.toString(), cursor: window.lab.cm.state.selection.main.head }))).toEqual(original);
  await page.locator('.reflo-buoy-go:visible').click();
  await expect.poll(() => page.evaluate(() => window.lab.app.workspace.getActiveFile().path)).toBe(sourcePath);
  expect(await page.evaluate(() => window.lab.plugin.returnPoints().length)).toBe(0);
});

test('same-file targets win and sibling lookup never enters subfolders or another folder', async ({ page }) => {
  await page.evaluate(() => window.lab.replace(window.lab.cm.state.doc.length, window.lab.cm.state.doc.length,
    '\n\n本篇公式\n\n$$ z=9 \\tag{2.1.Gauss} $$'));
  const paths = await page.evaluate(async () => {
    const path = window.lab.view.file.path;
    return {
      local: (await window.lab.plugin.referenceTargets(path, 'equation\u00002.1.Gauss')).map((c: any) => c.path),
      excluded: await window.lab.plugin.referenceTargets(path, 'equation\u0000outside'),
    };
  });
  expect(paths).toEqual({ local: [sourcePath], excluded: [] });
  await reference(page, 'outside').click();
  await expect(page.locator('.reflo-preview')).toContainText('未找到这个编号');
  expect(await page.evaluate(() => window.lab.plugin.returnPoints().length)).toBe(0);
  await page.keyboard.press('Escape');
  await reference(page, '2.1.Gauss').click();
  expect(await page.evaluate(() => window.lab.leaves.length)).toBe(1);
  expect(await page.evaluate(() => window.lab.app.workspace.getActiveFile().path)).toBe(sourcePath);
});

test('duplicate labels in sibling notes require a path-aware choice before preview and jump', async ({ page }) => {
  await reference(page, 'duplicate').click();
  const popup = page.locator('.reflo-preview');
  await expect(popup.locator('.reflo-candidate')).toHaveCount(2);
  await expect(popup.locator('.reflo-candidate').filter({ hasText: '第一章' })).toHaveCount(1);
  await expect(popup.locator('.reflo-candidate').filter({ hasText: '附录' })).toHaveCount(1);
  expect(await page.evaluate(() => window.lab.plugin.returnPoints().length)).toBe(0);
  await popup.locator('.reflo-candidate').filter({ hasText: '附录' }).click();
  await expect(popup.locator('mjx-container')).toHaveCount(1);
  await expect(popup.locator('.reflo-preview-location')).toContainText('附录');
  await popup.getByRole('button', { name: '跳到原文并留下返回浮标', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.lab.app.workspace.getActiveFile().path)).toBe('Physics/附录.md');
  await page.locator('.reflo-buoy-go:visible').click();
  expect(await page.evaluate(() => window.lab.app.workspace.getActiveFile().path)).toBe(sourcePath);
});

test('pinned sibling previews follow edits, renames, moves out of scope and replacement targets', async ({ page }) => {
  await reference(page, '图 2.1').hover();
  const popup = page.locator('.reflo-preview');
  await expect(popup).toContainText('第二章图片说明');
  await popup.getByRole('button', { name: '固定此预览，留在旁边对照', exact: true }).click();
  await page.evaluate(() => window.lab.modifyFile('Physics/第二章.md', '# 改后的标题\n\n![新图](updated.png)\n@#fig{2.1} 更新后的图片说明'));
  await expect(popup).toContainText('更新后的图片说明');
  await page.evaluate(() => window.lab.renameFile('Physics/第二章.md', 'Physics/第二章修订.md'));
  await expect(popup.locator('.reflo-preview-body')).toHaveAttribute('data-render-path', 'Physics/第二章修订.md');
  await page.evaluate(() => window.lab.renameFile('Physics/第二章修订.md', 'Archive/第二章修订.md'));
  await expect(popup).toContainText('未找到这个编号');
  await expect(popup.getByRole('button', { name: '跳到原文并留下返回浮标', exact: true })).toBeDisabled();
  await page.evaluate(() => window.lab.addFile('Physics/替代图.md', '![替代图](replacement.png)\n@#fig{2.1} 替代图片说明'));
  await expect(popup).toContainText('替代图片说明');
  await page.evaluate(() => window.lab.deleteFile('Physics/替代图.md'));
  await expect(popup).toContainText('未找到这个编号');
});

test('autocomplete includes mixed sibling labels and excludes inaccessible or shadowed targets', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { cm, suggest, view } = window.lab;
    window.lab.replace(cm.state.doc.length, cm.state.doc.length, '\n\n@{2.1.}');
    const line = cm.state.doc.lines - 1;
    const trigger = suggest.onTrigger({ line, ch: 6 }, view.editor, view.file);
    const context = { ...trigger, editor: view.editor, file: view.file };
    suggest.context = context;
    const targets = await suggest.getSuggestions(context);
    const match = targets.find((t: any) => t.label === '2.1.Gauss');
    if (match) suggest.selectSuggestion(match);
    const all = await window.lab.plugin.suggestionTargets(view.file.path);
    return { labels: targets.map((t: any) => t.label), inserted: cm.state.doc.line(cm.state.doc.lines).text,
      paths: all.map((t: any) => t.path) };
  });
  expect(result.labels).toContain('2.1.Gauss');
  expect(result.inserted).toBe('@{2.1.Gauss}');
  expect(result.paths).not.toContain('Physics/sub/补充.md');
  expect(result.paths).not.toContain('Other/第二章.md');
});

test('Reading view cross-note figures use the same folder lookup and new-tab return', async ({ page }) => {
  await page.evaluate(async () => {
    const { view, plugin } = window.lab;
    // Obsidian hides the source editor in Reading view. Leaving its full-height
    // mock visible pushes this fixture below the viewport and beneath its popup.
    window.lab.cm.dom.hidden = true;
    const el = view.contentEl.createDiv({ cls: 'test-reading markdown-preview-view' });
    el.style.padding = '24px 48px';
    el.textContent = '@fig{2.1}';
    for (const process of plugin.processors) await process(el, { sourcePath: view.file.path, getSectionInfo: () => ({ lineStart: 2 }) });
    view.getMode = () => 'preview';
  });
  const ref = page.locator('.test-reading .reflo-reference');
  await ref.hover();
  await expect(page.locator('.reflo-preview')).toContainText('第二章图片说明');
  await ref.click();
  await expect.poll(() => page.evaluate(() => window.lab.app.workspace.getActiveFile().path)).toBe(equationPath);
  expect(await page.evaluate(() => window.lab.view.file.path)).toBe(sourcePath);
  await page.locator('.reflo-buoy-go:visible').click();
  expect(await page.evaluate(() => window.lab.plugin.returnPoints().length)).toBe(0);
});

test('a stale sibling read cannot overwrite a newer modify event', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { plugin, app, files, modifyFile } = window.lab;
    const path = 'Physics/第二章.md';
    await plugin.getIndex(path);
    const originalRead = app.vault.cachedRead;
    const pending: Array<{ source: string; resolve: (source: string) => void }> = [];
    app.vault.cachedRead = (file: any) => file.path === path
      ? new Promise<string>(resolve => pending.push({ source: files.get(path).source, resolve }))
      : originalRead(file);
    try {
      modifyFile(path, '$$x=1\\tag{old}$$');
      const older = plugin.getIndex(path);
      modifyFile(path, '$$x=2\\tag{new}$$');
      const newer = plugin.getIndex(path);
      const count = pending.length;
      // The newest disk read completes first; the older request arrives last.
      pending[1].resolve(pending[1].source);
      const fresh = await newer;
      pending[0].resolve(pending[0].source);
      const staleRequest = await older;
      const current = await plugin.getIndex(path);
      return { count, fresh: fresh.targets.map((t: any) => t.label),
        staleRequest: staleRequest.targets.map((t: any) => t.label),
        current: current.targets.map((t: any) => t.label) };
    } finally { app.vault.cachedRead = originalRead; }
  });
  expect(result).toEqual({ count: 2, fresh: ['new'], staleRequest: ['new'], current: ['new'] });
});

test('opening and editing a sibling while its old disk read is pending keeps the live content', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { plugin, app, files, modifyFile, addPane } = window.lab;
    const path = 'Physics/第二章.md';
    await plugin.getIndex(path);
    const originalRead = app.vault.cachedRead;
    let finish!: (source: string) => void;
    app.vault.cachedRead = (file: any) => file.path === path
      ? new Promise<string>(resolve => { finish = resolve; }) : originalRead(file);
    try {
      const disk = '$$x=1\\tag{disk}$$';
      modifyFile(path, disk);
      const stale = plugin.getIndex(path);
      const pane = addPane(path);
      pane.cm.dispatch({ changes: { from: 0, to: pane.cm.state.doc.length, insert: '$$x=2\\tag{live}$$' } });
      finish(disk);
      const completed = await stale;
      const live = await plugin.getIndex(path);
      // Close the editor to check that the old read did not poison the cache
      // which will be used by subsequent hover previews of this sibling.
      pane.cm.destroy(); pane.view.contentEl.remove();
      const cached = await plugin.getIndex(path);
      return { completed: completed.targets.map((t: any) => t.label),
        live: live.targets.map((t: any) => t.label), cached: cached.targets.map((t: any) => t.label) };
    } finally { app.vault.cachedRead = originalRead; }
  });
  expect(result).toEqual({ completed: ['live'], live: ['live'], cached: ['live'] });
});

test('mobile sibling references retain collapsible preview and compact cross-note return', async ({ page }) => {
  await page.goto('/?mobile');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page.setViewportSize({ width: 412, height: 915 });
  await seed(page);
  await reference(page, '图 2.1').click();
  const popup = page.locator('.reflo-mobile-preview');
  await expect(popup).toContainText('第二章图片说明');
  await popup.getByRole('button', { name: '收起预览', exact: true }).click();
  await expect(popup).toBeHidden();
  await page.locator('.reflo-mobile-preview-tab').click();
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: '跳到原文并留下返回浮标', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.lab.app.workspace.getActiveFile().path)).toBe(equationPath);
  expect(await page.evaluate(() => window.lab.view.file.path)).toBe(sourcePath);
  await expect(page.locator('.reflo-mobile-buoy:visible')).toHaveText('↩ 1');
  await page.locator('.reflo-mobile-buoy:visible').click();
  expect(await page.evaluate(() => window.lab.app.workspace.getActiveFile().path)).toBe(sourcePath);
  expect(await page.evaluate(() => window.lab.plugin.returnPoints().length)).toBe(0);
});
