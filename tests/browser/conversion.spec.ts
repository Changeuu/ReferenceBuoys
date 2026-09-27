import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});
const source = '由式（1.13a）可得结论。\n另一处式（1.13a）保持原样。\n\n$$ p=mv \\tag{1.13a} $$';
async function prepare(page: Page, text = source) {
  await page.evaluate(text => {
    const { cm } = window.lab;
    window.lab.replace(0, cm.state.doc.length, text);
    cm.dispatch({ selection: { anchor: 0 } }); cm.scrollDOM.scrollTop = 0;
  }, text);
}
async function doc(page: Page) { return page.evaluate(() => window.lab.cm.state.doc.toString()); }
async function selectText(page: Page, text: string, occurrence = 0) {
  await page.evaluate(({ text, occurrence }) => {
    const { cm } = window.lab; const source = cm.state.doc.toString();
    let from = -1;
    for (let i = 0; i <= occurrence; i++) from = source.indexOf(text, from + 1);
    cm.dispatch({ selection: { anchor: from, head: from + text.length } }); cm.focus();
  }, { text, occurrence });
}
async function drag(page: Page, from: number, to: number, modifier?: 'Alt' | 'Control', cancel?: 'key' | 'escape') {
  const coords = await page.evaluate(({ from, to }) => {
    const { cm } = window.lab;
    const a = cm.coordsAtPos(from), b = cm.coordsAtPos(to);
    return { ax: a.left, ay: (a.top + a.bottom) / 2, bx: b.left, by: (b.top + b.bottom) / 2 };
  }, { from, to });
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(coords.ax, coords.ay); await page.mouse.down();
  await page.mouse.move(coords.bx, coords.by, { steps: 12 });
  if (cancel === 'key' && modifier) await page.keyboard.up(modifier);
  if (cancel === 'escape') await page.keyboard.press('Escape');
  await page.mouse.up();
  if (modifier && cancel !== 'key') await page.keyboard.up(modifier);
}

test('ordinary drag only selects; command converts exactly that reference and Ctrl+Z restores it', async ({ page }) => {
  await prepare(page);
  await drag(page, 1, 1 + '式（1.13a）'.length);
  expect(await doc(page)).toBe(source);
  await page.keyboard.press('Control+Alt+r');
  expect(await doc(page)).toBe(source.replace('式（1.13a）', '@{1.13a}'));
  await expect(page.locator('.reflo-reference')).toHaveCount(1);
  await page.keyboard.press('Control+z'); expect(await doc(page)).toBe(source);
  await page.keyboard.press('Control+y'); expect(await doc(page)).toBe(source.replace('式（1.13a）', '@{1.13a}'));
});

test('Alt drag converts on release in either direction and keeps later typing separate in undo', async ({ page }) => {
  await prepare(page);
  await drag(page, 1, 1 + '式（1.13a）'.length, 'Alt');
  await expect.poll(() => doc(page)).toBe(source.replace('式（1.13a）', '@{1.13a}'));
  await page.keyboard.insertText('新');
  await page.keyboard.press('Control+z'); expect(await doc(page)).toBe(source.replace('式（1.13a）', '@{1.13a}'));
  await page.keyboard.press('Control+z'); expect(await doc(page)).toBe(source);
  await page.evaluate(() => window.lab.cm.dispatch({ selection: { anchor: 0 } }));
  await drag(page, 1 + '式（1.13a）'.length, 1, 'Alt');
  await expect.poll(() => doc(page)).toBe(source.replace('式（1.13a）', '@{1.13a}'));
});

test('releasing Alt early or pressing Escape cancels conversion', async ({ page }) => {
  await prepare(page);
  await drag(page, 1, 1 + '式（1.13a）'.length, 'Alt', 'key');
  await page.waitForTimeout(60); expect(await doc(page)).toBe(source);
  await page.evaluate(() => window.lab.cm.dispatch({ selection: { anchor: 0 } }));
  await drag(page, 1, 1 + '式（1.13a）'.length, 'Alt', 'escape');
  await page.waitForTimeout(60); expect(await doc(page)).toBe(source);
});

test('disabled gestures, clicks and a wrong modifier leave text alone', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => window.lab.plugin.settings.dragConversion = 'off');
  await drag(page, 1, 1 + '式（1.13a）'.length, 'Alt');
  expect(await doc(page)).toBe(source);
  await page.evaluate(() => { window.lab.plugin.settings.dragConversion = 'Control'; window.lab.cm.dispatch({ selection: { anchor: 0 } }); });
  await drag(page, 1, 1 + '式（1.13a）'.length, 'Alt');
  expect(await doc(page)).toBe(source);
  await page.evaluate(() => window.lab.cm.dispatch({ selection: { anchor: 0 } }));
  await drag(page, 1, 1, 'Control');
  expect(await doc(page)).toBe(source);
  await drag(page, 1, 1 + '式（1.13a）'.length, 'Control');
  await expect.poll(() => doc(page)).toBe(source.replace('式（1.13a）', '@{1.13a}'));
});

test('sentences, multiple refs, code, math and existing tokens never trigger replacement', async ({ page }) => {
  const text = '由式1.3可知\n式1.3、式1.4\n`式1.3`\n$$ \\text{式1.3} $$\n@{1.3}\n\n式1.3';
  await prepare(page, text);
  for (const selection of ['由式1.3可知', '式1.3、式1.4', '`式1.3`', '$$ \\text{式1.3} $$', '@{1.3}']) {
    await selectText(page, selection);
    await page.keyboard.press('Control+Alt+r'); expect(await doc(page)).toBe(text);
  }
  await page.evaluate(() => window.lab.cm.dispatch({ selection: { anchor: 0 } }));
  await page.keyboard.press('Control+Alt+r'); expect(await doc(page)).toBe(text);
});

test('conflicting templates require an explicit choice and stale choices cannot edit a changed document', async ({ page }) => {
  await prepare(page, '式1.3');
  await page.evaluate(() => window.lab.plugin.settings.conversionProfiles[0].templates.push({ pattern: '式{n}', kind: 'figure' }));
  await selectText(page, '式1.3'); await page.keyboard.press('Control+Alt+r');
  await expect(page.locator('.reflo-conversion-choice')).toHaveCount(2); expect(await doc(page)).toBe('式1.3');
  await page.getByRole('button', { name: '式{n} → @fig{1.3}', exact: true }).click();
  expect(await doc(page)).toBe('@fig{1.3}');
  await page.evaluate(() => window.lab.undo());
  await selectText(page, '式1.3'); await page.keyboard.press('Control+Alt+r');
  await page.evaluate(() => window.lab.replace(0, 0, '新增'));
  await page.getByRole('button', { name: '式{n} → @fig{1.3}', exact: true }).click();
  expect(await doc(page)).toBe('新增式1.3');
  expect(await page.evaluate(() => (window as any).notices.at(-1))).toContain('已变化');
});

test('template groups can be created, tested, switched, persisted and used for conversion', async ({ page }) => {
  await prepare(page, '方程［2.13b］');
  await page.evaluate(() => window.lab.showConversionSettings());
  await page.getByRole('button', { name: '新建模板组', exact: true }).click();
  await page.getByRole('textbox', { name: '模板组名称', exact: true }).fill('电动力学');
  await page.getByRole('checkbox', { name: '包含常用预设', exact: true }).uncheck();
  await page.getByRole('button', { name: '添加模板', exact: true }).click();
  await page.getByRole('textbox', { name: '模板 1', exact: true }).fill('方程[{n}]');
  await page.getByRole('textbox', { name: '试配引用', exact: true }).fill('方程［2.13b］');
  await expect(page.locator('output')).toHaveText('→ @{2.13b}');
  const groupId = await page.getByRole('combobox', { name: '当前模板组', exact: true }).inputValue();
  await page.getByRole('combobox', { name: '当前模板组', exact: true }).selectOption('default');
  await page.getByRole('combobox', { name: '当前模板组', exact: true }).selectOption(groupId);
  await expect(page.getByRole('textbox', { name: '模板 1', exact: true })).toHaveValue('方程[{n}]');
  await page.getByRole('textbox', { name: '试配引用', exact: true }).fill('方程［2.13b］');
  await page.locator('.test-modal').screenshot({ path: '.qa/conversion-settings.png', animations: 'disabled' });
  expect(await page.evaluate(() => (window as any).savedData.settings.conversionProfiles.at(-1).templates[0].pattern)).toBe('方程[{n}]');
  await page.locator('.test-modal').evaluate(el => el.remove());
  await selectText(page, '方程［2.13b］'); await page.keyboard.press('Control+Alt+r');
  expect(await doc(page)).toBe('@{2.13b}');
});

test('multiple selections and read-only notes cannot be converted', async ({ page }) => {
  await prepare(page, '式1.3\n式1.4');
  await page.evaluate(() => {
    const { cm, EditorSelection } = window.lab;
    cm.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 4), EditorSelection.range(5, 9)]) });
    cm.focus();
  });
  await page.keyboard.press('Control+Alt+r'); expect(await doc(page)).toBe('式1.3\n式1.4');
  await selectText(page, '式1.3');
  await page.evaluate(() => window.lab.setReadOnly(true));
  await page.keyboard.press('Control+Alt+r'); expect(await doc(page)).toBe('式1.3\n式1.4');
  await page.evaluate(() => window.lab.setReadOnly(false));
  await page.keyboard.press('Control+Alt+r'); expect(await doc(page)).toBe('@{1.3}\n式1.4');
});

test('Alt drag inside an old selection selects afresh without moving the selected paragraph', async ({ page }) => {
  await prepare(page);
  await selectText(page, source.split('\n')[0]);
  await drag(page, 1, 1 + '式（1.13a）'.length, 'Alt');
  await expect.poll(() => doc(page)).toBe(source.replace('式（1.13a）', '@{1.13a}'));
  await page.keyboard.press('Control+z'); expect(await doc(page)).toBe(source);
});
