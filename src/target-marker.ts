import { Component, MarkdownRenderer, Modal, Notice, editorInfoField, type Editor } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import type ReferenceBuoysPlugin from './main';
import { indexField } from './editor';
import { inferTarget, planTarget, targetSelection, type ContentKind, type TargetEdit, type TargetSelection } from './core/target-edit';
import type { DocumentIndex } from './core/model';

export class TargetMarker {
  private modal?: Modal;
  private disposed = false;
  constructor(private host: ReferenceBuoysPlugin) {}

  markEditor(editor: Editor): void {
    if (this.disposed) return;
    this.modal?.close(); this.modal = undefined;
    const cm = this.host.cmForEditor(editor);
    if (!cm || cm.state.readOnly || !cm.state.facet(EditorView.editable)) { new Notice('请在可编辑笔记中选中完整内容。'); return; }
    const { doc, selection } = cm.state;
    if (selection.ranges.length !== 1 || selection.main.empty) { new Notice('请先选中一条完整的定义或定理。'); return; }
    const source = doc.toString(), index = cm.state.field(indexField);
    const prepared = targetSelection(source, selection.main, index);
    if (prepared.error) { new Notice(prepared.error); return; }
    const path = cm.state.field(editorInfoField, false)?.file?.path;
    if (!path) return;
    this.modal = new TargetMarkerModal(this.host, source, prepared.selection!, index, path, edit => {
      if (this.disposed || !cm.dom.isConnected || cm.state.readOnly || !cm.state.facet(EditorView.editable)
        || cm.state.doc !== doc || !cm.state.selection.eq(selection)
        || cm.state.field(editorInfoField, false)?.file?.path !== path) {
        new Notice('选区或笔记已变化，请重新选中后标记。'); return false;
      }
      this.host.previews.closeTransient();
      cm.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: { anchor: edit.from },
        annotations: isolateHistory.of('full'), userEvent: 'input.reflo-target' });
      if (!this.host.isMobile) cm.focus();
      return true;
    });
    this.modal.open();
  }
  destroy(): void { this.disposed = true; this.modal?.close(); this.modal = undefined; }
}

class TargetMarkerModal extends Modal {
  private component?: Component;
  private revision = 0;
  constructor(private host: ReferenceBuoysPlugin, private source: string, private selection: TargetSelection,
    private index: DocumentIndex, private path: string, private apply: (edit: TargetEdit) => boolean) { super(host.app); }

  onOpen(): void {
    this.titleEl.setText('将选中内容设为引用目标');
    this.contentEl.addClass('reflo-target-editor');
    const inferred = inferTarget(this.selection.content);
    const row = this.contentEl.createDiv({ cls: 'reflo-conversion-row' });
    const kind = row.createEl('select', { attr: { 'aria-label': '目标类型' } });
    kind.createEl('option', { value: 'definition', text: '定义 def' });
    kind.createEl('option', { value: 'theorem', text: '定理 thm' }); kind.value = inferred.kind;
    const label = row.createEl('input', { type: 'text', value: inferred.label, attr: { 'aria-label': '目标编号', placeholder: '编号，例如 1.1.1' } });
    const result = this.contentEl.createDiv({ cls: 'reflo-target-result', attr: { role: 'status', 'aria-live': 'polite' } });
    this.contentEl.createEl('h3', { text: '内容预览' });
    const preview = this.contentEl.createDiv({ cls: 'reflo-target-preview markdown-rendered' });
    const details = this.contentEl.createEl('details');
    details.createEl('summary', { text: '查看将写入的 Markdown' });
    const code = details.createEl('pre');
    const actions = this.contentEl.createDiv({ cls: 'reflo-target-actions' });
    const cancel = actions.createEl('button', { text: '取消', attr: { type: 'button' } });
    const confirm = actions.createEl('button', { text: '确认标记', cls: 'mod-cta', attr: { type: 'button' } });
    let edit: TargetEdit | undefined;
    const refresh = async () => {
      const revision = ++this.revision;
      this.component?.unload(); this.component = undefined;
      preview.empty(); code.textContent = ''; confirm.disabled = true; edit = undefined;
      const plan = planTarget(this.source, this.selection, kind.value as ContentKind, label.value, this.index);
      if (plan.error) { result.textContent = plan.error; result.classList.add('is-error'); return; }
      edit = plan.edit!; confirm.disabled = false; result.classList.remove('is-error');
      result.textContent = `${edit.reference}${edit.wrapped ? ' · 多段内容将包入一个 Callout' : ''}`;
      code.textContent = edit.insert;
      const component = this.component = new Component(); component.load();
      const rendered = preview.ownerDocument.createElement('div');
      try {
        await MarkdownRenderer.render(this.host.app, edit.markdown, rendered, this.path, component);
        if (revision === this.revision) preview.appendChild(rendered);
      } catch {
        if (revision === this.revision) preview.createEl('pre', { text: edit.markdown });
      }
    };
    label.addEventListener('input', () => { void refresh(); });
    kind.addEventListener('change', () => { void refresh(); });
    cancel.addEventListener('click', () => this.close());
    confirm.addEventListener('click', () => { if (edit) { this.apply(edit); this.close(); } });
    void refresh();
    if (!inferred.label) label.focus();
  }
  onClose(): void { this.revision++; this.component?.unload(); this.component = undefined; this.contentEl.empty(); }
}
