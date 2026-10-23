import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const formula = readFileSync(new URL('../fixtures/multi-tag.tex', import.meta.url), 'utf8');
async function openFormula(page: Page, label = '2.1.36', math = formula) {
  await page.evaluate(async ({ math, label }) => {
    window.lab.reset();
    const { cm, plugin, file } = window.lab;
    window.lab.replace(cm.state.doc.length, cm.state.doc.length, `\n\n$$\n${math}\n$$\n\n@{${label}}\n`);
    const index = await window.lab.index();
    const ref = index.references.find((r: any) => r.label === label);
    await plugin.previews.open(document.querySelector('.reflo-reference'), ref, { path: file.path, from: ref.from, to: ref.to, cm });
  }, { math, label });
}
test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});

test('reported align highlights the exact body row in both focused and full previews', async ({ page }) => {
  for (const [label, semantic] of [['2.1.34', '代入'], ['2.1.35', '构造傅里叶逆变换'], ['2.1.36', '2.1.22']]) {
    await openFormula(page, label);
    const popup = page.locator('.reflo-preview');
    await popup.getByRole('button', { name: '固定此预览，留在旁边对照', exact: true }).click();
    const row = popup.locator('mjx-table > mjx-itable > .reflo-math-focus');
    const text = () => row.evaluate(el => `${el.textContent}${window.lab.mathText(el)}`.normalize('NFKC'));
    await expect(row).toHaveCount(1);
    expect(await text()).toContain(semantic);
    await expect(popup.locator('mjx-merror')).toHaveCount(0);
    await expect(popup.locator('mjx-assistive-mml')).toContainText('η');
    await expect(popup.locator('mjx-assistive-mml')).toContainText('省略');
    if (label === '2.1.36') {
      await expect(popup.locator('mjx-assistive-mml')).not.toContainText('2.1.35');
      await popup.screenshot({ path: '.qa/math-focused.png', animations: 'disabled' });
    }
    await popup.getByRole('button', { name: '展开完整公式组', exact: true }).click();
    await expect(popup.getByRole('button', { name: '聚焦引用', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(popup.locator('mjx-assistive-mml')).toContainText('2.1.34');
    await expect(popup.locator('mjx-assistive-mml')).toContainText('2.1.35');
    await expect(popup.locator('mjx-assistive-mml')).toContainText('2.1.36');
    await expect(row).toHaveCount(1); expect(await text()).toContain(semantic);
    if (label === '2.1.36') await popup.screenshot({ path: '.qa/math-full.png', animations: 'disabled' });
    await popup.getByRole('button', { name: '聚焦引用', exact: true }).click();
    await expect(row).toHaveCount(1); expect(await text()).toContain(semantic);
    await popup.getByRole('button', { name: '关闭预览', exact: true }).click();
  }
});

test('nested tables do not shift labeled-row mapping and uncertain mappings highlight only the tag', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderMath, finishRenderMath, highlightMathRow, mathText } = window.lab;
    const host = document.body.createDiv();
    host.appendChild(renderMath(String.raw`\begin{align}
      x&=0\notag\\
      &=\begin{cases}u&u>0\\-u&u<0\end{cases}\tag{nested}\\
      &=c\notag\\ &=d\notag\\ &=z\tag{last}
      \end{align}`, true));
    await finishRenderMath();
    highlightMathRow(host, { label: 'last' });
    const row = host.querySelector('mjx-table > mjx-itable > .reflo-math-focus');
    const correct = mathText(row);
    host.querySelectorAll('.reflo-math-focus').forEach((el: Element) => el.classList.remove('reflo-math-focus'));
    host.querySelector('mjx-labels mjx-mtd')!.remove();
    highlightMathRow(host, { label: 'last' });
    const fallback = { rows: host.querySelectorAll('mjx-table > mjx-itable > .reflo-math-focus').length,
      tags: host.querySelectorAll('mjx-labels .reflo-math-focus').length };
    host.remove(); return { correct, fallback };
  });
  expect(result.correct.normalize('NFKC')).toContain('z'); expect(result.correct.normalize('NFKC')).not.toContain('d');
  expect(result.fallback).toEqual({ rows: 0, tags: 1 });
});

test('inline label markup remains supported without matching a CHTML body cell as a tag', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const host = document.body.createDiv();
    host.innerHTML = '<mjx-mtable><mjx-mlabeledtr><mjx-mtd>(a)</mjx-mtd><mjx-mtd>x=1</mjx-mtd></mjx-mlabeledtr></mjx-mtable>';
    window.lab.highlightMathRow(host, { label: 'a' });
    const inline = host.querySelector('mjx-mlabeledtr')!.classList.contains('reflo-math-focus');
    host.empty();
    host.appendChild(window.lab.renderMath(String.raw`\begin{align}2.1&=x\tag{different}\\y&=z\tag{2.1}\end{align}`, true));
    await window.lab.finishRenderMath();
    window.lab.highlightMathRow(host, { label: '2.1' });
    const body = window.lab.mathText(host.querySelector('mjx-table > mjx-itable > .reflo-math-focus'));
    host.remove(); return { inline, body };
  });
  expect(result.inline).toBe(true); expect(result.body.normalize('NFKC')).toContain('z'); expect(result.body.normalize('NFKC')).not.toContain('x');
});

test('focused nested formulas render intact and pinned previews refresh after an edit', async ({ page }) => {
  const math = String.raw`\begin{align}
F(x)&=a\tag{n1}\\ &=b\notag\\ &=c\tag{n2}\\ &=d\notag\\
&=\begin{cases}x&x>0\\-x&x<0\end{cases}\tag{n3}
\end{align}`;
  await openFormula(page, 'n3', math);
  const popup = page.locator('.reflo-preview');
  await popup.getByRole('button', { name: '固定此预览，留在旁边对照', exact: true }).click();
  await expect(popup.locator('mjx-merror')).toHaveCount(0);
  await expect(popup.locator('mjx-assistive-mml')).toContainText('−x');
  await popup.getByRole('button', { name: '展开完整公式组', exact: true }).click();
  await page.evaluate(() => {
    const source = window.lab.cm.state.doc.toString(), at = source.lastIndexOf('F(x)');
    window.lab.replace(at, at + 4, 'G(x)');
  });
  await expect(popup.locator('mjx-assistive-mml')).toContainText('G');
  await expect(popup.getByRole('button', { name: '聚焦引用', exact: true })).toBeVisible();
  await popup.getByRole('button', { name: '聚焦引用', exact: true }).click();
  await expect(popup.locator('mjx-assistive-mml')).toContainText('G');
  await expect(popup.locator('mjx-assistive-mml')).toContainText('省略');
});

test('mobile focus, full-group toggle and minimized restoration remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mobile=1'); await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await openFormula(page);
  const popup = page.locator('.reflo-preview');
  await expect(popup.locator('mjx-assistive-mml')).toContainText('η');
  await popup.getByRole('button', { name: '展开完整公式组', exact: true }).click();
  await expect(popup.locator('mjx-assistive-mml')).toContainText('2.1.35');
  await popup.getByRole('button', { name: '收起预览', exact: true }).click();
  await expect(popup).toBeHidden();
  await page.getByRole('button', { name: '恢复预览：式 2.1.36', exact: true }).click();
  await expect(popup.getByRole('button', { name: '聚焦引用', exact: true })).toBeVisible();
  await popup.getByRole('button', { name: '聚焦引用', exact: true }).click();
  await expect(popup.locator('mjx-assistive-mml')).not.toContainText('2.1.35');
  const box = (await popup.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  await popup.screenshot({ path: '.qa/math-focused-mobile.png', animations: 'disabled' });
});
