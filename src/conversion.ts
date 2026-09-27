import { Modal, Notice, editorInfoField, type Editor } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import type ReferenceBuoysPlugin from './main';
import { indexField } from './editor';
import { matchSelectedReference, type ConversionMatch } from './core/conversion';

export class SelectionConverter {
  private modal?: Modal;
  private disposed = false;
  constructor(private host: ReferenceBuoysPlugin) {}

  convertEditor(editor: Editor): void {
    const cm = this.host.cmForEditor(editor);
    if (cm) this.convert(cm);
    else new Notice('请在笔记编辑区选中一处引用后再转换。');
  }

  convert(cm: EditorView): void {
    if (this.disposed) return;
    this.modal?.close(); this.modal = undefined;
    if (cm.state.readOnly || !cm.state.facet(EditorView.editable)) return;
    const { selection, doc } = cm.state;
    const range = selection.main;
    if (range.empty || selection.ranges.length !== 1) { new Notice('请选中一个完整引用，例如 式（1.13a）。'); return; }
    const index = cm.state.field(indexField);
    const overlaps = (r: { from: number; to: number }) => r.from < range.to && range.from < r.to;
    if (index.excluded.some(overlaps)) { new Notice('代码和公式内容保持原样，请选中正文中的引用。'); return; }
    if (index.references.some(overlaps)) { new Notice('所选内容已包含标准引用。'); return; }
    const profile = this.host.settings.conversionProfiles.find(p => p.id === this.host.settings.activeConversionProfile)
      ?? this.host.settings.conversionProfiles[0];
    const matches = matchSelectedReference(doc.sliceString(range.from, range.to), profile);
    if (!matches.length) { new Notice('所选内容不匹配当前模板。可在“引用浮标 → 选中转换”中添加模板。'); return; }
    const path = cm.state.field(editorInfoField, false)?.file?.path;
    const apply = (match: ConversionMatch) => {
      if (!cm.dom.isConnected || cm.state.readOnly || !cm.state.facet(EditorView.editable)
        || cm.state.doc !== doc || !cm.state.selection.eq(selection)
        || cm.state.field(editorInfoField, false)?.file?.path !== path) {
        new Notice('选区或笔记已变化，请重新选中后转换。'); return;
      }
      this.host.previews.closeTransient();
      cm.dispatch({ changes: { from: range.from, to: range.to, insert: match.replacement },
        selection: { anchor: range.from },
        annotations: isolateHistory.of('full'), userEvent: 'input.reflo-convert' });
      cm.focus();
    };
    if (matches.length === 1) apply(matches[0]);
    else {
      this.modal = new ConversionChoice(this.host, matches, apply);
      this.modal.open();
    }
  }
  destroy(): void { this.disposed = true; this.modal?.close(); this.modal = undefined; }
}

class ConversionChoice extends Modal {
  constructor(host: ReferenceBuoysPlugin, private matches: ConversionMatch[], private choose: (match: ConversionMatch) => void) { super(host.app); }
  onOpen(): void {
    this.titleEl.setText('选择转换结果');
    this.contentEl.createEl('p', { text: '当前模板有多个匹配结果。' });
    for (const match of this.matches) {
      const button = this.contentEl.createEl('button', { cls: 'reflo-conversion-choice', text: `${match.template} → ${match.replacement}` });
      button.addEventListener('click', () => { this.choose(match); this.close(); });
    }
  }
  onClose(): void { this.contentEl.empty(); }
}
