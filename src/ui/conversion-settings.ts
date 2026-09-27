import type ReferenceBuoysPlugin from '../main';
import { kindName, type TargetKind } from '../core/model';
import { matchSelectedReference, PRESET_TEMPLATES, templateError, type ConversionProfile, type DragModifier } from '../core/conversion';

export function renderConversionSettings(parent: HTMLElement, host: ReferenceBuoysPlugin): void {
  const root = parent.createDiv({ cls: 'reflo-conversion-settings' });
  const save = () => { void host.saveSettings(); };
  const select = (parent: HTMLElement, label: string, options: Array<[string, string]>, value: string) => {
    const el = parent.createEl('select', { attr: { 'aria-label': label } });
    for (const [value, text] of options) el.createEl('option', { text, value });
    el.value = value;
    return el;
  };
  const draw = () => {
    root.empty();
    root.createEl('h3', { text: '选中转换' });
    root.createEl('p', { cls: 'setting-item-description', text: '拖选一个完整引用，执行“转换选中的引用”。可在 Obsidian 的快捷键设置中绑定按键，也可以使用右键菜单。' });
    const dragRow = root.createDiv({ cls: 'reflo-conversion-row' });
    dragRow.createSpan({ text: '按住修饰键拖选' });
    const drag = select(dragRow, '拖选转换修饰键', [['off', '关闭'], ['Alt', 'Alt（默认）'], ['Control', 'Ctrl']], host.settings.dragConversion);
    drag.addEventListener('change', () => { host.settings.dragConversion = drag.value as DragModifier; save(); });
    root.createEl('p', { cls: 'setting-item-description', text: '按住修饰键，左键拖选引用，松开鼠标即可转换。松开修饰键或按 Esc 可取消这次转换。Ctrl+Z 撤销。' });

    const profiles = host.settings.conversionProfiles;
    const profile = profiles.find(p => p.id === host.settings.activeConversionProfile) ?? profiles[0];
    const groupRow = root.createDiv({ cls: 'reflo-conversion-row' });
    groupRow.createSpan({ text: '当前模板组' });
    const groups = select(groupRow, '当前模板组', profiles.map(p => [p.id, p.name || '未命名']), profile.id);
    groups.addEventListener('change', () => { host.settings.activeConversionProfile = groups.value; save(); draw(); });
    const addGroup = groupRow.createEl('button', { text: '新建模板组', attr: { type: 'button' } });
    addGroup.addEventListener('click', () => {
      const profile: ConversionProfile = { id: `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: '新模板组', includePresets: true, templates: [] };
      profiles.push(profile); host.settings.activeConversionProfile = profile.id;
      save(); draw(); root.querySelector<HTMLInputElement>('[aria-label="模板组名称"]')?.select();
    });
    const nameRow = root.createDiv({ cls: 'reflo-conversion-row' });
    const name = nameRow.createEl('input', { type: 'text', value: profile.name, attr: { 'aria-label': '模板组名称', placeholder: '例如：电动力学教材' } });
    name.addEventListener('input', () => { profile.name = name.value; groups.selectedOptions[0].textContent = name.value || '未命名'; });
    name.addEventListener('change', save);
    const removeGroup = nameRow.createEl('button', { text: '删除此组', attr: { type: 'button' } });
    removeGroup.disabled = profiles.length <= 1;
    removeGroup.addEventListener('click', () => {
      host.settings.conversionProfiles = profiles.filter(p => p.id !== profile.id);
      host.settings.activeConversionProfile = host.settings.conversionProfiles[0].id;
      save(); draw();
    });
    const presetsLabel = root.createEl('label', { cls: 'reflo-conversion-row' });
    const presets = presetsLabel.createEl('input', { type: 'checkbox' }); presets.checked = profile.includePresets;
    presetsLabel.createSpan({ text: '包含常用预设' });
    const details = root.createEl('details', { cls: 'reflo-conversion-presets' });
    details.createEl('summary', { text: '查看预设模板' });
    for (const kind of ['equation', 'figure', 'table', 'addon'] as const) {
      details.createEl('p', { text: `${kindName[kind]}：${PRESET_TEMPLATES.filter(t => t.kind === kind).map(t => t.pattern).join('、')}` });
    }

    root.createEl('p', { cls: 'setting-item-description', text: '自定义模板用 {n} 表示编号，例如 Eq. ({n})。括号兼容全角和半角；一次只匹配整个选区。模板组可以按书命名并反复使用。' });
    const rows = root.createDiv({ cls: 'reflo-conversion-templates' });
    let refreshSample = () => {};
    profile.templates.forEach((template, i) => {
      const wrap = rows.createDiv();
      const row = wrap.createDiv({ cls: 'reflo-conversion-row' });
      const kind = select(row, `模板 ${i + 1} 的类型`, Object.entries(kindName), template.kind);
      const pattern = row.createEl('input', { type: 'text', value: template.pattern, attr: { 'aria-label': `模板 ${i + 1}`, placeholder: '例如：方程({n})' } });
      const remove = row.createEl('button', { text: '移除', attr: { type: 'button', 'aria-label': `移除模板 ${i + 1}` } });
      const error = wrap.createDiv({ cls: 'reflo-conversion-error', attr: { 'aria-live': 'polite' } });
      const validate = () => {
        const message = templateError(template.pattern);
        error.textContent = message ?? ''; error.hidden = !message;
        pattern.setAttribute('aria-invalid', String(Boolean(message)));
      };
      validate();
      pattern.addEventListener('input', () => { template.pattern = pattern.value; validate(); refreshSample(); });
      pattern.addEventListener('change', save);
      kind.addEventListener('change', () => { template.kind = kind.value as TargetKind; refreshSample(); save(); });
      remove.addEventListener('click', () => { profile.templates.splice(i, 1); save(); draw(); });
    });
    const add = root.createEl('button', { text: '添加模板', attr: { type: 'button' } });
    add.addEventListener('click', () => {
      profile.templates.push({ kind: 'equation', pattern: '' }); save(); draw();
      root.querySelector<HTMLInputElement>(`[aria-label="模板 ${profile.templates.length}"]`)?.focus();
    });

    const test = root.createDiv({ cls: 'reflo-conversion-test' });
    test.createEl('label', { text: '试配一段引用' });
    const sample = test.createEl('input', { type: 'text', value: '式（1.13a）', attr: { 'aria-label': '试配引用', placeholder: '粘贴原书中的引用文字' } });
    const output = test.createEl('output', { attr: { 'aria-live': 'polite' } });
    refreshSample = () => {
      const matches = matchSelectedReference(sample.value, profile);
      output.textContent = matches.length === 1 ? `→ ${matches[0].replacement}` : matches.length ? `有多个结果：${matches.map(m => m.replacement).join('、')}` : '未匹配；请检查模板或添加一个自定义模板。';
    };
    sample.addEventListener('input', refreshSample);
    presets.addEventListener('change', () => { profile.includePresets = presets.checked; refreshSample(); save(); });
    refreshSample();
  };
  draw();
}
