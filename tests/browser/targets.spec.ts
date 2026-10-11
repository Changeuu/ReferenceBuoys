import { test, expect, type Page } from '@playwright/test';

const definition = '**定义 1.1.1** 这是完整定义。';
const theorem = '**定理 1.13a** 当以下条件成立。\n\n$$\nx^2+y^2=z^2 \\tag{3.1}\n$$\n\n- 条件一\n- 条件二';
async function prepare(page: Page, text: string, selected: string) {
  await page.evaluate(({text, selected}) => {
    const { cm } = window.lab; window.lab.replace(0,cm.state.doc.length,text);
    const from = text.indexOf(selected);
    cm.dispatch({selection:{anchor:from,head:from+selected.length}}); cm.focus();
  }, {text, selected});
}
const doc = (page: Page) => page.evaluate(() => window.lab.cm.state.doc.toString());
test.beforeEach(async ({ page }) => {
  await page.goto('/'); await expect(page.locator('html')).toHaveAttribute('data-ready','true');
});

test('select then invoke a user-bound shortcut: preview and cancel do not change the note; confirmation is one undo step', async ({ page }) => {
  const source = '前文\n' + definition + '\n后文\n\n根据 @def{1.1.1}。';
  await prepare(page,source,definition);
  await page.keyboard.press('Alt');
  await expect(page.locator('.reflo-target-editor')).toHaveCount(0); expect(await doc(page)).toBe(source);
  await page.keyboard.press('Alt+d');
  await expect(page.locator('.reflo-target-editor')).toHaveCount(1);
  await expect(page.getByRole('textbox',{name:'目标编号'})).toHaveValue('1.1.1');
  await expect(page.getByRole('combobox',{name:'目标类型'})).toHaveValue('definition');
  await expect(page.locator('.reflo-target-preview')).toContainText('这是完整定义');
  expect(await doc(page)).toBe(source);
  await page.getByRole('button',{name:'取消',exact:true}).click(); expect(await doc(page)).toBe(source);
  await page.evaluate(() => window.lab.cm.focus()); await page.keyboard.press('Alt+d');
  await page.getByRole('button',{name:'确认标记',exact:true}).click();
  expect(await doc(page)).toBe('前文\n\n'+definition+'\n\n@#def{1.1.1}\n\n后文\n\n根据 @def{1.1.1}。');
  await expect(page.locator('.reflo-definition')).toHaveText('（定义 1.1.1）');
  await page.keyboard.press('Control+z'); expect(await doc(page)).toBe(source);
  await page.keyboard.press('Control+y'); expect(await doc(page)).toContain('@#def{1.1.1}');
  expect(await page.evaluate(() => window.lab.plugin.commands.find((c: any)=>c.id==='mark-selected-target').hotkeys)).toBeUndefined();
});

test('a theorem with paragraphs, real MathJax and lists previews fully, then jumps and returns', async ({ page }) => {
  const source = theorem + '\n\n根据 @thm{1.13a} 得到结论。';
  await prepare(page,source,theorem); await page.keyboard.press('Alt+d');
  await expect(page.getByRole('combobox',{name:'目标类型'})).toHaveValue('theorem');
  await expect(page.locator('.reflo-target-preview mjx-container')).toHaveCount(1);
  await expect(page.locator('.reflo-target-preview mjx-math')).not.toContainText('>');
  await expect(page.locator('.reflo-target-preview li')).toHaveCount(2);
  await page.getByText('查看将写入的 Markdown',{exact:true}).click();
  await expect(page.locator('.reflo-target-editor pre')).toContainText('> [!theorem]');
  await page.locator('.test-modal').screenshot({path:'.qa/target-confirmation.png'});
  await page.getByRole('button',{name:'确认标记',exact:true}).click();
  const after = await doc(page); expect(after).toContain('> $$'); expect(after).toContain('@#thm{1.13a}');
  const ref = page.locator('.reflo-theorem'); await ref.hover();
  await expect(page.locator('.reflo-preview-body mjx-container')).toHaveCount(1);
  await expect(page.locator('.reflo-preview-body li')).toHaveCount(2);
  await ref.click(); await expect(page.locator('.reflo-buoy')).toHaveCount(1);
  await page.locator('.reflo-buoy-go').click(); await expect(page.locator('.reflo-buoy')).toHaveCount(0);
  expect(await doc(page)).toBe(after);
});

test('duplicate numbers disable confirmation, and a different kind can reuse the number', async ({ page }) => {
  const source = '已有\n@#def{1.1.1}\n\n'+definition;
  await prepare(page,source,definition); await page.keyboard.press('Alt+d');
  const confirm = page.getByRole('button',{name:'确认标记',exact:true});
  await expect(confirm).toBeDisabled(); await expect(page.locator('.reflo-target-result')).toContainText('已有定义');
  await page.getByRole('combobox',{name:'目标类型'}).selectOption('theorem');
  await expect(confirm).toBeEnabled(); await confirm.click();
  expect(await doc(page)).toContain('@#thm{1.1.1}');
});

test('stale confirmation, a partial selection and read-only state leave the source unchanged', async ({ page }) => {
  await prepare(page,definition,definition); await page.keyboard.press('Alt+d');
  await page.evaluate(() => window.lab.replace(0,0,'新内容\n\n'));
  await page.getByRole('button',{name:'确认标记',exact:true}).click();
  expect(await doc(page)).toBe('新内容\n\n'+definition);
  expect(await page.evaluate(() => (window as any).notices.at(-1))).toContain('已变化');
  await prepare(page,definition,'完整定义'); await page.keyboard.press('Alt+d');
  await expect(page.locator('.reflo-target-editor')).toHaveCount(0); expect(await doc(page)).toBe(definition);
  await prepare(page,definition,definition); await page.evaluate(() => window.lab.setReadOnly(true));
  await page.keyboard.press('Alt+d'); await expect(page.locator('.reflo-target-editor')).toHaveCount(0);
  expect(await doc(page)).toBe(definition);
});

test('typing or converting def/thm citations uses the right namespace in Live Preview and Reading view', async ({ page }) => {
  const source = `${definition}\n@#def{1.1.1}\n\n定理内容\n@#thm{1.1.1}\n\n在定义 1.1.1 中，由定理 1.1.1 可知。`;
  for (const [text, replacement] of [['定义 1.1.1','@def{1.1.1}'],['定理 1.1.1','@thm{1.1.1}']]) {
    await prepare(page,source,text);
    await page.evaluate(text => {
      const {cm}=window.lab; const from=cm.state.doc.toString().lastIndexOf(text);
      cm.dispatch({selection:{anchor:from,head:from+text.length}});cm.focus();
    },text);
    await page.keyboard.press('Control+Alt+r'); expect(await doc(page)).toBe(source.slice(0,source.lastIndexOf(text))+source.slice(source.lastIndexOf(text)).replace(text,replacement));
  }
  for (const [prefix,kind] of [['def','definition'],['thm','theorem']]) {
    const result=await page.evaluate(({prefix})=>{
      const {cm,view,file,suggest}=window.lab; const end=cm.state.doc.length;
      window.lab.replace(end,end,`\n@${prefix}{}`);
      const cursor=view.editor.offsetToPos(cm.state.doc.length-1);
      const trigger=suggest.onTrigger(cursor,view.editor,file);
      const context={...trigger,editor:view.editor,file};
      const candidates=suggest.getSuggestions(context); suggest.context=context;suggest.selectSuggestion(candidates[0]);
      return {kinds:candidates.map((t:any)=>t.kind),text:cm.state.doc.toString()};
    },{prefix});
    expect(result.kinds).toEqual([kind]);expect(result.text).toContain(`@${prefix}{1.1.1}`);
  }
  await page.evaluate(async()=>{
    const {plugin,file}=window.lab;const el=document.body.createDiv({cls:'test-reading'});el.textContent='@def{1.1.1} @thm{1.1.1}';
    await plugin.processors[0](el,{sourcePath:file.path,getSectionInfo:()=>null});
  });
  await expect(page.locator('.test-reading .reflo-reference')).toHaveText(['（定义 1.1.1）','（定理 1.1.1）']);
});

test('the new target command works on mobile without the desktop drag gesture', async ({ page }) => {
  await page.goto('/?mobile'); await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.setViewportSize({width:390,height:844});
  await prepare(page,definition+'\n\n@def{1.1.1}',definition);
  await page.evaluate(()=>window.lab.plugin.commands.find((c:any)=>c.id==='mark-selected-target').editorCallback(window.lab.view.editor));
  await expect(page.locator('.reflo-target-preview')).toContainText('完整定义');
  await page.getByRole('button',{name:'确认标记',exact:true}).click();
  await page.locator('.reflo-definition').click();
  await expect(page.locator('.reflo-mobile-preview')).toBeVisible();
  await expect(page.locator('.reflo-preview-body')).toContainText('完整定义');
});
