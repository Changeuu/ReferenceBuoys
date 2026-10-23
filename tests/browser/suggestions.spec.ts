import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});

test('short-prefix suggestions include and insert each reported label after 40 numeric tags', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { cm, suggest, view, file } = window.lab;
    const labels = ['1.1.b', '1.1.52c', '1.1.Gauss'];
    const math = [...Array.from({ length: 40 }, (_, i) => `1.${i + 1}`), ...labels]
      .map(label => `$$ x=1 \\tag{${label}} $$`).join('\n\n');
    window.lab.replace(0, cm.state.doc.length, math);
    return labels.map(label => {
      window.lab.replace(cm.state.doc.length, cm.state.doc.length, '\n\n@{1.}');
      const trigger = suggest.onTrigger({ line: cm.state.doc.lines - 1, ch: 4 }, view.editor, file);
      const context = { ...trigger, editor: view.editor, file };
      const candidates = suggest.getSuggestions(context);
      suggest.context = context;
      const candidate = candidates.find((t: any) => t.label === label);
      if (candidate) suggest.selectSuggestion(candidate);
      return { label, count: candidates.length, limit: suggest.limit, position: candidates.indexOf(candidate),
        inserted: cm.state.doc.line(cm.state.doc.lines).text, cursor: view.editor.getCursor().ch };
    });
  });
  for (const item of result) {
    expect(item.count).toBe(43); expect(item.limit).toBeGreaterThanOrEqual(item.count);
    expect(item.position).toBeGreaterThanOrEqual(0); expect(item.position).toBeLessThan(5);
    expect(item.inserted).toBe(`@{${item.label}}`); expect(item.cursor).toBe(item.inserted.length);
  }
});

test('a long candidate list renders math on scroll and keeps late named labels selectable', async ({ page }) => {
  const count = await page.evaluate(() => {
    const { cm, suggest, view, file } = window.lab;
    const math = [...Array.from({ length: 160 }, (_, i) => `1.1.${i}`), '1.1.Gauss']
      .map(label => `$$ x=1 \\tag{${label}} $$`).join('\n\n');
    window.lab.replace(0, cm.state.doc.length, math + '\n\n@{1.}');
    const trigger = suggest.onTrigger({ line: cm.state.doc.lines - 1, ch: 4 }, view.editor, file);
    const context = { ...trigger, editor: view.editor, file }; suggest.context = context;
    const candidates = suggest.getSuggestions(context);
    // EditorSuggest itself belongs to Obsidian. This scroll container exercises
    // our renderer with real IntersectionObserver and MathJax in the browser.
    const list = document.body.createDiv({ cls: 'test-suggest-list' });
    Object.assign(list.style, { position: 'fixed', top: '20px', left: '20px', width: '440px', height: '240px', overflow: 'auto', background: 'white', zIndex: '10000' });
    for (const candidate of candidates) {
      const el = list.createDiv(); el.dataset.label = candidate.label;
      suggest.renderSuggestion(candidate, el);
      el.addEventListener('click', () => suggest.selectSuggestion(candidate));
    }
    return candidates.length;
  });
  expect(count).toBe(161);
  const list = page.locator('.test-suggest-list');
  await expect(list.locator('[data-label="1.1.0"] mjx-container')).toHaveCount(1);
  await expect(list.locator('[data-label="1.1.Gauss"] mjx-container')).toHaveCount(0);
  expect(await list.locator('mjx-container').count()).toBeLessThan(20);
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const last = list.locator('[data-label="1.1.Gauss"]');
  await expect(last.locator('mjx-container')).toHaveCount(1);
  await expect(last.locator('mjx-assistive-mml')).toContainText('1.1.Gauss');
  await last.click();
  expect(await page.evaluate(() => window.lab.cm.state.doc.line(window.lab.cm.state.doc.lines).text)).toBe('@{1.1.Gauss}');
});

test('changing queries, closing suggestions and unloading disconnect pending math work', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { cm, suggest, view, file, plugin } = window.lab;
    window.lab.replace(cm.state.doc.length, cm.state.doc.length, '\n\n@{1.}');
    const trigger = suggest.onTrigger({ line: cm.state.doc.lines - 1, ch: 4 }, view.editor, file);
    const context = { ...trigger, editor: view.editor, file };
    const target = suggest.getSuggestions(context)[0];
    const old = document.createElement('div'); suggest.renderSuggestion(target, old);
    suggest.getSuggestions({ ...context, query: 'Gauss' }); document.body.appendChild(old);
    const closed = document.createElement('div'); suggest.renderSuggestion(target, closed);
    suggest.close(); document.body.appendChild(closed);
    const unloaded = document.createElement('div'); suggest.renderSuggestion(target, unloaded);
    plugin.onunload(); plugin.unload(); document.body.appendChild(unloaded);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return [old, closed, unloaded].map(el => el.querySelectorAll('mjx-container').length);
  });
  expect(result).toEqual([0, 0, 0]);
});
