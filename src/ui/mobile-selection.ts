import { MarkdownView, editorInfoField } from 'obsidian';
import { EditorView } from '@codemirror/view';
import type { EditorSelection, Text } from '@codemirror/state';
import type ReferenceBuoysPlugin from '../main';
import { bindTouchButton, iconButton } from './dom';

interface SelectionSnapshot { cm: EditorView; doc: Text; selection: EditorSelection; path: string }

/** A temporary touch entry point for actions that otherwise need editor commands. */
export class MobileSelectionActions {
  private root?: HTMLElement;
  private snapshot?: SelectionSnapshot;
  private dismissed?: SelectionSnapshot;
  private abort?: AbortController;
  constructor(private host: ReferenceBuoysPlugin) {}

  refresh(): void {
    const view = this.host.app.workspace.getActiveViewOfType(MarkdownView);
    const cm = view && this.host.cmForView(view);
    if (!this.host.settings.mobileSelectionActions || !view?.file || view.getMode() !== 'source' || !cm
      || cm.state.readOnly || !cm.state.facet(EditorView.editable) || cm.state.selection.ranges.length !== 1 || cm.state.selection.main.empty) {
      this.hide(); this.dismissed = undefined; return;
    }
    const current = { cm, doc: cm.state.doc, selection: cm.state.selection, path: view.file.path };
    if (this.same(this.dismissed, current)) { this.hide(); return; }
    if (!this.root || this.root.ownerDocument !== cm.dom.ownerDocument) this.create(cm.dom.ownerDocument);
    const wasHidden = this.root!.hidden;
    this.snapshot = current;
    this.root!.hidden = false;
    this.root!.ownerDocument.body.classList.add('reflo-selection-active');
    if (wasHidden) this.host.previews.hideForNavigation();
    this.position();
  }

  private create(doc: Document): void {
    this.destroy();
    const abort = this.abort = new AbortController(), signal = abort.signal;
    const root = this.root = doc.body.createDiv({ cls: 'reflo-mobile-selection', attr: { role: 'toolbar', 'aria-label': '引用选区工具' } });
    root.hidden = true;
    root.createEl('button', { text: '转换引用', attr: { type: 'button' } })
      .addEventListener('click', () => this.run('convert'), { signal });
    root.createEl('button', { text: '设为目标', attr: { type: 'button', 'aria-label': '将选中内容设为引用目标' } })
      .addEventListener('click', () => this.run('target'), { signal });
    const dismiss = iconButton(root, 'x', '收起选区工具', () => { this.dismissed = this.snapshot; this.hide(); });
    dismiss.removeAttribute('title');
    root.querySelectorAll('button').forEach(button => bindTouchButton(button, signal));
    // Keep Android's selected text intact while tapping outside the editor.
    root.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); }, { signal });
    root.addEventListener('mousedown', event => event.preventDefault(), { signal });
    root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.dismissed = this.snapshot; this.hide(); } }, { signal });
    const win = doc.defaultView!;
    win.addEventListener('resize', () => this.position(), { signal });
    win.visualViewport?.addEventListener('resize', () => this.position(), { signal });
    win.visualViewport?.addEventListener('scroll', () => this.position(), { signal });
  }

  private run(action: 'convert' | 'target'): void {
    const saved = this.snapshot;
    const view = this.host.app.workspace.getActiveViewOfType(MarkdownView);
    if (!saved || !saved.cm.dom.isConnected || !view || this.host.cmForView(view) !== saved.cm
      || saved.cm.state.field(editorInfoField, false)?.file?.path !== saved.path
      || saved.cm.state.doc !== saved.doc || !saved.cm.state.selection.eq(saved.selection)) { this.refresh(); return; }
    this.dismissed = saved; this.hide();
    if (action === 'convert') this.host.converter.convert(saved.cm);
    else this.host.targetMarker.markEditor(view.editor);
  }

  private same(a: SelectionSnapshot | undefined, b: SelectionSnapshot): boolean {
    return !!a && a.cm === b.cm && a.doc === b.doc && a.path === b.path && a.selection.eq(b.selection);
  }
  private position(): void {
    if (!this.root) return;
    const win = this.root.ownerDocument.defaultView!, viewport = win.visualViewport;
    const width = viewport?.width ?? win.innerWidth, height = viewport?.height ?? win.innerHeight;
    const bottom = Math.max(0, win.innerHeight - (viewport?.offsetTop ?? 0) - height) + 60;
    this.root.style.left = `${(viewport?.offsetLeft ?? 0) + 8}px`;
    this.root.style.maxWidth = `${Math.max(0, width - 16)}px`;
    this.root.style.setProperty('--reflo-mobile-bottom', `${bottom}px`);
  }
  private hide(): void {
    if (this.root) { this.root.hidden = true; this.root.ownerDocument.body.classList.remove('reflo-selection-active'); }
    this.snapshot = undefined;
  }
  destroy(): void { this.hide(); this.abort?.abort(); this.root?.remove(); this.root = undefined; this.dismissed = undefined; }
}
