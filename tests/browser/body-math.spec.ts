import { test, expect, type Page } from '@playwright/test';

// Headless Chromium normally hides native scrollbars, preventing drag coverage.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});
async function fixture(page: Page, mode: 'live' | 'reading') {
  await page.evaluate(async mode => {
    const { view, cm, renderMath, finishRenderMath } = window.lab;
    const style = document.createElement('style'); style.textContent = '#editor > .cm-editor {display:none !important}'; document.head.appendChild(style);
    view.contentEl.style.width = '900px';
    const body = view.contentEl.createDiv({ cls: mode === 'live' ? 'markdown-source-view mod-cm6' : 'markdown-preview-view' });
    body.id = 'body-math'; body.style.cssText = 'width:100%;height:100%;padding:24px;overflow:auto';
    body.createEl('h2', { text: '分屏正文公式 / ' + mode });
    for (const [id, tex] of [
      ['short', 'E=mc^2'],
      ['medium', 'a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}=b'],
      ['tagged', 'a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}=b \\tag{1.1.4}'],
      ['long', Array.from({length:35},(_,i)=>`x_{${i}}`).join('+')+'=0 \\tag{1.13a}'],
      ['aligned', '\\begin{align}a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9&=b \\tag{1.13a}\\\\ c&=d \\tag{1.13b}\\end{align}']
    ]) {
      const block = body.createDiv({ cls: mode === 'live' ? 'cm-embed-block math' : 'math math-block' });
      block.id = id; block.appendChild(renderMath(tex, true));
    }
    const inline = body.createEl('p', { text: '行内公式：' }); inline.id = 'inline-math'; inline.appendChild(renderMath('a+b', false));
    const preview = document.body.createDiv({ cls: 'reflo-preview' }); preview.id = 'outside-preview';
    preview.style.display = 'none'; preview.appendChild(renderMath('a+b', true));
    await finishRenderMath(); await document.fonts.ready;
  }, mode);
}
async function sizes(page: Page, id: string) {
  return page.locator(`#${id} mjx-container`).evaluate((el: HTMLElement) => {
    const math = el.querySelector('mjx-math')!;
    return { viewport: el.clientWidth, content: el.scrollWidth, left: math.getBoundingClientRect().left - el.getBoundingClientRect().left,
      mathWidth: math.getBoundingClientRect().width, font: getComputedStyle(el).fontSize, overflow: getComputedStyle(el).overflowX };
  });
}
for (const mode of ['live', 'reading'] as const) test(`${mode}: pane-only resize exposes full formulas and tags without widening the note`, async ({ page }) => {
  await fixture(page, mode);
  const wide = await sizes(page, 'medium');
  expect(wide.content).toBe(wide.viewport);
  expect((await sizes(page, 'tagged')).content).toBe((await sizes(page, 'tagged')).viewport);
  const short = await sizes(page, 'short');
  expect(short.left).toBeGreaterThan(200);
  await page.locator('#editor').evaluate(el => el.style.width = '360px');
  for (const id of ['medium', 'tagged', 'long', 'aligned']) {
    const narrow = await sizes(page, id);
    expect(narrow.content, id).toBeGreaterThan(narrow.viewport + 30);
    expect(narrow.overflow, id).toBe('auto'); expect(narrow.left, id).toBeGreaterThanOrEqual(-1);
    expect(narrow.viewport, id).toBeLessThan(360);
    const end = await page.locator(`#${id} mjx-container`).evaluate((el: HTMLElement) => {
      el.scrollLeft = el.scrollWidth;
      const last = el.querySelector('mjx-labels mjx-mtd') ?? el.querySelector('mjx-math');
      return { scroll: el.scrollLeft, right: last!.getBoundingClientRect().right - el.getBoundingClientRect().right };
    });
    expect(end.scroll, id).toBeGreaterThan(0); expect(end.right, id).toBeLessThanOrEqual(2);
  }
  expect((await sizes(page, 'medium')).font).toBe(wide.font);
  const body = await page.locator('#body-math').evaluate(el => ({scroll:el.scrollWidth, width:el.clientWidth}));
  expect(body.scroll).toBe(body.width);
  const scroller = page.locator('#medium mjx-container');
  const thumb = await scroller.evaluate((el: HTMLElement) => {
    el.scrollLeft = 0;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + el.clientWidth * el.clientWidth / el.scrollWidth / 2, y: rect.bottom - 4, bar: el.offsetHeight - el.clientHeight };
  });
  expect(thumb.bar).toBeGreaterThan(0);
  await page.mouse.move(thumb.x, thumb.y); await page.mouse.down(); await page.mouse.move(thumb.x + 60, thumb.y, { steps: 6 }); await page.mouse.up();
  expect(await scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  expect(await page.locator('#inline-math mjx-container').evaluate(el => getComputedStyle(el).overflowX)).not.toBe('auto');
  expect(await page.locator('#outside-preview mjx-container').evaluate(el => getComputedStyle(el).overflowX)).not.toBe('auto');
  await page.locator('#editor').screenshot({path: `.qa/body-math-${mode}.png`});
  await page.locator('#editor').evaluate(el => el.style.width = '900px');
  const restored = await sizes(page, 'medium'); expect(restored.content).toBe(restored.viewport);
  expect((await sizes(page, 'tagged')).content).toBe((await sizes(page, 'tagged')).viewport);
});

test('body scrolling has a persistent independent toggle and cleans up on unload', async ({ page }) => {
  await fixture(page, 'live');
  const inlineStyle = await page.locator('#tagged mjx-container').getAttribute('style');
  await page.evaluate(() => window.lab.showSettings());
  const toggle = page.getByRole('checkbox', {name:'正文长公式横向滚动', exact:true});
  await expect(toggle).toBeChecked(); await toggle.uncheck();
  expect((await sizes(page,'tagged')).overflow).not.toBe('auto');
  expect(await page.evaluate(async () => (await window.lab.reloadSettings()).bodyMathScroll)).toBe(false);
  await toggle.check(); expect((await sizes(page,'tagged')).overflow).toBe('auto');
  expect(await page.locator('#tagged mjx-container').getAttribute('style')).toBe(inlineStyle);
  await page.evaluate(() => window.lab.plugin.onunload());
  await expect(page.locator('.reflo-body-math-scroll')).toHaveCount(0);
  expect((await sizes(page,'tagged')).overflow).not.toBe('auto');
});
