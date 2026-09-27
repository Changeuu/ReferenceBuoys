import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import { MarkdownView, Platform, TFile, editorInfoField, editorLivePreviewField } from './obsidian-stub';
import ReferenceBuoysPlugin from '../../src/main';
import { ReferenceSuggest } from '../../src/suggest';
import { renderConversionSettings } from '../../src/ui/conversion-settings';

async function boot() {
  await window.MathJax.startup.promise;
  (window as any).notices = [];
  document.body.classList.toggle('is-mobile', Platform.isMobile);
  const source = await (await fetch('/examples/引用浮标体验.md')).text();
  const file = new TFile('引用浮标体验.md');
  const view = new MarkdownView(); view.file = file; view.contentEl = document.querySelector('#editor')!;
  const leaf = { view, openFile: async () => {} }; view.leaf = leaf;
  const app: any = {
    vault: { on: () => {}, getAbstractFileByPath: () => file, cachedRead: async () => window.lab?.cm.state.doc.toString() ?? source },
    workspace: { on: () => {}, getLeavesOfType: () => [leaf], getActiveViewOfType: () => view,
      getActiveFile: () => file, setActiveLeaf: () => {}, getLeaf: () => leaf, onLayoutReady: (fn: any) => setTimeout(fn, 0) }
  };
  const plugin = new ReferenceBuoysPlugin(app, { id: 'reference-buoys' } as any);
  await plugin.onload();
  (window as any).__info = view;
  const readOnly = new Compartment();
  const cm = new EditorView({ parent: view.contentEl, state: EditorState.create({ doc: source, extensions: [
    editorInfoField, editorLivePreviewField,
    EditorState.allowMultipleSelections.of(true), readOnly.of(EditorState.readOnly.of(false)),
    ...plugin.extensions,
    history(),
    keymap.of([{ key: 'Ctrl-Alt-r', run: () => { plugin.converter.convertEditor(view.editor); return true; } },
      { key: 'Mod-z', run: undo, shift: redo }, { key: 'Mod-y', run: redo }]),
    EditorView.lineWrapping,
    EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', fontSize: '16px', lineHeight: '1.85' }, '.cm-content': { padding: Platform.isMobile ? '20px 16px 160px' : '28px 50px 300px' } })
  ] }) });
  const offset = (pos: any) => cm.state.doc.line(pos.line + 1).from + pos.ch;
  const pos = (offset: number) => { const line = cm.state.doc.lineAt(offset); return { line: line.number - 1, ch: offset - line.from }; };
  view.editor = {
    getValue: () => cm.state.doc.toString(), getLine: (line: number) => cm.state.doc.line(line + 1).text,
    posToOffset: offset, offsetToPos: pos, getCursor: (side?: string) => pos(side === 'from' ? cm.state.selection.main.from : side === 'to' ? cm.state.selection.main.to : cm.state.selection.main.head),
    somethingSelected: () => cm.state.selection.ranges.some(r => !r.empty),
    replaceRange: (text: string, from: any, to = from) => cm.dispatch({ changes: { from: offset(from), to: offset(to), insert: text } }),
    replaceSelection: (text: string) => cm.dispatch(cm.state.replaceSelection(text)),
    setCursor: (position: any) => cm.dispatch({ selection: { anchor: offset(position) } }),
    focus: () => cm.focus()
  };
  const suggest = new ReferenceSuggest(plugin);
  window.lab = { plugin, cm, view, source, file, suggest, EditorView, EditorSelection,
    setReadOnly: (value: boolean) => cm.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(value)) }),
    undo: () => undo(cm), redo: () => redo(cm),
    showConversionSettings: () => {
      const el = document.createElement('div'); el.className = 'test-modal'; document.body.appendChild(el);
      renderConversionSettings(el, plugin);
    },
    reset: () => { plugin.previews.closeTransient(); plugin.clearBuoys(); cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: source }, selection: { anchor: 0 } }); cm.scrollDOM.scrollTop = 0; },
    index: () => plugin.getIndex(file.path),
    replace: (from: number, to: number, insert: string) => cm.dispatch({ changes: { from, to, insert } })
  };
  plugin.refreshPanels();
  document.documentElement.dataset.ready = 'true';
}
void boot().catch(error => { console.error(error); document.body.dataset.error = String(error); });
