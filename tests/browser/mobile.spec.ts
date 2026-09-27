import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const source = [
  '# 手机阅读', '', '$$', 'E = mc^2 \\tag{1.13b}', '$$', '',
  '先看 @{1.13a}，再看 @add{long}。', '',
  ...Array.from({ length: 45 }, (_, i) => `阅读段落 ${i + 1}。\n`),
  '$$', 'p = mv \\tag{1.13a}', '$$', '', '继续对照 @{1.13b}。', '',
  '```text', ...Array.from({ length: 70 }, (_, i) => `补充说明第 ${i + 1} 行`), '```', '@#add{long}', ''
].join('\n');

async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 8; i++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }] });
    await page.waitForTimeout(25);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/index.html?mobile=1');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await page.evaluate(source => {
    const { cm } = window.lab;
    cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: source }, selection: { anchor: 0 } });
    cm.scrollDOM.scrollTop = 0;
  }, source);
});

test('touch opens a minimal preview; collapse and restore do not jump or focus the editor', async ({ page }) => {
  await page.getByRole('button', { name: '（式 1.13a）', exact: true }).tap();
  const card = page.locator('.reflo-mobile-preview');
  await expect(card).toBeVisible();
  await expect(card.locator('mjx-container')).toHaveCount(1);
  await expect(card.locator('.reflo-preview-location')).toBeHidden();
  await expect(card.locator('.reflo-preview-controls button')).toHaveCount(2);
  expect(await page.evaluate(() => window.lab.plugin.points.size)).toBe(0);
  expect(await page.evaluate(() => window.lab.cm.hasFocus)).toBe(false);
  await card.getByRole('button', { name: '收起预览', exact: true }).tap();
  await expect(card).toBeHidden();
  const tab = page.getByRole('button', { name: '恢复预览：式 1.13a', exact: true });
  await expect(tab).toBeVisible();
  await tab.tap();
  await expect(card).toBeVisible();
  await expect(tab).toBeHidden();
  await card.getByRole('button', { name: '关闭预览', exact: true }).tap();
  await expect(page.locator('.reflo-mobile-preview,.reflo-mobile-preview-tab')).toHaveCount(0);
});

test('a collapsed preview retains content, context and its scroll position', async ({ page }) => {
  await page.getByRole('button', { name: '（附 long）', exact: true }).tap();
  const card = page.locator('.reflo-mobile-preview'), body = card.locator('.reflo-preview-body');
  await expect(body.locator('pre')).toContainText('补充说明第 70 行');
  await card.getByRole('button', { name: '展开上下文', exact: true }).tap();
  await expect(card.locator('.reflo-preview-context')).toBeVisible();
  expect((await card.locator('.reflo-preview-context').boundingBox())!.height).toBeGreaterThanOrEqual(64);
  await body.evaluate(el => { el.scrollTop = 360; });
  const scroll = await body.evaluate(el => el.scrollTop);
  expect(scroll).toBeGreaterThan(100);
  await page.locator('.test-header').tap();
  await expect(card).toBeHidden();
  await page.locator('.reflo-mobile-preview-tab').tap();
  await expect(card.locator('.reflo-preview-context')).toBeVisible();
  expect(await body.evaluate(el => el.scrollTop)).toBe(scroll);
  await card.screenshot({ path: '.qa/mobile-context.png' });
});

test('swiping a reference scrolls the note; swiping the preview header collapses it', async ({ page }) => {
  const ref = page.getByRole('button', { name: '（式 1.13a）', exact: true });
  const box = (await ref.boundingBox())!;
  await swipe(page, { x: box.x + 12, y: box.y + box.height / 2 }, { x: box.x + 12, y: box.y - 110 });
  await expect(page.locator('.reflo-mobile-preview')).toHaveCount(0);
  expect(await page.evaluate(() => window.lab.cm.scrollDOM.scrollTop)).toBeGreaterThan(20);
  await page.evaluate(() => { window.lab.cm.scrollDOM.scrollTop = 0; });
  await ref.tap();
  const card = page.locator('.reflo-mobile-preview');
  const header = (await card.locator('.reflo-preview-header').boundingBox())!;
  await swipe(page, { x: header.x + 30, y: header.y + 20 }, { x: header.x + 30, y: header.y + 100 });
  await expect(card).toBeHidden();
  await expect(page.locator('.reflo-mobile-preview-tab')).toBeVisible();
});

test('touch jumps keep compact directional markers and returning consumes only one', async ({ page }) => {
  await page.getByRole('button', { name: '（式 1.13a）', exact: true }).tap();
  await page.getByRole('button', { name: '跳到原文并留下返回浮标', exact: true }).tap();
  const above = page.locator('[data-edge="top"] .reflo-mobile-buoy');
  await expect(above).toHaveText('↑ 1');
  await expect(page.locator('.reflo-buoy-excerpt,.reflo-buoys-header')).toHaveCount(0);
  await expect(above).not.toHaveAttribute('title');
  await page.getByRole('button', { name: '（式 1.13b）', exact: true }).tap();
  await page.getByRole('button', { name: '跳到原文并留下返回浮标', exact: true }).tap();
  await expect(page.locator('.reflo-mobile-buoy')).toHaveCount(2);
  const below = page.locator('[data-edge="bottom"] .reflo-mobile-buoy');
  await expect(below).toHaveText('↓ 2');
  await page.screenshot({ path: '.qa/mobile-buoys.png' });
  await below.tap();
  await expect(page.locator('.reflo-mobile-buoy')).toHaveCount(1);
  expect(await page.evaluate(() => window.lab.plugin.points.get(window.lab.file.path).map((p: any) => p.id))).toEqual([1]);
  expect(await page.evaluate(() => window.lab.cm.hasFocus)).toBe(false);
  await page.locator('.reflo-mobile-buoy').tap();
  await expect(page.locator('.reflo-mobile-buoys')).toBeHidden();
});

test('long press offers removal without jumping or showing context', async ({ page }) => {
  await page.getByRole('button', { name: '（式 1.13a）', exact: true }).tap();
  await page.getByRole('button', { name: '跳到原文并留下返回浮标', exact: true }).tap();
  const before = await page.evaluate(() => window.lab.cm.scrollDOM.scrollTop);
  const box = (await page.locator('.reflo-mobile-buoy').boundingBox())!;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await page.waitForTimeout(650);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
  await expect(page.getByRole('menuitem', { name: '移除浮标', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.lab.cm.scrollDOM.scrollTop)).toBe(before);
  await page.getByRole('menuitem', { name: '移除浮标', exact: true }).tap();
  await expect(page.locator('.reflo-mobile-buoys')).toBeHidden();
});

test('one preview at a time fits portrait, landscape and a keyboard-sized viewport', async ({ page }) => {
  await page.getByRole('button', { name: '（式 1.13a）', exact: true }).tap();
  await page.getByRole('button', { name: '收起预览', exact: true }).tap();
  await page.getByRole('button', { name: '（附 long）', exact: true }).tap();
  await expect(page.locator('.reflo-mobile-preview')).toHaveCount(1);
  await expect(page.locator('.reflo-mobile-preview-tab')).toHaveCount(1);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 360, height: 340 }]) {
    await page.setViewportSize(viewport);
    const card = page.locator('.reflo-mobile-preview');
    await expect.poll(async () => Math.round((await card.boundingBox())!.width)).toBe(viewport.width - 16);
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await expect(card.getByRole('button', { name: '收起预览', exact: true })).toBeInViewport();
    await expect(card.getByRole('button', { name: '跳到原文并留下返回浮标', exact: true })).toBeInViewport();
  }
  await page.screenshot({ path: '.qa/mobile-small-viewport.png' });
});

test('note switching hides the preview tab and unload clears temporary UI', async ({ page }) => {
  await page.getByRole('button', { name: '（式 1.13a）', exact: true }).tap();
  await page.getByRole('button', { name: '收起预览', exact: true }).tap();
  await page.evaluate(() => window.lab.plugin.previews.setActivePath('another.md'));
  await expect(page.locator('.reflo-mobile-preview-tab')).toBeHidden();
  await page.evaluate(() => window.lab.plugin.previews.setActivePath(window.lab.file.path));
  await expect(page.locator('.reflo-mobile-preview-tab')).toBeVisible();
  await page.evaluate(() => { window.lab.plugin.onunload(); window.lab.plugin.unload(); });
  await expect(page.locator('.reflo-mobile-preview,.reflo-mobile-preview-tab,.reflo-mobile-buoys')).toHaveCount(0);
});

test('mobile conversion uses the existing command and an isolated undo step', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { cm, plugin, view } = window.lab;
    window.lab.replace(0, 0, '式（1.13a）\n\n');
    cm.dispatch({ selection: { anchor: 0, head: '式（1.13a）'.length } });
    plugin.commands.find((c: any) => c.id === 'convert-selected-reference').editorCallback(view.editor);
    const converted = cm.state.doc.line(1).text;
    window.lab.undo();
    return { converted, restored: cm.state.doc.line(1).text };
  });
  expect(result).toEqual({ converted: '@{1.13a}', restored: '式（1.13a）' });
});

test('rapid taps keep the latest preview even when an earlier lookup resolves last', async ({ page }) => {
  await page.evaluate(async () => {
    const { plugin, file, cm } = window.lab;
    const index = await window.lab.index();
    const normalGetIndex = plugin.getIndex.bind(plugin);
    const pending: Array<() => void> = [];
    plugin.getIndex = () => new Promise(resolve => pending.push(() => resolve(index)));
    const refs = index.references.filter((r: any) => !r.definition);
    const elements = [...document.querySelectorAll<HTMLElement>('.reflo-reference')];
    const first = plugin.previews.open(elements[0], refs[0], { path: file.path, from: refs[0].from, to: refs[0].to, cm });
    const second = plugin.previews.open(elements[1], refs[1], { path: file.path, from: refs[1].from, to: refs[1].to, cm });
    plugin.getIndex = normalGetIndex;
    pending[1](); await second;
    pending[0](); await first;
  });
  await expect(page.locator('.reflo-mobile-preview')).toHaveCount(1);
  await expect(page.locator('.reflo-preview-identity strong')).toHaveText('附 long');
});

test('many mobile markers remain individually reachable in a bounded stack', async ({ page }) => {
  await page.evaluate(async () => {
    const { plugin, file, cm } = window.lab;
    const index = await window.lab.index(), ref = index.references.find((r: any) => r.label === '1.13a');
    await plugin.jump(index.targets.find((t: any) => t.label === '1.13a'), { path: file.path, from: ref.from, to: ref.to, cm });
    const first = plugin.points.get(file.path)[0];
    for (let id = 2; id <= 16; id++) plugin.points.get(file.path).push({ ...first, id });
    plugin.refreshPanels();
  });
  const stack = page.locator('[data-edge="top"]');
  await expect(stack.locator('.reflo-mobile-buoy')).toHaveCount(16);
  expect(await stack.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  expect((await stack.boundingBox())!.height).toBeLessThan(350);
  await stack.locator('[data-buoy-id="1"]').tap();
  await expect(page.locator('.reflo-mobile-buoy')).toHaveCount(15);
  expect(await page.evaluate(() => window.lab.plugin.points.get(window.lab.file.path).some((p: any) => p.id === 1))).toBe(false);
});

test('switching notes cancels a pending mobile preview lookup', async ({ page }) => {
  await page.evaluate(async () => {
    const { plugin, file, cm } = window.lab;
    const index = await window.lab.index(), ref = index.references.find((r: any) => r.label === '1.13a');
    const original = plugin.getIndex.bind(plugin);
    let resolve!: (value: any) => void;
    plugin.getIndex = () => new Promise(done => { resolve = done; });
    const request = plugin.previews.open(document.querySelector('.reflo-reference'), ref, { path: file.path, from: ref.from, to: ref.to, cm });
    plugin.previews.setActivePath('another.md');
    plugin.getIndex = original;
    resolve(index);
    await request;
  });
  await expect(page.locator('.reflo-mobile-preview,.reflo-mobile-preview-tab')).toHaveCount(0);
});
