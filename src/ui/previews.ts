import { Component, MarkdownRenderer, finishRenderMath, loadMathJax, renderMath, setIcon } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { ChangeDesc } from '@codemirror/state';
import { displayName, type Reference, type Target } from '../core/model';
import { contextAround } from '../core/context';
import type ReferenceBuoysPlugin from '../main';
import { clamp, iconButton } from './dom';

export interface ReferenceOrigin { path: string; from: number; to: number; cm?: EditorView }
interface Preview {
  el: HTMLElement;
  body: HTMLElement;
  context: HTMLElement;
  component: Component;
  abort: AbortController;
  path: string;
  key: string;
  origin: ReferenceOrigin;
  targetFrom: number;
  pinned: boolean;
  contextOpen: boolean;
  revision: number;
  contentSignature: string;
  nameEl: HTMLElement;
  locationEl: HTMLElement;
  pinButton: HTMLButtonElement;
  jumpButton: HTMLButtonElement;
  target?: Target;
}

export class PreviewManager {
  private cards = new Set<Preview>();
  private transient?: Preview;
  private openTimer?: number;
  private closeTimer?: number;
  private pendingElement?: HTMLElement;
  private z = 1000;
  private disposed = false;
  constructor(private host: ReferenceBuoysPlugin) {}

  queue(element: HTMLElement, ref: Reference, origin: ReferenceOrigin): void {
    this.cancelClose();
    if (this.transient?.key === ref.key && this.transient.path === origin.path) return;
    this.cancelOpen();
    this.pendingElement = element;
    this.openTimer = window.setTimeout(() => {
      this.openTimer = undefined;
      if (element.isConnected && this.pendingElement === element) void this.open(element, ref, origin);
    }, this.host.settings.hoverDelay);
  }
  leaveSource(next?: EventTarget | null): void {
    this.cancelOpen();
    // Pointer events fire before their compatibility mouse events. A source mouseleave can
    // arrive after the popup's pointerenter; don't schedule a close in that case.
    if (next instanceof Element && next.closest('.reflo-preview')) { this.cancelClose(); return; }
    this.scheduleClose();
  }
  private cancelOpen(): void { if (this.openTimer !== undefined) window.clearTimeout(this.openTimer); this.openTimer = undefined; this.pendingElement = undefined; }
  private cancelClose(): void { if (this.closeTimer !== undefined) window.clearTimeout(this.closeTimer); this.closeTimer = undefined; }
  private scheduleClose(): void {
    this.cancelClose();
    this.closeTimer = window.setTimeout(() => {
      const card = this.transient;
      if (card?.el.matches(':hover') || card?.el.contains(card.el.ownerDocument.activeElement)) return;
      this.closeTransient();
    }, 280);
  }
  closeTransient(): void { this.cancelOpen(); this.cancelClose(); if (this.transient) this.close(this.transient); }

  async open(element: HTMLElement, ref: Pick<Reference, 'key' | 'kind' | 'label'>, origin: ReferenceOrigin): Promise<void> {
    const index = await this.host.getIndex(origin.path);
    if (this.disposed || !element.isConnected || !index) return;
    const anchor = element.getBoundingClientRect();
    this.closeTransient();
    const doc = element.ownerDocument;
    const el = doc.body.createDiv({ cls: 'reflo-preview', attr: { role: 'dialog' } });
    el.style.width = `${this.host.settings.previewWidth}px`;
    el.style.zIndex = String(++this.z);
    const abort = new AbortController();
    const signal = abort.signal;
    const header = el.createDiv({ cls: 'reflo-preview-header' });
    const identity = header.createDiv({ cls: 'reflo-preview-identity' });
    const titles = identity.createDiv();
    const nameEl = titles.createEl('strong', { text: displayName(ref) });
    nameEl.id = `reflo-preview-title-${this.z}`;
    el.setAttribute('aria-labelledby', nameEl.id);
    const locationEl = titles.createDiv({ cls: 'reflo-preview-location', text: '本篇笔记' });
    const controls = header.createDiv({ cls: 'reflo-preview-controls' });
    let card: Preview;
    const pinButton = iconButton(controls, 'pin', '固定此预览，留在旁边对照', () => this.pin(card));
    const jumpButton = iconButton(controls, 'arrow-up-right', '跳到原文并留下返回浮标', () => {
      if (card.target) { void this.host.jump(card.target, card.origin); if (!card.pinned) this.close(card); }
    });
    iconButton(controls, 'x', '关闭预览', () => this.close(card));
    const body = el.createDiv({ cls: 'reflo-preview-body markdown-rendered' });
    const context = el.createDiv({ cls: 'reflo-preview-context markdown-rendered' });
    const footer = el.createDiv({ cls: 'reflo-preview-footer' });
    const contextButton = footer.createEl('button', { text: this.host.settings.showContext ? '收起上下文' : '展开上下文', cls: 'reflo-text-button' });
    contextButton.setAttribute('aria-expanded', String(this.host.settings.showContext));
    const component = new Component(); component.load();
    card = { el, body, context, component, abort, path: origin.path, key: ref.key, origin: { ...origin },
      targetFrom: index.byKey.get(ref.key)?.[0]?.from ?? -1, pinned: false,
      contextOpen: this.host.settings.showContext, revision: 0, contentSignature: '', nameEl, locationEl, pinButton, jumpButton };
    this.cards.add(card); this.transient = card;
    contextButton.addEventListener('click', () => {
      card.contextOpen = !card.contextOpen;
      contextButton.textContent = card.contextOpen ? '收起上下文' : '展开上下文';
      contextButton.setAttribute('aria-expanded', String(card.contextOpen));
      card.contentSignature = '';
      void this.render(card);
    }, { signal });
    el.addEventListener('pointerenter', () => this.cancelClose(), { signal });
    el.addEventListener('pointerleave', () => { if (!card.pinned) this.scheduleClose(); }, { signal });
    el.addEventListener('focusin', () => this.cancelClose(), { signal });
    el.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (this.transient && this.transient !== card) this.closeTransient();
        else { this.close(card); element.focus(); }
      }
    }, { signal });
    el.addEventListener('pointerdown', () => { el.style.zIndex = String(++this.z); }, { signal });
    this.enableDrag(card, header);
    this.position(card, anchor);
    await this.render(card);
    if (this.cards.has(card) && !card.pinned) this.position(card, anchor);
  }

  private position(card: Preview, anchor: DOMRect): void {
    const win = card.el.ownerDocument.defaultView!;
    const rect = card.el.getBoundingClientRect();
    const width = Math.min(rect.width, win.innerWidth - 24);
    card.el.style.maxWidth = `${win.innerWidth - 24}px`;
    card.el.style.maxHeight = `${win.innerHeight - 32}px`;
    const left = clamp(anchor.left, 12, win.innerWidth - width - 12);
    const below = win.innerHeight - anchor.bottom - 14;
    const above = anchor.top - 14;
    let top: number;
    if (rect.height <= below || below >= above) {
      top = anchor.bottom + 9;
      card.el.style.maxHeight = `${Math.max(150, below - 12)}px`;
    } else {
      top = Math.max(12, anchor.top - rect.height - 9);
      card.el.style.maxHeight = `${Math.max(150, above - 12)}px`;
    }
    card.el.style.left = `${left}px`;
    card.el.style.top = `${clamp(top, 12, win.innerHeight - Math.min(rect.height, 180) - 12)}px`;
  }

  private pin(card: Preview): void {
    card.pinned = !card.pinned;
    card.el.toggleClass('is-pinned', card.pinned);
    card.pinButton.setAttribute('aria-pressed', String(card.pinned));
    card.pinButton.setAttribute('aria-label', card.pinned ? '取消固定' : '固定此预览，留在旁边对照');
    setIcon(card.pinButton, card.pinned ? 'pin-off' : 'pin');
    if (card.pinned) {
      if (this.transient === card) this.transient = undefined;
      this.cancelClose();
      this.fitPinned(card);
    } else {
      if (this.transient && this.transient !== card) this.close(this.transient);
      this.transient = card;
    }
  }

  private enableDrag(card: Preview, handle: HTMLElement): void {
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
      event.preventDefault();
      if (!card.pinned) this.pin(card);
      const rect = card.el.getBoundingClientRect();
      const dx = event.clientX - rect.left, dy = event.clientY - rect.top;
      handle.setPointerCapture(event.pointerId);
      const move = (e: PointerEvent) => {
        const win = card.el.ownerDocument.defaultView!;
        card.el.style.left = `${clamp(e.clientX - dx, 8, win.innerWidth - card.el.offsetWidth - 8)}px`;
        card.el.style.top = `${clamp(e.clientY - dy, 8, win.innerHeight - card.el.offsetHeight - 8)}px`;
      };
      const stop = () => { this.fitPinned(card); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); handle.removeEventListener('lostpointercapture', stop); };
      handle.addEventListener('pointermove', move, { signal: card.abort.signal });
      handle.addEventListener('pointerup', stop, { once: true, signal: card.abort.signal });
      handle.addEventListener('lostpointercapture', stop, { once: true, signal: card.abort.signal });
    }, { signal: card.abort.signal });
  }

  private async render(card: Preview): Promise<void> {
    const index = await this.host.getIndex(card.path);
    if (!index || !this.cards.has(card)) return;
    const candidates = index.byKey.get(card.key) ?? [];
    const signature = JSON.stringify([candidates.map(t => [t.from, t.markdown, t.caption, t.heading]), card.contextOpen ? index.source : '']);
    if (signature === card.contentSignature) return;
    card.contentSignature = signature;
    const revision = ++card.revision;
    card.component.unload(); card.component = new Component(); card.component.load();
    card.body.empty(); card.context.empty(); card.context.hidden = true;
    card.target = undefined;
    card.jumpButton.disabled = true;
    if (!candidates.length) {
      card.body.createDiv({ cls: 'reflo-empty-icon', text: '∅' });
      card.body.createEl('strong', { text: '未找到这个编号' });
      card.body.createEl('p', { text: '检查编号是否一致，或目标是否已被删除。', cls: 'reflo-muted' });
      return;
    }
    let target: Target | undefined;
    if (candidates.length === 1) target = candidates[0];
    else if (card.targetFrom >= 0 && card.el.dataset.chosen === 'true') target = candidates.find(t => t.from === card.targetFrom);
    if (!target) {
      card.locationEl.textContent = `${candidates.length} 个同名编号`;
      card.body.createEl('p', { text: '此篇笔记中编号重复，请选择本次要查看的位置。', cls: 'reflo-muted' });
      for (const option of candidates) {
        const button = card.body.createEl('button', { cls: 'reflo-candidate' });
        button.createEl('strong', { text: `${option.heading} · 第 ${option.line + 1} 行` });
        button.createSpan({ text: (option.caption || option.math || option.markdown).replace(/\s+/g, ' ').slice(0, 100) });
        button.addEventListener('click', () => {
          card.targetFrom = option.from; card.el.dataset.chosen = 'true'; card.contentSignature = ''; void this.render(card);
        }, { signal: card.abort.signal });
      }
      return;
    }
    card.target = target; card.targetFrom = target.from;
    card.jumpButton.disabled = false;
    card.nameEl.textContent = displayName(target);
    card.locationEl.textContent = `${target.heading}${(target.tagCount ?? 0) > 1 ? ' · 完整公式组' : ''}`;
    try {
      if (target.math !== undefined) {
        await loadMathJax();
        if (revision !== card.revision || !this.cards.has(card)) return;
        card.body.appendChild(renderMath(target.math, true));
        await finishRenderMath();
        if (revision !== card.revision || !this.cards.has(card)) return;
        if ((target.tagCount ?? 0) > 1) highlightMathRow(card.body, target);
      } else {
        await MarkdownRenderer.render(this.host.app, target.markdown, card.body, card.path, card.component);
        if (revision !== card.revision || !this.cards.has(card)) return;
        const caption = card.body.createDiv({ cls: 'reflo-object-caption' });
        caption.createEl('strong', { text: displayName(target) });
        if (target.caption) {
          const description = caption.createDiv();
          await MarkdownRenderer.render(this.host.app, target.caption, description, card.path, card.component);
        }
      }
      if (card.contextOpen && this.cards.has(card) && revision === card.revision) {
        card.context.hidden = false;
        const { before, after } = contextAround(index, target);
        if (!before && !after) card.context.createDiv({ cls: 'reflo-muted', text: '本节没有相邻内容。' });
        for (const [label, text] of [['前文', before], ['后文', after]]) if (text) {
          if (!this.cards.has(card) || revision !== card.revision) return;
          const section = card.context.createDiv({ cls: 'reflo-context-section' });
          section.createSpan({ text: label, cls: 'reflo-context-label' });
          await MarkdownRenderer.render(this.host.app, text, section.createDiv(), card.path, card.component);
        }
        await finishRenderMath();
      }
    } catch (error) {
      console.error('Reference Buoys: preview rendering failed', error);
      if (this.cards.has(card) && revision === card.revision) {
        card.body.empty();
        card.body.createEl('p', { text: '这个内容暂时无法渲染，仍可跳到原文查看。', cls: 'reflo-muted' });
        card.body.createEl('pre', { text: target.math ?? target.markdown });
      }
    }
  }

  mapPositions(path: string, changes: ChangeDesc): void {
    for (const card of this.cards) if (card.path === path) {
      card.origin.from = changes.mapPos(card.origin.from, 1);
      card.origin.to = changes.mapPos(card.origin.to, -1);
      if (card.targetFrom >= 0) card.targetFrom = changes.mapPos(card.targetFrom, 1);
    }
  }
  refresh(path?: string): void { for (const card of this.cards) if (!path || card.path === path) void this.render(card); }
  setActivePath(path?: string): void { for (const card of this.cards) card.el.hidden = card.path !== path; }
  rename(from: string, to: string): void { for (const card of this.cards) if (card.path === from) { card.path = to; card.origin.path = to; } }
  private fitPinned(card: Preview): void {
    const win = card.el.ownerDocument.defaultView!, rect = card.el.getBoundingClientRect();
    card.el.style.maxWidth = `${Math.max(300, win.innerWidth - rect.left - 12)}px`;
    card.el.style.maxHeight = `${Math.max(120, win.innerHeight - rect.top - 12)}px`;
  }
  private close(card: Preview): void {
    if (!this.cards.delete(card)) return;
    card.revision++; card.abort.abort(); card.component.unload(); card.el.remove();
    if (this.transient === card) this.transient = undefined;
  }
  destroy(): void {
    this.disposed = true; this.cancelOpen(); this.cancelClose();
    for (const card of [...this.cards]) this.close(card);
  }
}

export function highlightMathRow(container: HTMLElement, target: Target): void {
  const normal = (text: string | null) => (text ?? '').replace(/[()（）\s]/g, '');
  const labelCells = [...container.querySelectorAll<HTMLElement>('mjx-labels mjx-mtd, .mjx-label mjx-mtd, mjx-mlabeledtr > mjx-mtd:first-child')];
  const label = labelCells.find(el => normal(mathText(el)) === target.label);
  if (label) {
    label.classList.add('reflo-math-focus');
    const labelRow = label.closest('mjx-mtr');
    const labelTable = labelRow?.parentElement;
    const rowIndex = labelRow && labelTable ? [...labelTable.children].indexOf(labelRow) : -1;
    const mathTable = label.closest('mjx-mtable');
    const rows = mathTable?.querySelectorAll(':scope > mjx-table > mjx-itable > mjx-mtr, :scope > mjx-table > mjx-itable > mjx-mlabeledtr');
    if (rowIndex >= 0) rows?.[rowIndex]?.classList.add('reflo-math-focus');
    label.closest('mjx-mlabeledtr')?.classList.add('reflo-math-focus');
    return;
  }
  // MathJax versions use different table markup. At minimum emphasize the exact rendered tag.
  const leaf = [...container.querySelectorAll<HTMLElement>('mjx-mtext, mjx-mrow')]
    .filter(el => normal(mathText(el)) === target.label).sort((a, b) => a.children.length - b.children.length)[0];
  leaf?.classList.add('reflo-math-focus');
}

export function mathText(element: Element): string {
  // MathJax CHTML draws glyphs with ::before, so textContent is often empty.
  const glyphs = [...element.querySelectorAll('mjx-c')];
  if (!glyphs.length) return element.textContent ?? '';
  return glyphs.map(glyph => {
    const code = [...glyph.classList].map(name => /^mjx-c([0-9a-f]+)$/i.exec(name)?.[1]).find(Boolean)
      ?? glyph.getAttribute('data-c');
    if (!code) return glyph.textContent ?? '';
    const value = parseInt(code, 16);
    return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : '';
  }).join('');
}
