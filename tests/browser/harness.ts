import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap, ViewPlugin, Decoration } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import { MarkdownView, Platform, TFile, editorInfoField, editorLivePreviewField, renderMath, finishRenderMath } from './obsidian-stub';
import ReferenceBuoysPlugin from '../../src/main';
import { ReferenceSuggest } from '../../src/suggest';
import { renderConversionSettings } from '../../src/ui/conversion-settings';
import { indexDocument } from '../../src/core/parser';
import { ReferenceSettingsTab } from '../../src/settings';

async function boot() {
  await window.MathJax.startup.promise;
  (window as any).notices = [];
  document.body.classList.toggle('is-mobile', Platform.isMobile);
  const source = await (await fetch('/examples/引用浮标体验.md')).text();
  const file = new TFile('引用浮标体验.md');
  const view = new MarkdownView(); view.file = file; view.contentEl = document.querySelector('#editor')!;
  const files = new Map<string, { file: TFile; source: string }>([[file.path, { file, source }]]);
  const events = new Map<string, Array<(...args: any[]) => void>>();
  const on = (name: string, fn: (...args: any[]) => void) => { events.set(name, [...events.get(name) ?? [], fn]); };
  const emit = (name: string, ...args: any[]) => { for (const fn of events.get(name) ?? []) fn(...args); };
  const leaf = { view, openFile: async (next: TFile) => {
    if (view.file) files.get(view.file.path)!.source = cm.state.doc.toString();
    view.file = next;
    cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: files.get(next.path)!.source }, selection: { anchor: 0 } });
    cm.scrollDOM.scrollTop = 0;
    plugin.refreshPanels();
  } }; view.leaf = leaf;
  const leaves = [leaf];
  let activeLeaf = leaf;
  const app: any = {
    vault: { on, getAbstractFileByPath: (path: string) => files.get(path)?.file,
      cachedRead: async (file: TFile) => file.path === view.file.path ? cm.state.doc.toString() : files.get(file.path)?.source },
    metadataCache: { getFirstLinkpathDest: (linkpath: string, sourcePath: string) => {
      const target = linkpath.replace(/\.md$/, '') + '.md';
      const local = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) + target;
      return files.get(local)?.file ?? files.get(target)?.file ?? [...files.values()].find(f => f.file.path.endsWith('/' + target))?.file;
    } },
    workspace: { on, getLeavesOfType: () => leaves, getActiveViewOfType: () => activeLeaf.view,
      getActiveFile: () => activeLeaf.view.file, setActiveLeaf: (value: any) => { activeLeaf = value; emit('active-leaf-change'); },
      getLeaf: () => activeLeaf, onLayoutReady: (fn: any) => setTimeout(fn, 0) }
  };
  const plugin = new ReferenceBuoysPlugin(app, { id: 'reference-buoys' } as any);
  await plugin.onload();
  (window as any).__info = view;
  const readOnly = new Compartment();
  const cm = new EditorView({ parent: view.contentEl, state: EditorState.create({ doc: source, extensions: [
    editorInfoField, editorLivePreviewField,
    EditorState.allowMultipleSelections.of(true), readOnly.of(EditorState.readOnly.of(false)),
    ...plugin.extensions,
    // Representative native CM link spans: plugin code must not replace them.
    ViewPlugin.fromClass(class {
      decorations: any;
      constructor(v: EditorView) { this.decorations = this.build(v); }
      update(u: any) { if (u.docChanged || u.selectionSet) this.decorations = this.build(u.view); }
      build(v: EditorView) {
        return Decoration.set(indexDocument(v.state.doc.toString()).headingLinks.map(r => {
          const text = v.state.doc.sliceString(r.from, r.to), pipe = text.indexOf('|');
          return Decoration.mark({ class: 'cm-hmd-internal-link' }).range(r.from + (pipe >= 0 ? pipe + 1 : 2), r.to - 2);
        }), true);
      }
    }, { decorations: v => v.decorations }),
    history(),
    keymap.of([{ key: 'Ctrl-Alt-r', run: () => { plugin.converter.convertEditor(view.editor); return true; } },
      // Test-only binding simulates a user assigning the new command in Obsidian.
      { key: 'Alt-d', run: () => { plugin.commands.find((c: any) => c.id === 'mark-selected-target').editorCallback(view.editor); return true; } },
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
    renderMath, finishRenderMath, app, files, leaf, leaves, emit,
    addPane: (path: string) => {
      const otherView = new MarkdownView(); otherView.file = files.get(path)!.file;
      otherView.contentEl = document.body.createDiv({ cls: 'test-other-pane' });
      Object.assign(otherView.contentEl.style, { height: '500px', width: '600px', position: 'relative' });
      (window as any).__info = otherView;
      const otherCM = new EditorView({ parent: otherView.contentEl, state: EditorState.create({ doc: path === view.file.path ? cm.state.doc.toString() : files.get(path)!.source,
        extensions: [editorInfoField, editorLivePreviewField, ...plugin.extensions, EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } })] }) });
      (window as any).__info = view;
      const otherLeaf: any = { view: otherView, openFile: async (file: TFile) => {
        files.get(otherView.file.path)!.source = otherCM.state.doc.toString(); otherView.file = file;
        otherCM.dispatch({ changes: { from: 0, to: otherCM.state.doc.length, insert: files.get(file.path)!.source }, selection: { anchor: 0 } });
      } };
      otherView.leaf = otherLeaf;
      otherView.editor = { getValue: () => otherCM.state.doc.toString(), getCursor: () => ({ line: 0, ch: 0 }),
        posToOffset: (p: any) => otherCM.state.doc.line(p.line + 1).from + p.ch,
        offsetToPos: (n: number) => { const line = otherCM.state.doc.lineAt(n); return { line: line.number - 1, ch: n - line.from }; } };
      leaves.push(otherLeaf); plugin.refreshPanels();
      return { view: otherView, cm: otherCM, leaf: otherLeaf };
    },
    addFile: (path: string, source: string) => { const file = new TFile(path); files.set(path, { file, source }); return file; },
    openFile: async (path: string) => { await leaf.openFile(files.get(path)!.file); },
    readingLink: async (href: string, lineStart = 0) => {
      const el = view.contentEl.createDiv({ cls: 'test-reading markdown-preview-view' });
      const anchor = el.createEl('a', { cls: 'internal-link', text: href, attr: { href, 'data-href': href, tabindex: '0' } });
      for (const process of plugin.processors) await process(el, { sourcePath: view.file.path, getSectionInfo: () => ({ lineStart }) });
      return anchor;
    },
    reloadSettings: async () => {
      const fresh = new ReferenceBuoysPlugin(app, { id: 'reference-buoys' } as any);
      await fresh.onload(); const settings = fresh.settings; fresh.onunload(); fresh.unload(); return settings;
    },
    showSettings: () => {
      const tab = new ReferenceSettingsTab(app, plugin);
      tab.containerEl = document.body.createDiv({ cls: 'test-modal' }); tab.display();
    },
    setReadOnly: (value: boolean) => cm.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(value)) }),
    undo: () => undo(cm), redo: () => redo(cm),
    showConversionSettings: () => {
      const el = document.createElement('div'); el.className = 'test-modal'; document.body.appendChild(el);
      renderConversionSettings(el, plugin);
    },
    reset: () => { plugin.previews.closeTransient(); plugin.clearBuoys(); cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: source }, selection: { anchor: 0 } }); cm.scrollDOM.scrollTop = 0; },
    index: () => plugin.getIndex(view.file.path),
    replace: (from: number, to: number, insert: string) => cm.dispatch({ changes: { from, to, insert } })
  };
  plugin.refreshPanels();
  document.documentElement.dataset.ready = 'true';
}
void boot().catch(error => { console.error(error); document.body.dataset.error = String(error); });
