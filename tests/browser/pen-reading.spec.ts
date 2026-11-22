import { test, expect, type Locator, type Page } from '@playwright/test';

test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

const source = [
  '# 手写笔阅读', '', '先看 @{3.a}，再看 @{3.b}。', '', '@add{long} 和 @{dup}。', '',
  '[[B#Section|跨篇章节]]', '',
  ...Array.from({ length: 35 }, (_, i) => `阅读内容 ${i + 1}。\n`),
  String.raw`$$\begin{align}x&=1\tag{3.a}\\&=2\notag\\&=3\tag{3.b}\end{align}$$`, '',
  '$$a=1\\tag{dup}$$', '', '$$b=2\\tag{dup}$$', '',
  '```text', ...Array.from({ length: 70 }, (_, i) => `对照内容 ${i + 1}`), '```', '@#add{long}', ''
].join('\n');

async function penTap(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'pen' });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  } finally { await session.detach(); }
}

async function penDrag(page: Page, locator: Locator, dx: number, dy: number) {
  const box = (await locator.boundingBox())!;
  // Grab the title area, away from the header buttons.
  const x = box.x + 28, y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'pen' });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
    for (let i = 1; i <= 8; i++) {
      await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * i / 8, y: y + dy * i / 8, buttons: 1, pointerType: 'pen' });
    }
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  } finally { await session.detach(); }
}

async function touchSwipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 8; i++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }] });
      await page.waitForTimeout(20);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}

const ref = (page: Page, label: string) => page.getByRole('button', { name: `（式 ${label}）`, exact: true }).first();
const points = (page: Page) => page.evaluate(() => window.lab.plugin.returnPoints().length);
async function enable(page: Page) {
  await page.evaluate(async () => { window.lab.plugin.settings.penReadingMode = true; await window.lab.plugin.saveSettings(); });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?mobile');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(source => {
    window.lab.replace(0, window.lab.cm.state.doc.length, source);
    window.lab.cm.dispatch({ selection: { anchor: 0 } });
    window.lab.cm.scrollDOM.scrollTop = 0;
    window.lab.addFile('B.md', '# B\n\n## Section\n跨篇目标内容\n### Child\n子节内容');
    (window as any).pointerKinds = [];
    document.addEventListener('pointerdown', event => (window as any).pointerKinds.push(event.pointerType), true);
  }, source);
});

test('pen reading is opt-in and the setting persists without changing normal touch preview', async ({ page }) => {
  expect(await page.evaluate(() => window.lab.plugin.settings.penReadingMode)).toBe(false);
  await penTap(page, ref(page, '3.a'));
  await expect(page.locator('.reflo-mobile-preview')).toBeVisible();
  expect(await points(page)).toBe(0);
  await page.getByRole('button', { name: '关闭预览', exact: true }).tap();
  await ref(page, '3.a').tap();
  await expect(page.locator('.reflo-mobile-preview')).toBeVisible();
  expect(await points(page)).toBe(0);
  await page.getByRole('button', { name: '关闭预览', exact: true }).tap();
  await page.evaluate(() => window.lab.showSettings());
  const setting = page.getByRole('checkbox', { name: '手写笔阅读模式', exact: true });
  await expect(setting).not.toBeChecked();
  await setting.check();
  expect(await page.evaluate(async () => (await window.lab.reloadSettings()).penReadingMode)).toBe(true);
});

test('pen taps preview the exact math tag without moving; a finger tap jumps once and returns', async ({ page }) => {
  await enable(page);
  const before = await page.evaluate(() => ({ scroll: window.lab.cm.scrollDOM.scrollTop, cursor: window.lab.cm.state.selection.main.head }));
  await penTap(page, ref(page, '3.b'));
  const card = page.locator('.reflo-mobile-preview');
  await expect(card).toBeVisible();
  await expect(card.locator('.reflo-preview-identity strong')).toHaveText('式 3.b');
  await expect(card.locator('mjx-merror')).toHaveCount(0);
  await expect(card.locator('mjx-table > mjx-itable > .reflo-math-focus')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).pointerKinds)).toContain('pen');
  expect(await points(page)).toBe(0);
  expect(await page.evaluate(() => ({ scroll: window.lab.cm.scrollDOM.scrollTop, cursor: window.lab.cm.state.selection.main.head }))).toEqual(before);
  expect(await page.evaluate(() => window.lab.cm.hasFocus)).toBe(false);
  // The same number is a pen preview and a finger jump, with the popup still open.
  await ref(page, '3.b').tap();
  await expect.poll(() => points(page)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.lab.cm.scrollDOM.scrollTop)).toBeGreaterThan(300);
  expect(await page.evaluate(() => (window as any).pointerKinds)).toContain('touch');
  // Wait beyond the browser's compatibility click so a double jump cannot hide.
  await page.waitForTimeout(350);
  expect(await points(page)).toBe(1);
  await page.locator('.reflo-mobile-buoy:visible').tap();
  await expect.poll(() => points(page)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.lab.cm.scrollDOM.scrollTop)).toBe(before.scroll);
});

test('finger swipes never jump and duplicate labels require an explicit choice', async ({ page }) => {
  await enable(page);
  const box = (await ref(page, '3.a').boundingBox())!;
  await touchSwipe(page, { x: box.x + 15, y: box.y + box.height / 2 }, { x: box.x + 15, y: 35 });
  expect(await points(page)).toBe(0);
  await expect(page.locator('.reflo-preview')).toHaveCount(0);
  await page.evaluate(() => { window.lab.cm.scrollDOM.scrollTop = 0; });
  await ref(page, 'dup').tap();
  await expect(page.locator('.reflo-candidate')).toHaveCount(2);
  expect(await points(page)).toBe(0);
  await expect(page.getByRole('button', { name: '跳到原文并留下返回浮标', exact: true })).toBeDisabled();
});

test('native heading links distinguish pen preview and finger new-tab navigation', async ({ page }) => {
  await enable(page);
  const link = page.locator('.cm-hmd-internal-link').filter({ hasText: '跨篇章节' });
  await penTap(page, link);
  await expect(page.locator('.reflo-mobile-preview')).toContainText('跨篇目标内容');
  expect(await points(page)).toBe(0);
  expect(await page.evaluate(() => window.lab.leaves.length)).toBe(1);
  await page.getByRole('button', { name: '关闭预览', exact: true }).tap();
  await link.tap();
  await expect.poll(() => page.evaluate(() => window.lab.app.workspace.getActiveFile().path)).toBe('B.md');
  expect(await points(page)).toBe(1);
  expect(await page.evaluate(() => window.lab.view.file.path)).toBe('引用浮标体验.md');
  await page.locator('.reflo-mobile-buoy:visible').tap();
  await expect.poll(() => points(page)).toBe(0);
  expect(await page.evaluate(() => window.lab.app.workspace.getActiveViewOfType() === window.lab.view)).toBe(true);
});

test('Reading view formula and heading links retain pen preview and single finger jumps', async ({ page }) => {
  await enable(page);
  await page.evaluate(async () => {
    const { view, plugin, cm } = window.lab;
    cm.dom.hidden = true;
    const reading = view.contentEl.createDiv({ cls: 'test-reading markdown-preview-view' });
    Object.assign(reading.style, { padding: '24px', height: '100%', overflow: 'auto' });
    reading.createEl('p', { text: '@{3.a}' });
    reading.createEl('a', { cls: 'internal-link', text: '阅读章节', attr: { href: 'B#Section', 'data-href': 'B#Section', tabindex: '0' } });
    for (const process of plugin.processors) await process(reading, { sourcePath: view.file.path, getSectionInfo: () => ({ lineStart: 0 }) });
    view.getMode = () => 'preview';
  });
  const formula = page.locator('.test-reading .reflo-reference');
  await penTap(page, formula);
  await expect(page.locator('.reflo-mobile-preview .reflo-preview-identity strong')).toHaveText('式 3.a');
  expect(await points(page)).toBe(0);
  await page.getByRole('button', { name: '关闭预览', exact: true }).tap();
  await formula.tap();
  await expect.poll(() => points(page)).toBe(1);
  await page.locator('.reflo-mobile-buoy:visible').tap();
  await expect.poll(() => points(page)).toBe(0);
  const heading = page.locator('.test-reading .internal-link');
  await penTap(page, heading);
  await expect(page.locator('.reflo-mobile-preview')).toContainText('跨篇目标内容');
  expect(await points(page)).toBe(0);
  await page.getByRole('button', { name: '关闭预览', exact: true }).tap();
  await heading.tap();
  await expect.poll(() => page.evaluate(() => window.lab.app.workspace.getActiveFile().path)).toBe('B.md');
  expect(await points(page)).toBe(1);
});

test('dragging the header pins two independent cards while body scrolling and rotation keep them usable', async ({ page }) => {
  await enable(page);
  await penTap(page, page.getByRole('button', { name: '（附 long）', exact: true }));
  const long = page.locator('.reflo-mobile-preview').filter({ has: page.locator('.reflo-preview-identity strong', { hasText: '附 long' }) });
  await expect(long).toBeVisible();
  const bottom = (await long.boundingBox())!;
  expect(bottom.y + bottom.height).toBeGreaterThan(800);
  await penDrag(page, long.locator('.reflo-preview-header'), 0, -130);
  await expect(long).toHaveClass(/is-pinned/);
  const pinned = (await long.boundingBox())!;
  expect(pinned.y).toBeLessThan(bottom.y - 50);
  const body = long.locator('.reflo-preview-body');
  const bodyBox = (await body.boundingBox())!;
  await touchSwipe(page, { x: bodyBox.x + 45, y: bodyBox.y + 150 }, { x: bodyBox.x + 45, y: bodyBox.y + 45 });
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(20);
  const afterScroll = (await long.boundingBox())!;
  expect(Math.abs(afterScroll.y - pinned.y)).toBeLessThan(3);
  await penTap(page, ref(page, '3.a'));
  const equation = page.locator('.reflo-mobile-preview').filter({ has: page.locator('.reflo-preview-identity strong', { hasText: '式 3.a' }) });
  await expect(equation).toBeVisible();
  await expect(long).toBeVisible();
  await penDrag(page, equation.locator('.reflo-preview-header'), 0, -90);
  await expect(page.locator('.reflo-mobile-preview.is-pinned')).toHaveCount(2);
  expect(await points(page)).toBe(0);
  await page.setViewportSize({ width: 915, height: 412 });
  for (const card of [long, equation]) {
    await expect(card.locator('.reflo-preview-header')).toBeInViewport();
    await expect.poll(async () => {
      const box = (await card.boundingBox())!;
      return box.x >= 0 && box.y >= 0 && box.x + box.width <= 916 && box.y + box.height <= 413;
    }).toBe(true);
  }
  await equation.getByRole('button', { name: '关闭预览', exact: true }).tap();
  await expect(equation).toHaveCount(0); await expect(long).toBeVisible();
  await long.getByRole('button', { name: '关闭预览', exact: true }).tap();
  await expect(page.locator('.reflo-preview,.reflo-mobile-preview-tab')).toHaveCount(0);
});

test('keyboard activation and unclassified clicks preview instead of guessing a finger jump', async ({ page }) => {
  await enable(page);
  await ref(page, '3.a').press('Enter');
  await expect(page.locator('.reflo-mobile-preview')).toBeVisible();
  expect(await points(page)).toBe(0);
  await page.getByRole('button', { name: '关闭预览', exact: true }).tap();
  await ref(page, '3.b').evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
  await expect(page.locator('.reflo-preview-identity strong')).toHaveText('式 3.b');
  expect(await points(page)).toBe(0);
});

test('a pen preview supersedes a pending finger jump even if a compatibility click follows', async ({ page }) => {
  await enable(page);
  await page.evaluate(() => {
    const lab = window.lab, resolveTargets = lab.plugin.referenceTargets.bind(lab.plugin);
    // Delay the first numbered lookup; a subsequent pen tap can complete before it.
    lab.plugin.referenceTargets = async (...query: any[]) => {
      lab.plugin.referenceTargets = resolveTargets;
      await new Promise<void>(done => { lab.releaseFingerLookup = done; });
      return resolveTargets(...query);
    };
  });
  const number = ref(page, '3.b');
  await number.tap();
  await expect.poll(() => page.evaluate(() => typeof window.lab.releaseFingerLookup)).toBe('function');
  await penTap(page, number);
  await expect(page.locator('.reflo-preview-identity strong')).toHaveText('式 3.b');
  await number.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
  await page.evaluate(async () => {
    window.lab.releaseFingerLookup();
    await new Promise(requestAnimationFrame);
  });
  await expect(page.locator('.reflo-mobile-preview')).toHaveCount(1);
  expect(await points(page)).toBe(0);
});

test('a tablet can keep two formula previews side by side after a diagonal finger drag', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await enable(page);
  await page.evaluate(() => {
    const wide = Array.from({ length: 45 }, (_, i) => `a_{${i + 1}}`).join('+');
    window.lab.replace(0, window.lab.cm.state.doc.length,
      '# 公式对照\n\n对照 @{wide-a} 和 @{second-b}。\n\n'
      + '阅读中的说明文字。\n\n'.repeat(30)
      + `$$ S=${wide}\\tag{wide-a} $$\n\n$$ E=mc^2\\tag{second-b} $$`);
    window.lab.cm.dispatch({ selection: { anchor: 0 } });
    window.lab.cm.scrollDOM.scrollTop = 0;
  });
  await penTap(page, ref(page, 'wide-a'));
  const first = page.locator('.reflo-mobile-preview').filter({ has: page.locator('.reflo-preview-identity strong', { hasText: '式 wide-a' }) });
  await expect(first.locator('mjx-container')).toHaveCount(1);
  const initial = (await first.boundingBox())!;
  expect(initial.y + initial.height).toBeGreaterThan(700);
  const header = (await first.locator('.reflo-preview-header').boundingBox())!;
  const grab = { x: header.x + 35, y: header.y + header.height / 2 };
  await touchSwipe(page, grab, { x: grab.x - 220, y: grab.y - 260 });
  await expect(first).toHaveClass(/is-pinned/);
  const dragged = (await first.boundingBox())!;
  expect(dragged.x).toBeLessThan(initial.x - 150);
  expect(dragged.y).toBeLessThan(initial.y - 200);

  const body = first.locator('.reflo-preview-body');
  expect(await body.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(500);
  const bodyBox = (await body.boundingBox())!;
  await touchSwipe(page,
    { x: bodyBox.x + bodyBox.width - 40, y: bodyBox.y + bodyBox.height / 2 },
    { x: bodyBox.x + 50, y: bodyBox.y + bodyBox.height / 2 });
  await expect.poll(() => body.evaluate(el => el.scrollLeft)).toBeGreaterThan(100);
  const afterScroll = (await first.boundingBox())!;
  expect(Math.abs(afterScroll.x - dragged.x)).toBeLessThan(3);
  expect(Math.abs(afterScroll.y - dragged.y)).toBeLessThan(3);

  await penTap(page, ref(page, 'second-b'));
  const second = page.locator('.reflo-mobile-preview').filter({ has: page.locator('.reflo-preview-identity strong', { hasText: '式 second-b' }) });
  await expect(first).toBeVisible();
  await expect(second.locator('mjx-container')).toHaveCount(1);
  await penDrag(page, second.locator('.reflo-preview-header'), 280, -260);
  await expect(page.locator('.reflo-mobile-preview.is-pinned')).toHaveCount(2);
  for (const card of [first, second]) {
    await expect(card).toBeVisible();
    await expect(card.locator('mjx-merror')).toHaveCount(0);
    await expect(card.getByRole('button', { name: '关闭预览', exact: true })).toBeInViewport();
  }
  expect(await points(page)).toBe(0);
  await page.screenshot({ path: '.qa/pen-formulas.png', animations: 'disabled' });
  await second.getByRole('button', { name: '关闭预览', exact: true }).tap();
  await expect(second).toHaveCount(0); await expect(first).toBeVisible();
  await first.getByRole('button', { name: '关闭预览', exact: true }).tap();
  await expect(page.locator('.reflo-preview')).toHaveCount(0);
});
