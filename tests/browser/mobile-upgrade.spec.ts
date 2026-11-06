import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.beforeEach(async ({ page }) => {
  await page.goto('/?mobile'); await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});

async function select(page: Page, text: string) {
  await page.evaluate(text => {
    const { cm } = window.lab;
    window.lab.replace(0, cm.state.doc.length, text);
    cm.dispatch({ selection: { anchor: 0, head: text.length } });
  }, text);
}
async function swipeHeader(page: Page, up: boolean) {
  const box = (await page.locator('.reflo-mobile-preview .reflo-preview-header').boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const x = box.x + 30, y = box.y + box.height / 2;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 6; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (up ? -1 : 1) * step * 10 }] });
    await page.waitForTimeout(20);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

test('touch selection actions convert only after a tap, preserve the selection and do not focus the keyboard', async ({ page }) => {
  await select(page, '（$2.1.1$）');
  await page.evaluate(() => window.lab.plugin.settings.conversionProfiles[0].templates.push({ kind: 'equation', pattern: '（${n}$）' }));
  const toolbar = page.getByRole('toolbar', { name: '引用选区工具' });
  await expect(toolbar).toBeVisible();
  expect(await page.evaluate(() => window.lab.cm.state.doc.toString())).toBe('（$2.1.1$）');
  const selection = await page.evaluate(() => window.lab.cm.state.selection.main.to);
  expect(selection).toBe('（$2.1.1$）'.length);
  await toolbar.screenshot({ path: '.qa/mobile-selection-tools.png' });
  await toolbar.getByRole('button', { name: '转换引用', exact: true }).tap();
  expect(await page.evaluate(() => window.lab.cm.state.doc.toString())).toBe('@{2.1.1}');
  await expect(toolbar).toBeHidden();
  expect(await page.evaluate(() => window.lab.cm.hasFocus)).toBe(false);
  await page.evaluate(() => window.lab.undo());
  expect(await page.evaluate(() => window.lab.cm.state.doc.toString())).toBe('（$2.1.1$）');
});

test('selection target action previews a multi-paragraph definition before confirmation and supports undo', async ({ page }) => {
  const source = '**定义 1.1.1** 这是定义。\n\n第二段解释。';
  await select(page, source);
  const toolbar = page.getByRole('toolbar', { name: '引用选区工具' });
  await toolbar.getByRole('button', { name: '将选中内容设为引用目标', exact: true }).tap();
  await expect(toolbar).toBeHidden();
  await expect(page.locator('.reflo-target-preview')).toContainText('第二段解释');
  expect(await page.evaluate(() => window.lab.cm.state.doc.toString())).toBe(source);
  await page.getByRole('button', { name: '取消', exact: true }).tap();
  expect(await page.evaluate(() => window.lab.cm.state.doc.toString())).toBe(source);
  // Start a fresh selection after dismissing the previous one.
  await page.evaluate(() => { const { cm } = window.lab; cm.dispatch({ selection: { anchor: 0 } }); cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } }); });
  await toolbar.getByRole('button', { name: '将选中内容设为引用目标', exact: true }).tap();
  await page.getByRole('button', { name: '确认标记', exact: true }).tap();
  expect(await page.evaluate(() => window.lab.cm.state.doc.toString())).toContain('@#def{1.1.1}');
  expect(await page.evaluate(() => window.lab.cm.hasFocus)).toBe(false);
  await page.evaluate(() => window.lab.undo());
  expect(await page.evaluate(() => window.lab.cm.state.doc.toString())).toBe(source);
});

test('dismissal persists for the current selection; readonly and multiple selections hide the toolbar', async ({ page }) => {
  await select(page, '式（1.13a）');
  const toolbar = page.getByRole('toolbar', { name: '引用选区工具' });
  await toolbar.getByRole('button', { name: '收起选区工具' }).tap();
  await page.evaluate(() => window.lab.plugin.refreshPanels());
  await expect(toolbar).toBeHidden();
  await page.evaluate(() => { const { cm } = window.lab; cm.dispatch({ selection: { anchor: 0 } }); cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } }); });
  await expect(toolbar).toBeVisible();
  await page.evaluate(() => window.lab.setReadOnly(true));
  await expect(toolbar).toBeHidden();
  await page.evaluate(() => {
    window.lab.setReadOnly(false);
    const { cm, EditorSelection } = window.lab;
    cm.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(3, 5)]) });
  });
  await expect(toolbar).toBeHidden();
});

test('selection actions have a persistent mobile setting and clean up across note switches and unload', async ({ page }) => {
  await select(page, '式（1.13a）');
  const toolbar = page.getByRole('toolbar', { name: '引用选区工具' });
  await page.evaluate(() => window.lab.showSettings());
  await page.getByRole('checkbox', { name: '选中文字时显示引用工具' }).uncheck();
  await expect(toolbar).toBeHidden();
  expect(await page.evaluate(async () => (await window.lab.reloadSettings()).mobileSelectionActions)).toBe(false);
  await page.getByRole('checkbox', { name: '选中文字时显示引用工具' }).check();
  await page.evaluate(() => document.querySelector('.test-modal')!.remove());
  await expect(toolbar).toBeVisible();
  await page.evaluate(async () => { window.lab.addFile('Other.md', '# Other'); await window.lab.openFile('Other.md'); });
  await expect(toolbar).toBeHidden();
  expect(await page.evaluate(() => document.body.classList.contains('reflo-selection-active'))).toBe(false);
  await page.evaluate(() => {
    window.lab.plugin.onunload(); window.lab.plugin.unload();
    window.lab.cm.dispatch({ selection: { anchor: 0, head: 3 } });
  });
  await expect(page.locator('.reflo-mobile-selection')).toHaveCount(0);
});

test('the toolbar avoids the minimized preview and fits a keyboard-sized viewport', async ({ page }) => {
  await page.getByRole('button', { name: '（式 1.13a）', exact: true }).first().tap();
  await page.getByRole('button', { name: '收起预览', exact: true }).tap();
  await page.evaluate(() => {
    const { cm } = window.lab;
    const start = cm.state.doc.toString().indexOf('在**');
    cm.dispatch({ selection: { anchor: start, head: start + 3 } });
  });
  const toolbar = page.getByRole('toolbar', { name: '引用选区工具' });
  await expect(toolbar).toBeVisible();
  await expect(page.locator('.reflo-mobile-preview-tab')).toBeHidden();
  await page.setViewportSize({ width: 320, height: 300 });
  for (const button of await toolbar.locator('button').all()) await expect(button).toBeInViewport();
  await toolbar.getByRole('button', { name: '收起选区工具' }).tap();
  await expect(page.locator('.reflo-mobile-preview-tab')).toBeVisible();
});

test('long previews expand with an upward swipe, restore their size, and shrink before minimizing', async ({ page }) => {
  await page.evaluate(() => {
    const text = '# Long\n\n@add{long}\n\n```text\n' + Array.from({ length: 90 }, (_, i) => `内容 ${i}`).join('\n') + '\n```\n@#add{long}';
    window.lab.replace(0, window.lab.cm.state.doc.length, text);
  });
  await page.getByRole('button', { name: '（附 long）', exact: true }).tap();
  const card = page.locator('.reflo-mobile-preview');
  const compact = (await card.boundingBox())!.height;
  await swipeHeader(page, true);
  await expect(card).toHaveClass(/is-expanded/);
  expect((await card.boundingBox())!.height).toBeGreaterThan(compact + 100);
  await card.locator('.reflo-preview-body').evaluate(el => { el.scrollTop = 300; });
  await card.getByRole('button', { name: '收起预览', exact: true }).tap();
  await expect(card).toBeHidden();
  await page.locator('.reflo-mobile-preview-tab').tap();
  await expect(card).toHaveClass(/is-expanded/);
  expect(await card.locator('.reflo-preview-body').evaluate(el => el.scrollTop)).toBe(300);
  await card.screenshot({ path: '.qa/mobile-expanded-preview.png' });
  await swipeHeader(page, false);
  await expect(card).not.toHaveClass(/is-expanded/); await expect(card).toBeVisible();
  await swipeHeader(page, false);
  await expect(card).toBeHidden();
});

test('mobile template generation preserves named labels and uses touch-sized inputs', async ({ page }) => {
  await page.evaluate(() => window.lab.showConversionSettings());
  await page.getByText('从示例生成模板', { exact: true }).tap();
  const example = page.getByRole('textbox', { name: '原始引用示例', exact: true });
  const label = page.getByRole('textbox', { name: '实际编号', exact: true });
  await example.fill('公式 [[#^eq-1-1-Gauss|(1.1.Gauss)]]'); await label.fill('1.1.Gauss');
  for (const input of [example, label, page.getByRole('textbox', { name: '生成的模板', exact: true })]) {
    await expect(input).toHaveAttribute('autocapitalize', 'off'); await expect(input).toHaveAttribute('autocorrect', 'off');
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: '生成模板', exact: true }).tap();
  await expect(page.locator('.reflo-generator-result')).toContainText('@{1.1.Gauss}');
  await page.getByRole('button', { name: '添加到当前模板组', exact: true }).tap();
  expect(await page.evaluate(() => window.lab.plugin.settings.conversionProfiles[0].templates.at(-1).pattern)).toBe('公式 [[#^eq-{*}|({n})]]');
});

test('desktop selections do not acquire a mobile toolbar', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await select(page, '式（1.13a）');
  await expect(page.locator('.reflo-mobile-selection')).toHaveCount(0);
});

test('touching a cross-note heading previews it, opens a new tab, and returns to the original reading position', async ({ page }) => {
  await page.goto('/?mobile&fragmented'); await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => {
    window.lab.replace(0, window.lab.cm.state.doc.length, '# 电动力学\n\n[[原子物理学#塞曼效应]]\n\n' + '继续阅读\n\n'.repeat(40));
    window.lab.addFile('原子物理学.md', '# 原子物理学\n### 塞曼效应\n跨笔记正文\n#### 说明\n子标题内容');
  });
  await page.locator('.cm-underline').filter({ hasText: '塞曼效应' }).tap();
  const preview = page.locator('.reflo-mobile-preview');
  await expect(preview).toContainText('跨笔记正文');
  expect(await page.evaluate(() => window.lab.leaves.length)).toBe(1);
  const departure = await page.evaluate(() => window.lab.cm.scrollDOM.scrollTop);
  await preview.getByRole('button', { name: '跳到原文并留下返回浮标', exact: true }).tap();
  expect(await page.evaluate(() => window.lab.app.workspace.getActiveFile().path)).toBe('原子物理学.md');
  expect(await page.evaluate(() => window.lab.view.file.path)).toBe('引用浮标体验.md');
  await page.locator('.reflo-mobile-buoy:visible').tap();
  expect(await page.evaluate(() => window.lab.app.workspace.getActiveViewOfType() === window.lab.view)).toBe(true);
  expect(await page.evaluate(() => window.lab.cm.scrollDOM.scrollTop)).toBe(departure);
  expect(await page.evaluate(() => window.lab.cm.hasFocus)).toBe(false);
});
