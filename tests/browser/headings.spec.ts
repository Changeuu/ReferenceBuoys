import { test, expect } from '@playwright/test';

async function seed(page: any) {
  await page.evaluate(() => {
    const { cm, replace, addFile } = window.lab;
    replace(0, cm.state.doc.length, '# Reading\n\n看 [[B#Energy|能量章节]] 或 [[#Local|本节]]。\n\n'
      + '普通文字\n\n'.repeat(45) + '## Local\nLocal body\n### Child\nChild body\n## End\nOutside');
    addFile('B.md', '# B\n\n开头\n\n## Energy\nEnergy body\n\n$$E=mc^2$$\n\n[[C#Result|继续到 C]]\n\n'
      + '### Details\nDetails body\n## Other\nExcluded from preview');
    addFile('C.md', '# C\n\n## Result\nFinal body');
  });
}
test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await seed(page);
});

test('native Live Preview heading hover uses section bounds and suppresses a second hover', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).nativeHover = 0;
    document.addEventListener('mouseover', e => { if ((e.target as Element).closest('.cm-hmd-internal-link')) (window as any).nativeHover++; });
  });
  await page.locator('.cm-hmd-internal-link').filter({ hasText: '能量章节' }).hover();
  const popup = page.locator('.reflo-preview');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Details body');
  await expect(popup).not.toContainText('Excluded from preview');
  await expect(popup.locator('mjx-container')).toHaveCount(1);
  await expect(popup.getByRole('button', { name: '展开上下文' })).toBeHidden();
  await expect(popup.locator('.reflo-preview-body')).toHaveAttribute('data-render-path', 'B.md');
  expect(await page.evaluate(() => (window as any).nativeHover)).toBe(0);
  expect(await page.evaluate(() => window.lab.cm.state.doc.toString())).toContain('[[B#Energy|能量章节]]');
  await page.screenshot({ path: '.qa/heading-preview.png' });
});

test('A to B to C keeps the full return stack and consumes only the chosen marker', async ({ page }) => {
  await page.locator('.cm-hmd-internal-link').filter({ hasText: '能量章节' }).click();
  expect(await page.evaluate(() => window.lab.view.file.path)).toBe('B.md');
  await expect(page.locator('.reflo-buoy')).toHaveCount(1);
  await expect(page.locator('.reflo-buoy-go')).toContainText('引用浮标体验');
  await page.locator('.cm-hmd-internal-link').filter({ hasText: '继续到 C' }).click();
  expect(await page.evaluate(() => window.lab.view.file.path)).toBe('C.md');
  await expect(page.locator('.reflo-buoy')).toHaveCount(2);
  await page.screenshot({ path: '.qa/heading-return-stack.png' });
  await page.locator('.reflo-buoy-go').first().click();
  expect(await page.evaluate(() => window.lab.view.file.path)).toBe('B.md');
  await expect(page.locator('.reflo-buoy')).toHaveCount(1);
  await page.evaluate(() => window.lab.plugin.commands.find((c: any) => c.id === 'return-to-buoy').checkCallback(false));
  await expect.poll(() => page.evaluate(() => window.lab.view.file.path)).toBe('引用浮标体验.md');
  await expect(page.locator('.reflo-buoys')).toBeHidden();
  expect(await page.evaluate(() => window.lab.cm.state.doc.toString())).toContain('[[B#Energy|能量章节]]');
});

test('cross-note return restores a distant viewport and follows edits while away', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { plugin, cm, view, EditorView, files, emit } = window.lab;
    const offset = cm.state.doc.length;
    window.lab.replace(offset, offset, '\n\n[[B#Energy]]\n');
    cm.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: 'center' }) });
    await new Promise(r => setTimeout(r, 150));
    const beforeY = cm.coordsAtPos(offset)!.top;
    const ref = (await window.lab.index()).headingLinks.at(-1);
    await plugin.followHeading(cm.dom, ref, { path: view.file.path, from: ref.from, to: ref.to, cm });
    const point = plugin.returnPoints()[0], old = point.from;
    const record = files.get(point.path); record.source = '插入内容\n\n' + record.source;
    emit('modify', record.file);
    await new Promise(r => setTimeout(r, 100));
    const mapped = point.from - old;
    await plugin.returnTo(point, view);
    await new Promise(r => setTimeout(r, 250));
    return { mapped, beforeY, afterY: cm.coordsAtPos(offset + 6)!.top, count: plugin.returnPoints().length };
  });
  expect(result.mapped).toBe(6);
  expect(Math.abs(result.beforeY - result.afterY)).toBeLessThan(4);
  expect(result.count).toBe(0);
});

test('local sections work without changing source and missing targets leave no markers', async ({ page }) => {
  await page.locator('.cm-hmd-internal-link').filter({ hasText: '本节' }).click();
  await expect(page.locator('.reflo-buoy')).toHaveCount(1);
  await page.locator('.reflo-buoy-go').click();
  await page.evaluate(() => window.lab.replace(0, 0, '[[Missing#No]]\n[[B#Missing]]\n'));
  for (const text of ['Missing#No', 'B#Missing']) {
    await page.locator('.cm-hmd-internal-link').filter({ hasText: text }).click();
    await expect(page.locator('.reflo-preview')).toContainText('未找到这个章节');
    await expect(page.locator('.reflo-preview button[aria-label="跳到原文并留下返回浮标"]')).toBeDisabled();
    expect(await page.evaluate(() => window.lab.plugin.returnPoints().length)).toBe(0);
    await page.keyboard.press('Escape');
  }
});

test('modified clicks, editing a link and the disabled switch preserve native events', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { plugin, cm } = window.lab;
    const link = document.querySelector('.cm-hmd-internal-link')!;
    const native = (options: any = {}) => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
    const modified = ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'].map(key => native({ [key]: true }));
    plugin.settings.headingLinks = false;
    const disabled = native(); plugin.settings.headingLinks = true;
    cm.dispatch({ selection: { anchor: cm.state.doc.toString().indexOf('[[B#') + 4 } });
    const editing = native();
    return { modified, disabled, editing, count: plugin.returnPoints().length };
  });
  expect(result).toEqual({ modified: [true, true, true, true], disabled: true, editing: true, count: 0 });
});

test('Reading view aliases resolve from section offsets and support keyboard navigation', async ({ page }) => {
  await page.evaluate(async () => {
    await window.lab.readingLink('B#Energy', 2);
    const scroller = document.querySelector<HTMLElement>('.test-reading')!;
    Object.assign(scroller.style, { height: '100px', overflow: 'auto' });
    scroller.createDiv().style.height = '900px'; scroller.scrollTop = 50;
    window.lab.view.getMode = () => 'preview';
  });
  await page.locator('.test-reading .internal-link').focus();
  await expect(page.locator('.reflo-preview')).toContainText('Energy body');
  await page.locator('.test-reading .internal-link').press('Enter');
  expect(await page.evaluate(() => window.lab.view.file.path)).toBe('B.md');
  expect(await page.evaluate(() => window.lab.plugin.returnPoints()[0].from)).toBe(13);
  // Focusing the link may scroll it into view; the point uses the Reading scroller, not hidden CM.
  expect(await page.evaluate(() => window.lab.plugin.returnPoints()[0].viewportFrom)).toBe(13);
});

test('returns choose the original split pane; closed panes fall back to the current pane', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { plugin, cm, view, leaf, app, addPane, leaves } = window.lab;
    const duplicate = addPane(view.file.path);
    const ref = (await window.lab.index()).headingLinks[0];
    await plugin.followHeading(cm.dom, ref, { path: view.file.path, from: ref.from, to: ref.to, cm });
    app.workspace.setActiveLeaf(duplicate.leaf);
    await plugin.returnTo(plugin.returnPoints()[0], duplicate.view);
    const correctPane = app.workspace.getActiveViewOfType() === view;
    await plugin.followHeading(cm.dom, ref, { path: view.file.path, from: ref.from, to: ref.to, cm });
    const other = addPane('C.md');
    leaves.splice(leaves.indexOf(leaf), 1); leaves.splice(leaves.indexOf(duplicate.leaf), 1);
    cm.dom.remove(); duplicate.cm.dom.remove();
    app.workspace.setActiveLeaf(other.leaf); plugin.refreshPanels();
    await plugin.returnTo(plugin.returnPoints()[0], other.view);
    return { correctPane, fallback: other.view.file.path, count: plugin.returnPoints().length };
  });
  expect(result).toEqual({ correctPane: true, fallback: '引用浮标体验.md', count: 0 });
});

test('renaming a destination refreshes pinned previews; deletion disables jumping', async ({ page }) => {
  await page.locator('.cm-hmd-internal-link').filter({ hasText: '能量章节' }).hover();
  await page.locator('.reflo-preview').getByRole('button', { name: '固定此预览，留在旁边对照', exact: true }).click();
  await page.evaluate(() => {
    const { files, emit, plugin } = window.lab;
    const entry = files.get('B.md'); files.delete('B.md'); entry.file.path = 'Renamed.md'; files.set('Renamed.md', entry);
    emit('rename', entry.file, 'B.md'); plugin.previews.refresh();
  });
  await expect(page.locator('.reflo-preview-location')).toHaveText('Renamed');
  await page.evaluate(() => {
    const { files, emit } = window.lab;
    const entry = files.get('Renamed.md'); files.delete('Renamed.md'); emit('delete', entry.file);
  });
  await expect(page.locator('.reflo-preview')).toContainText('未找到这个章节');
  await expect(page.locator('.reflo-preview button[aria-label="跳到原文并留下返回浮标"]')).toBeDisabled();
});

test('failed cross-file opens preserve return markers and never create a failed-jump marker', async ({ page }) => {
  await page.evaluate(() => { window.lab.leaf.openFile = async () => { throw new Error('test open failure'); }; });
  await page.locator('.cm-hmd-internal-link').filter({ hasText: '能量章节' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).notices)).toContain('无法打开目标笔记，请重试。');
  expect(await page.evaluate(() => window.lab.plugin.returnPoints().length)).toBe(0);
});

test('mobile native heading links reuse the collapsible panel and compact cross-note returns', async ({ page }) => {
  await page.goto('/?mobile'); await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page.setViewportSize({ width: 412, height: 915 }); await seed(page);
  await page.locator('.cm-hmd-internal-link').filter({ hasText: '能量章节' }).click();
  const popup = page.locator('.reflo-preview');
  await expect(popup).toContainText('Energy body');
  await popup.getByRole('button', { name: '收起预览', exact: true }).click();
  await expect(popup).toBeHidden();
  await page.locator('.reflo-mobile-preview-tab').click();
  await popup.getByRole('button', { name: '跳到原文并留下返回浮标', exact: true }).click();
  expect(await page.evaluate(() => window.lab.view.file.path)).toBe('B.md');
  await expect(page.locator('.reflo-mobile-buoy')).toHaveText('↩ 1');
  await expect(page.locator('.reflo-mobile-preview-tab')).toBeVisible();
  await page.screenshot({ path: '.qa/heading-mobile.png' });
  await page.locator('.reflo-mobile-buoy').click();
  expect(await page.evaluate(() => window.lab.view.file.path)).toBe('引用浮标体验.md');
  await expect(page.locator('.reflo-mobile-buoy')).toHaveCount(0);
});
