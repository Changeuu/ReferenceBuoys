import { Plugin, Platform, MarkdownView, TFile, Notice, Menu, editorInfoField, type Editor, type MarkdownPostProcessorContext } from 'obsidian';
import { ChangeSet } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { indexDocument, contextExcerpt, parseReference, REFERENCE_PATTERN } from './core/parser';
import { displayName, type DocumentIndex, type Reference, type Target } from './core/model';
import { contiguousEdit, mapReturnPoint, type ReturnPoint } from './core/anchors';
import { editorExtensions, flashEffect, indexField } from './editor';
import { DEFAULT_SETTINGS, ReferenceSettingsTab, type Settings } from './settings';
import { ReferenceSuggest } from './suggest';
import { PreviewManager, mathText, type ReferenceOrigin } from './ui/previews';
import { BuoyPanel } from './ui/buoys';
import { SelectionConverter } from './conversion';
import { loadProfiles } from './core/conversion';

export default class ReferenceBuoysPlugin extends Plugin {
  readonly isMobile = Platform.isMobile;
  settings: Settings = { ...DEFAULT_SETTINGS };
  readonly points = new Map<string, ReturnPoint[]>();
  previews!: PreviewManager;
  converter!: SelectionConverter;
  private cache = new Map<string, DocumentIndex>();
  private anchorSources = new Map<string, string>();
  private editors = new Map<EditorView, string>();
  private panels = new Map<MarkdownView, BuoyPanel>();
  private nextId = 1;
  private uiTimer?: number;
  private previewsPending = false;
  private disposed = false;
  private jumpGeneration = 0;

  async onload(): Promise<void> {
    const saved = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...(saved?.settings ?? {}) };
    this.settings.hoverDelay = Math.max(100, Math.min(900, Number(this.settings.hoverDelay) || 320));
    this.settings.previewWidth = Math.max(320, Math.min(760, Number(this.settings.previewWidth) || 460));
    this.settings.conversionProfiles = loadProfiles(saved?.settings?.conversionProfiles);
    if (!this.settings.conversionProfiles.some(p => p.id === this.settings.activeConversionProfile)) {
      this.settings.activeConversionProfile = this.settings.conversionProfiles[0].id;
    }
    if (!['off', 'Alt', 'Control'].includes(this.settings.dragConversion)) this.settings.dragConversion = 'Alt';
    this.previews = new PreviewManager(this);
    this.converter = new SelectionConverter(this);
    this.addSettingTab(new ReferenceSettingsTab(this.app, this));
    this.registerEditorExtension(editorExtensions(this));
    this.registerEditorSuggest(new ReferenceSuggest(this));
    this.registerMarkdownPostProcessor((el, ctx) => this.postProcess(el, ctx));
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
      if (editor.somethingSelected()) menu.addItem(item => item.setTitle('转换选中的引用').setIcon('replace')
        .onClick(() => this.converter.convertEditor(editor)));
    }));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshPanels()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      if (!this.isMobile) this.previews.closeTransient();
      this.previews.setActivePath(this.app.workspace.getActiveFile()?.path);
      this.refreshPanels();
    }));
    this.registerEvent(this.app.vault.on('modify', file => { if (file instanceof TFile && file.extension === 'md') void this.externalChange(file); }));
    this.registerEvent(this.app.vault.on('rename', (file, old) => {
      const points = this.points.get(old);
      if (points) { points.forEach(p => p.path = file.path); this.points.delete(old); this.points.set(file.path, points); }
      const index = this.cache.get(old);
      if (index) { this.cache.delete(old); this.cache.set(file.path, index); }
      const anchorSource = this.anchorSources.get(old);
      if (anchorSource !== undefined) { this.anchorSources.delete(old); this.anchorSources.set(file.path, anchorSource); }
      for (const [cm, path] of this.editors) if (path === old) this.editors.set(cm, file.path);
      this.previews.rename(old, file.path); this.refreshPanels();
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      this.points.delete(file.path); this.cache.delete(file.path); this.anchorSources.delete(file.path); this.previews.refresh(file.path); this.refreshPanels();
    }));
    this.registerDomEvent(document, 'keydown', event => { if (event.key === 'Escape') this.previews.hideForNavigation(); });
    this.registerDomEvent(document, 'scroll', () => this.scheduleUI(), true);
    this.registerDomEvent(window, 'resize', () => this.scheduleUI());
    this.addCommand({ id: 'insert-reference', name: '插入引用 @{}', editorCallback: editor => this.insertToken(editor, '@{}', 2) });
    this.addCommand({ id: 'insert-figure-label', name: '插入图片编号标记', editorCallback: editor => this.insertToken(editor, '@#fig{}', 6) });
    this.addCommand({ id: 'insert-table-label', name: '插入表格编号标记', editorCallback: editor => this.insertToken(editor, '@#tab{}', 6) });
    this.addCommand({ id: 'insert-addon-label', name: '插入通用附注编号标记', editorCallback: editor => this.insertToken(editor, '@#add{}', 6) });
    this.addCommand({ id: 'convert-selected-reference', name: '转换选中的引用', editorCallback: editor => this.converter.convertEditor(editor) });
    this.addCommand({ id: 'return-to-buoy', name: '返回上一个浮标', checkCallback: checking => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const path = view?.file?.path;
      const points = path ? this.points.get(path) : undefined;
      if (!view || !path || !points?.length) return false;
      if (!checking) void this.returnTo(points.at(-1)!, view);
      return true;
    } });
    this.addCommand({ id: 'clear-note-buoys', name: '清除此篇笔记的返回浮标', callback: () => {
      const path = this.app.workspace.getActiveFile()?.path;
      if (path) this.clearBuoys(path);
    } });
    this.app.workspace.onLayoutReady(() => { if (!this.disposed) this.refreshPanels(); });
  }
  onunload(): void {
    this.disposed = true; this.jumpGeneration++;
    if (this.uiTimer !== undefined) window.clearTimeout(this.uiTimer);
    this.previews?.destroy();
    this.converter?.destroy();
    for (const panel of this.panels.values()) panel.destroy();
    this.panels.clear(); this.points.clear(); this.cache.clear(); this.anchorSources.clear(); this.editors.clear();
  }
  async saveSettings(): Promise<void> { await this.saveData({ settings: this.settings }); }

  private insertToken(editor: Editor, text: string, cursorOffset: number): void {
    const cursor = editor.getCursor('from');
    editor.replaceSelection(text);
    editor.setCursor({ line: cursor.line, ch: cursor.ch + cursorOffset });
    editor.focus();
  }
  observeEditor(cm: EditorView): void {
    const path = cm.state.field(editorInfoField, false)?.file?.path;
    if (!path) return;
    this.editors.set(cm, path);
    const index = cm.state.field(indexField, false);
    if (index) { this.cache.set(path, index); if (!this.anchorSources.has(path)) this.anchorSources.set(path, index.source); }
  }
  forgetEditor(cm: EditorView): void { this.editors.delete(cm); }
  editorChanged(update: ViewUpdate): void {
    const path = update.state.field(editorInfoField, false)?.file?.path;
    if (!path) return;
    const oldPath = this.editors.get(update.view);
    const oldSource = update.startState.doc.toString();
    const current = this.anchorSources.get(path);
    // A second pane receives the same edit too; map each file's anchors only once.
    if (oldPath === path && (current === undefined || current === oldSource)) this.mapPositions(path, update.changes);
    this.editors.set(update.view, path);
    this.cache.set(path, update.state.field(indexField));
    this.anchorSources.set(path, update.state.doc.toString());
    this.updatePointDescriptions(path);
    this.scheduleUI(true);
  }
  private mapPositions(path: string, changes: ChangeSet): void {
    for (const point of this.points.get(path) ?? []) mapReturnPoint(point, changes);
    this.previews?.mapPositions(path, changes);
  }
  private updatePointDescriptions(path: string): void {
    const source = this.cache.get(path)?.source;
    if (source === undefined) return;
    for (const point of this.points.get(path) ?? []) if (!point.lost) {
      point.excerpt = contextExcerpt(source, point.from);
      point.heading = headingAt(source, point.from);
    }
  }
  getEditorIndex(editor: Editor, path: string): DocumentIndex {
    const source = editor.getValue();
    const current = this.cache.get(path);
    if (current?.source === source) return current;
    const index = indexDocument(source); this.cache.set(path, index); return index;
  }
  async getIndex(path: string): Promise<DocumentIndex | undefined> {
    for (const [cm, candidate] of this.editors) if (candidate === path && cm.dom.isConnected
      && cm.state.field(editorInfoField, false)?.file?.path === path) {
      const index = cm.state.field(indexField, false);
      if (index) return index;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    if (this.cache.has(path)) return this.cache.get(path);
    const index = indexDocument(await this.app.vault.cachedRead(file));
    this.cache.set(path, index); return index;
  }
  private async externalChange(file: TFile): Promise<void> {
    if (this.disposed) return;
    if ([...this.editors].some(([cm, path]) => path === file.path && cm.dom.isConnected)) return;
    const before = this.cache.get(file.path);
    const source = await this.app.vault.cachedRead(file);
    if (this.disposed) return;
    if (before) {
      const edit = contiguousEdit(before.source, source);
      if (edit) this.mapPositions(file.path, ChangeSet.of(edit, before.source.length));
    }
    this.cache.set(file.path, indexDocument(source));
    this.anchorSources.set(file.path, source);
    this.updatePointDescriptions(file.path); this.previews.refresh(file.path); this.refreshPanels();
  }
  cmForView(view: MarkdownView): EditorView | undefined {
    return [...this.editors.keys()].find(cm => cm.dom.isConnected && view.contentEl.contains(cm.dom));
  }
  cmForEditor(editor: Editor): EditorView | undefined {
    return [...this.editors.keys()].find(cm => cm.dom.isConnected && cm.state.field(editorInfoField, false)?.editor === editor);
  }
  private viewForOrigin(origin: ReferenceOrigin): MarkdownView | undefined {
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    if (origin.cm?.dom.isConnected) {
      const view = leaves.find(leaf => leaf.view instanceof MarkdownView && leaf.view.file?.path === origin.path && leaf.view.contentEl.contains(origin.cm!.dom))?.view;
      if (view instanceof MarkdownView) return view;
    }
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file?.path === origin.path) return active;
    const view = leaves.find(leaf => leaf.view instanceof MarkdownView && leaf.view.file?.path === origin.path)?.view;
    return view instanceof MarkdownView ? view : undefined;
  }

  bindReference(el: HTMLElement, ref: Reference, path: string, cm?: EditorView): void {
    const origin = (): ReferenceOrigin => ({ path, from: ref.from, to: ref.to, cm });
    el.addEventListener('pointerdown', event => { if (event.button === 0 && event.pointerType !== 'touch') event.preventDefault(); });
    if (!this.isMobile) {
      el.addEventListener('mouseenter', () => this.previews.queue(el, ref, origin()));
      el.addEventListener('mouseleave', event => this.previews.leaveSource(event.relatedTarget));
      el.addEventListener('focus', () => this.previews.queue(el, ref, origin()));
      el.addEventListener('blur', event => this.previews.leaveSource(event.relatedTarget));
    }
    el.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (event.shiftKey && cm) { this.editReference(cm, ref); return; }
      if (this.isMobile) { void this.previews.open(el, ref, origin()); return; }
      void this.followReference(el, ref, origin());
    });
    el.addEventListener('contextmenu', event => {
      if (!cm) return;
      event.preventDefault();
      const menu = new Menu();
      menu.addItem(item => item.setTitle('编辑引用').setIcon('pencil').onClick(() => this.editReference(cm, ref)));
      menu.addItem(item => item.setTitle('预览引用').setIcon('scan-eye').onClick(() => { void this.previews.open(el, ref, origin()); }));
      menu.showAtMouseEvent(event);
    });
  }
  private editReference(cm: EditorView, ref: Reference): void {
    this.previews.closeTransient();
    const opening = cm.state.doc.sliceString(ref.from, ref.to).indexOf('{');
    cm.dispatch({ selection: { anchor: ref.from + opening + 1, head: ref.to - 1 } }); cm.focus();
  }
  private async followReference(el: HTMLElement, ref: Reference, origin: ReferenceOrigin): Promise<void> {
    const index = await this.getIndex(origin.path);
    const candidates = index?.byKey.get(ref.key) ?? [];
    if (candidates.length !== 1) { await this.previews.open(el, ref, origin); return; }
    this.previews.closeTransient();
    await this.jump(candidates[0], origin);
  }

  async jump(target: Target, origin: ReferenceOrigin): Promise<void> {
    let view = this.viewForOrigin(origin);
    if (!view) {
      const file = this.app.vault.getAbstractFileByPath(origin.path);
      if (!(file instanceof TFile)) { new Notice('这篇笔记已不存在。'); return; }
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      if (leaf.view instanceof MarkdownView) view = leaf.view;
    }
    if (!view?.file) return;
    const index = await this.getIndex(origin.path);
    const candidates = index?.byKey.get(target.key) ?? [];
    const current = candidates.length === 1 ? candidates[0] : candidates.find(t => t.from === target.from);
    if (!current || !index) { new Notice('目标已变化，请重新预览后跳转。'); return; }
    const cm = this.cmForView(view);
    let safeFrom = Math.max(0, Math.min(origin.from, index.source.length));
    let safeTo = Math.max(safeFrom, Math.min(origin.to, index.source.length));
    let viewportFrom = safeFrom, viewportOffset = 0, scrollLeft = 0;
    let cursorAnchor = safeFrom, cursorHead = safeFrom;
    if (cm) {
      const block = cm.lineBlockAtHeight(cm.scrollDOM.scrollTop);
      viewportFrom = block.from;
      viewportOffset = cm.scrollDOM.scrollTop - block.top;
      scrollLeft = cm.scrollDOM.scrollLeft;
      const selection = cm.state.selection.main;
      const rect = cm.coordsAtPos(selection.head);
      const scrollRect = cm.scrollDOM.getBoundingClientRect();
      const originRect = cm.coordsAtPos(safeFrom);
      if (!originRect || originRect.bottom < scrollRect.top || originRect.top > scrollRect.bottom) {
        // A pinned preview may be used after the author has scrolled elsewhere.
        // Leave a return point at the place they are now reading, not at an offscreen old link.
        const currentPos = cm.posAtCoords({ x: Math.max(cm.contentDOM.getBoundingClientRect().left, scrollRect.left) + 15,
          y: scrollRect.top + Math.min(90, scrollRect.height / 3) });
        safeFrom = currentPos ?? viewportFrom;
        safeTo = Math.max(safeFrom, cm.state.doc.lineAt(safeFrom).to);
        cursorAnchor = safeFrom; cursorHead = safeFrom;
      }
      if (rect && rect.top >= scrollRect.top && rect.bottom <= scrollRect.bottom) {
        cursorAnchor = selection.anchor; cursorHead = selection.head;
      }
    } else viewportOffset = view.contentEl.querySelector('.markdown-preview-view')?.scrollTop ?? 0;
    const points = this.points.get(origin.path) ?? [];
    const point: ReturnPoint = {
      id: this.nextId++, path: origin.path, from: safeFrom, to: safeTo,
      cursorAnchor, cursorHead, viewportFrom, viewportOffset, scrollLeft,
      excerpt: contextExcerpt(index.source, safeFrom), heading: headingAt(index.source, safeFrom), lost: false
    };
    points.push(point); this.points.set(origin.path, points);
    this.app.workspace.setActiveLeaf(view.leaf, { focus: !this.isMobile });
    this.jumpGeneration++;
    if (cm && view.getMode() === 'source') {
      // Keep the caret outside the math source so Live Preview continues rendering the formula.
      const cursor = Math.min(current.to + (index.source[current.to] === '\n' ? 1 : 0), cm.state.doc.length);
      cm.dispatch({ selection: { anchor: cursor }, effects: [EditorView.scrollIntoView(current.focus.from, { y: 'center' }), flashEffect.of(current.focus)] });
      this.flashRendered(view, current);
      this.clearFlashLater(cm);
    } else {
      view.setEphemeralState({ line: current.line });
      this.flashRendered(view, current);
    }
    this.refreshPanels();
  }

  async returnTo(point: ReturnPoint, preferred?: MarkdownView): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(point.path);
    if (!(file instanceof TFile)) { new Notice('原笔记已不存在。'); return; }
    let view = preferred?.file?.path === point.path ? preferred : this.viewForOrigin({ path: point.path, from: point.from, to: point.to });
    if (!view) {
      const leaf = this.app.workspace.getLeaf(false); await leaf.openFile(file);
      if (leaf.view instanceof MarkdownView) view = leaf.view;
    }
    if (!view) return;
    this.previews.hideForNavigation();
    this.app.workspace.setActiveLeaf(view.leaf, { focus: !this.isMobile });
    const cm = this.cmForView(view);
    const generation = ++this.jumpGeneration;
    if (cm && view.getMode() === 'source') {
      const bound = (pos: number) => Math.max(0, Math.min(cm.state.doc.length, pos));
      cm.dispatch({ selection: { anchor: bound(point.cursorAnchor), head: bound(point.cursorHead) },
        effects: [EditorView.scrollIntoView(bound(point.viewportFrom), { y: 'start' }), flashEffect.of({ from: bound(point.from), to: bound(point.to) })] });
      const restore = () => {
        if (this.disposed || generation !== this.jumpGeneration || !cm.dom.isConnected) return;
        cm.requestMeasure({ read: () => cm.lineBlockAt(bound(point.viewportFrom)).top + point.viewportOffset,
          write: top => { if (generation === this.jumpGeneration) { cm.scrollDOM.scrollTop = top; cm.scrollDOM.scrollLeft = point.scrollLeft; } } });
      };
      restore();
      window.setTimeout(restore, 80);
      window.setTimeout(restore, 180);
      if (!this.isMobile) cm.focus();
      this.clearFlashLater(cm);
    } else {
      view.setEphemeralState({ line: view.editor.offsetToPos(point.from).line });
      const scroller = view.contentEl.querySelector('.markdown-preview-view');
      if (scroller) scroller.scrollTop = point.viewportOffset;
    }
    if (point.lost) new Notice('出发处的原文已被删除，已返回附近位置。');
    this.removeBuoy(point);
  }
  private clearFlashLater(cm: EditorView): void {
    window.setTimeout(() => {
      if (!this.disposed && cm.dom.isConnected) cm.dispatch({ effects: flashEffect.of(null) });
    }, 1800);
  }
  private flashRendered(view: MarkdownView, target: Target): void {
    window.setTimeout(() => {
      if (this.disposed || view.file?.path === undefined) return;
      if (target.kind === 'equation') {
        const match = [...view.contentEl.querySelectorAll<HTMLElement>('mjx-container')].find(el =>
          [...el.querySelectorAll('mjx-mtd, mjx-mtext')].some(t => mathText(t).replace(/[()（）\s]/g, '') === target.label));
        if (match) {
          match.addClass('reflo-target-flash');
          window.setTimeout(() => match.removeClass('reflo-target-flash'), 1800);
        }
      }
    }, 100);
  }
  removeBuoy(point: ReturnPoint): void {
    const remaining = (this.points.get(point.path) ?? []).filter(p => p.id !== point.id);
    if (remaining.length) this.points.set(point.path, remaining);
    else this.points.delete(point.path);
    this.refreshPanels();
  }
  clearBuoys(path?: string): void {
    if (path) this.points.delete(path);
    else this.points.clear();
    this.refreshPanels();
  }
  private scheduleUI(previews = false): void {
    this.previewsPending ||= previews;
    if (this.uiTimer !== undefined) window.clearTimeout(this.uiTimer);
    this.uiTimer = window.setTimeout(() => {
      this.uiTimer = undefined;
      if (this.disposed) return;
      this.refreshPanels(); if (this.previewsPending) this.previews.refresh();
      this.previewsPending = false;
    }, 90);
  }
  refreshPanels(): void {
    if (this.disposed) return;
    const live = new Set<MarkdownView>();
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) if (leaf.view instanceof MarkdownView) {
      const view = leaf.view;
      live.add(view);
      if (!this.panels.has(view)) this.panels.set(view, new BuoyPanel(this, view));
      this.panels.get(view)!.render();
    }
    for (const [view, panel] of this.panels) if (!live.has(view)) { panel.destroy(); this.panels.delete(view); }
  }

  private async postProcess(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    const index = await this.getIndex(ctx.sourcePath);
    if (!index || this.disposed) return;
    const doc = el.ownerDocument;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest('code, pre, mjx-container, script, style, a, button, .reflo-caption-label')) continue;
      if (node.textContent?.includes('@')) nodes.push(node as Text);
    }
    let searchFrom = 0;
    const section = ctx.getSectionInfo(el);
    if (section) {
      for (let line = 0; line < section.lineStart; line++) {
        const next = index.source.indexOf('\n', searchFrom); if (next < 0) break; searchFrom = next + 1;
      }
    }
    for (const textNode of nodes) {
      const text = textNode.data;
      const fragment = doc.createDocumentFragment();
      let cursor = 0;
      for (const match of text.matchAll(REFERENCE_PATTERN)) {
        const token = parseReference(match[0]); if (!token) continue;
        const sourceRef = index.references.find(r => r.key === token.key && r.definition === token.definition && r.from >= searchFrom)
          ?? index.references.find(r => r.key === token.key && r.definition === token.definition);
        if (!sourceRef) continue;
        searchFrom = sourceRef.to;
        fragment.append(doc.createTextNode(text.slice(cursor, match.index!)));
        const element = doc.createElement(token.definition ? 'span' : 'button');
        const count = index.byKey.get(token.key)?.length ?? 0;
        element.className = token.definition ? 'reflo-caption-label' : `reflo-reference reflo-${token.kind}${count === 0 ? ' is-missing' : count > 1 ? ' is-ambiguous' : ''}`;
        element.textContent = token.definition ? displayName(token) : `（${displayName(token)}）`;
        if (!token.definition) {
          element.setAttribute('type', 'button');
          if (count === 0) element.setAttribute('aria-description', '未找到目标');
          else if (count > 1) element.setAttribute('aria-description', '存在重复编号');
          this.bindReference(element, sourceRef, ctx.sourcePath);
        }
        fragment.append(element); cursor = match.index! + match[0].length;
      }
      if (cursor) { fragment.append(doc.createTextNode(text.slice(cursor))); textNode.replaceWith(fragment); }
    }
  }
}

function headingAt(source: string, position: number): string {
  const headings = [...source.slice(0, position).matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)];
  return headings.at(-1)?.[1] ?? '正文';
}
