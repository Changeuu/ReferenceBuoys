import { type MarkdownView, Component, MarkdownRenderer, finishRenderMath, loadMathJax, renderMath, setIcon } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { ChangeDesc } from '@codemirror/state';
import { displayName, type Target } from '../core/model';
import type { NavigationTarget, PreviewReference } from '../core/headings';
import { contextAround } from '../core/context';
import { focusMath } from '../core/math-preview';
import type ReferenceBuoysPlugin from '../main';
import { bindTouchButton, clamp, iconButton } from './dom';

export interface ReferenceOrigin { path: string; from: number; to: number; cm?: EditorView; view?: MarkdownView }
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
  request: number;
  contentSignature: string;
  nameEl: HTMLElement;
  locationEl: HTMLElement;
  pinButton: HTMLButtonElement;
  jumpButton: HTMLButtonElement;
  formulaButton: HTMLButtonElement;
  formulaExpanded: boolean;
  target?: NavigationTarget;
  heading: boolean;
  mobile: boolean;
  pen: boolean;
  mobilePosition?: { left: number; top: number };
  expanded: boolean;
  collapsed: boolean;
  active: boolean;
  restoreButton?: HTMLButtonElement;
}

export class PreviewManager {
  private cards = new Set<Preview>();
  private transient?: Preview;
  private openTimer?: number;
  private closeTimer?: number;
  private pendingElement?: HTMLElement;
  private z = 1000;
  private disposed = false;
  private openGeneration = 0;
  constructor(private host: ReferenceBuoysPlugin) {}

  queue(element: HTMLElement, ref: PreviewReference, origin: ReferenceOrigin): void {
    if (this.host.isMobile) return;
    this.cancelClose();
    if (this.transient?.key === ref.key && this.sameSource(this.transient, ref, origin)) {
      this.transient.origin = { ...origin }; return;
    }
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
  closeTransient(): void { this.openGeneration++; this.cancelOpen(); this.cancelClose(); if (this.transient) this.close(this.transient); }

  resetMobilePreviews(): void {
    this.openGeneration++; this.cancelOpen(); this.cancelClose();
    for (const card of [...this.cards]) if (card.mobile) this.close(card);
  }

  hideForNavigation(): void {
    if (this.transient?.mobile) this.minimize(this.transient);
    else this.closeTransient();
  }

  async open(element: HTMLElement, ref: PreviewReference, origin: ReferenceOrigin): Promise<void> {
    const generation = ++this.openGeneration;
    const path = this.targetPath(ref, origin);
    // Resolve before creating a card so a delayed lookup cannot leave a stray
    // mobile restore tab after the reader has switched notes.
    if (ref.kind === 'heading') await this.host.getIndex(path);
    else await this.host.referenceTargets(origin.path, ref.key);
    if (this.disposed || generation !== this.openGeneration || !element.isConnected) return;
    const mobile = this.host.isMobile;
    const pen = mobile && this.host.settings.penReadingMode;
    if (mobile && this.transient?.key === ref.key && this.sameSource(this.transient, ref, origin)) {
      this.transient.origin = { ...origin };
      this.restore(this.transient);
      await this.render(this.transient);
      return;
    }
    const anchor = element.getBoundingClientRect();
    this.closeTransient();
    const doc = element.ownerDocument;
    const el = doc.body.createDiv({ cls: `reflo-preview${mobile ? ' reflo-mobile-preview' : ''}${pen ? ' reflo-pen-preview' : ''}`, attr: { role: 'dialog' } });
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
    const pinButton = iconButton(controls, mobile ? 'chevron-down' : 'pin', mobile ? '收起预览' : '固定此预览，留在旁边对照', () => mobile ? this.minimize(card) : this.pin(card));
    const jump = () => {
      if (card.target) {
        if (mobile) this.minimize(card);
        void this.host.jump(card.target, this.host.originForPreview(card.origin), card.path);
        if (!mobile && !card.pinned) this.close(card);
      }
    };
    const jumpButton = iconButton(controls, 'arrow-up-right', '跳到原文并留下返回浮标', jump);
    iconButton(controls, 'x', '关闭预览', () => this.close(card));
    const body = el.createDiv({ cls: 'reflo-preview-body markdown-rendered' });
    const context = el.createDiv({ cls: 'reflo-preview-context markdown-rendered' });
    const footer = el.createDiv({ cls: 'reflo-preview-footer' });
    const formulaButton = footer.createEl('button', { text: '展开完整公式组', cls: 'reflo-text-button' });
    formulaButton.hidden = true;
    const contextButton = footer.createEl('button', { text: this.host.settings.showContext ? '收起上下文' : '展开上下文', cls: 'reflo-text-button' });
    const updateContextButton = () => {
      const open = card?.contextOpen ?? this.host.settings.showContext;
      contextButton.textContent = mobile ? (open ? '收起上下文' : '上下文') : (open ? '收起上下文' : '展开上下文');
      contextButton.setAttribute('aria-label', open ? '收起上下文' : '展开上下文');
      contextButton.setAttribute('aria-expanded', String(open));
    };
    if (mobile) {
      jumpButton.className = 'reflo-mobile-jump';
      jumpButton.textContent = '跳转';
      footer.appendChild(jumpButton);
      el.querySelectorAll('[title]').forEach(button => button.removeAttribute('title'));
    }
    if (ref.kind === 'heading') { contextButton.hidden = true; if (!mobile) footer.hidden = true; }
    contextButton.setAttribute('aria-expanded', String(this.host.settings.showContext));
    const component = new Component(); component.load();
    card = { el, body, context, component, abort, path, heading: ref.kind === 'heading', key: ref.key, origin: { ...origin },
      targetFrom: -1, pinned: false,
      contextOpen: ref.kind !== 'heading' && this.host.settings.showContext, revision: 0, request: 0, contentSignature: '', nameEl, locationEl, pinButton, jumpButton,
      formulaButton, formulaExpanded: false, mobile, pen, expanded: false, collapsed: false, active: true };
    updateContextButton();
    this.cards.add(card); this.transient = card;
    formulaButton.addEventListener('click', () => {
      card.formulaExpanded = !card.formulaExpanded;
      void this.render(card);
    }, { signal });
    contextButton.addEventListener('click', () => {
      card.contextOpen = !card.contextOpen;
      updateContextButton();
      card.contentSignature = '';
      void this.render(card);
    }, { signal });
    el.addEventListener('pointerenter', () => this.cancelClose(), { signal });
    el.addEventListener('pointerleave', () => { if (!mobile && !card.pinned) this.scheduleClose(); }, { signal });
    el.addEventListener('focusin', () => this.cancelClose(), { signal });
    el.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (card.pen && card.pinned) this.close(card);
        else if (mobile) this.minimize(card);
        else if (this.transient && this.transient !== card) this.closeTransient();
        else { this.close(card); element.focus(); }
      }
    }, { signal });
    el.addEventListener('pointerdown', () => { el.style.zIndex = String(++this.z); }, { signal });
    if (mobile) this.enableMobile(card, header);
    else this.enableDrag(card, header);
    this.position(card, anchor);
    await this.render(card);
    if (this.cards.has(card) && !card.pinned) this.position(card, anchor);
  }

  private position(card: Preview, anchor: DOMRect): void {
    if (card.mobile) { this.positionMobile(card); return; }
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

  private minimize(card: Preview): void {
    // Pinned pen cards have an independent close button, never a hidden restore tab.
    if (!card.mobile || card.pinned || !this.cards.has(card)) return;
    this.openGeneration++;
    this.cancelOpen(); this.cancelClose();
    card.collapsed = true;
    card.el.hidden = true;
    if (card.restoreButton) card.restoreButton.hidden = !card.active;
  }

  private restore(card: Preview): void {
    card.collapsed = false;
    card.active = true;
    card.el.hidden = false;
    if (card.restoreButton) card.restoreButton.hidden = true;
    this.positionMobile(card);
  }

  private positionMobile(card: Preview): void {
    const win = card.el.ownerDocument.defaultView!, viewport = win.visualViewport;
    const width = viewport?.width ?? win.innerWidth, height = viewport?.height ?? win.innerHeight;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const bottom = Math.max(0, win.innerHeight - top - height) + 60;
    const cardWidth = card.pen
      ? Math.min(width - 16, width >= 700 ? Math.min(560, Math.max(320, width * .45)) : 460)
      : width - 16;
    card.el.style.width = `${Math.max(0, cardWidth)}px`;
    card.el.style.maxWidth = `${Math.max(0, width - 16)}px`;
    card.el.style.maxHeight = `${Math.max(80, Math.min(height * (card.expanded ? .9 : .62), height - 100))}px`;
    card.el.classList.toggle('is-expanded', card.expanded);
    for (const element of [card.el, card.restoreButton]) if (element) {
      element.style.setProperty('--reflo-mobile-bottom', `${bottom}px`);
    }
    if (card.restoreButton) card.restoreButton.style.left = `${left + 10}px`;
    if (card.mobilePosition) {
      card.el.style.bottom = 'auto';
      const rect = card.el.getBoundingClientRect();
      const position = card.mobilePosition;
      position.left = clamp(position.left, left + 8, Math.max(left + 8, left + width - rect.width - 8));
      position.top = clamp(position.top, top + 8, Math.max(top + 8, top + height - rect.height - 68));
      card.el.style.left = `${position.left}px`;
      card.el.style.top = `${position.top}px`;
    } else {
      card.el.style.left = `${left + (width - cardWidth) / 2}px`;
      card.el.style.top = 'auto';
      card.el.style.bottom = '';
    }
  }

  private enableMobile(card: Preview, header: HTMLElement): void {
    const doc = card.el.ownerDocument, win = doc.defaultView!, signal = card.abort.signal;
    card.el.querySelectorAll<HTMLButtonElement>('.reflo-preview-controls button, .reflo-preview-footer button')
      .forEach(button => bindTouchButton(button, signal));
    card.restoreButton = doc.body.createEl('button', {
      cls: 'reflo-mobile-preview-tab', text: `${card.nameEl.textContent} ▴`,
      attr: { type: 'button', 'aria-label': `恢复预览：${card.nameEl.textContent}`, 'aria-haspopup': 'dialog' }
    });
    card.restoreButton.hidden = true;
    card.restoreButton.addEventListener('click', () => this.restore(card), { signal });
    bindTouchButton(card.restoreButton, signal);
    doc.addEventListener('pointerdown', event => {
      if (!card.active || card.collapsed || card.pinned || !(event.target instanceof Node)) return;
      if (card.el.contains(event.target) || card.restoreButton?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest('.reflo-reference, .reflo-preview, .reflo-mobile-preview-tab')) return;
      this.minimize(card);
    }, { capture: true, signal });
    const resize = () => this.positionMobile(card);
    win.addEventListener('resize', resize, { signal });
    win.visualViewport?.addEventListener('resize', resize, { signal });
    win.visualViewport?.addEventListener('scroll', resize, { signal });
    if (card.pen) {
      this.enablePenDrag(card, header);
      // Formula expansion and asynchronous image loading can change a dragged
      // card's height. Keep all its controls within the visible viewport.
      const observer = new win.ResizeObserver(() => { if (card.pinned && !card.collapsed) this.positionMobile(card); });
      observer.observe(card.el);
      signal.addEventListener('abort', () => observer.disconnect(), { once: true });
      return;
    }
    let gesture: { id: number; x: number; y: number } | undefined;
    header.addEventListener('pointerdown', event => {
      if (event.button !== 0 || (event.target as Element).closest('button')) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
      header.setPointerCapture(event.pointerId);
    }, { signal });
    header.addEventListener('pointerup', event => {
      if (gesture?.id !== event.pointerId) return;
      const dy = event.clientY - gesture.y, dx = event.clientX - gesture.x;
      gesture = undefined;
      if (Math.abs(dy) < 40 || Math.abs(dy) <= Math.abs(dx)) return;
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
      // Let the touch sequence finish before moving its captured header.
      win.requestAnimationFrame(() => {
        if (!this.cards.has(card) || card.collapsed) return;
        if (dy < 0) { card.expanded = true; this.positionMobile(card); }
        else if (card.expanded) { card.expanded = false; this.positionMobile(card); }
        else this.minimize(card);
      });
    }, { signal });
    header.addEventListener('pointercancel', () => { gesture = undefined; }, { signal });
    header.addEventListener('lostpointercapture', () => { gesture = undefined; }, { signal });
  }

  private enablePenDrag(card: Preview, header: HTMLElement): void {
    const signal = card.abort.signal;
    let gesture: { id: number; x: number; y: number; left: number; top: number; moved: boolean } | undefined;
    const stop = () => {
      if (!gesture) return;
      const id = gesture.id;
      gesture = undefined;
      card.el.classList.remove('is-dragging');
      if (header.hasPointerCapture(id)) header.releasePointerCapture(id);
    };
    header.addEventListener('pointerdown', event => {
      if (gesture) { stop(); return; }
      if (event.button !== 0 || (event.target as Element).closest('button')) return;
      const rect = card.el.getBoundingClientRect();
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      event.preventDefault();
      header.setPointerCapture(event.pointerId);
    }, { signal });
    const move = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 8) return;
      event.preventDefault();
      gesture.moved = true;
      if (!card.pinned) {
        card.pinned = true;
        card.el.classList.add('is-pinned');
        card.pinButton.remove();
        card.restoreButton?.remove(); card.restoreButton = undefined;
        if (this.transient === card) this.transient = undefined;
        this.cancelOpen(); this.cancelClose();
      }
      card.el.classList.add('is-dragging');
      card.mobilePosition = { left: gesture.left + dx, top: gesture.top + dy };
      this.positionMobile(card);
    };
    header.addEventListener('pointermove', move, { signal });
    header.addEventListener('pointerup', event => {
      if (gesture?.id !== event.pointerId) return;
      move(event); stop();
    }, { signal });
    header.addEventListener('pointercancel', stop, { signal });
    header.addEventListener('lostpointercapture', stop, { signal });
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
    const request = ++card.request;
    const candidates: Array<{ path: string; target: NavigationTarget }> = card.heading
      ? this.host.navigationTargets(await this.host.getIndex(card.path), card.key).map(target => ({ path: card.path, target }))
      : await this.host.referenceTargets(card.origin.path, card.key);
    if (!this.cards.has(card) || request !== card.request) return;
    const chosen = candidates.length === 1 ? candidates[0]
      : card.el.dataset.chosen === 'true' ? candidates.find(c => c.path === card.path && c.target.from === card.targetFrom) : undefined;
    const index = chosen ? await this.host.getIndex(chosen.path) : undefined;
    if (!this.cards.has(card) || request !== card.request) return;
    const signature = JSON.stringify([chosen?.path ?? card.path, candidates.map(({ path, target: t }) => [path, t.from, t.markdown, t.caption, t.heading]), card.contextOpen ? index?.source : '', card.formulaExpanded]);
    if (signature === card.contentSignature) return;
    card.contentSignature = signature;
    const revision = ++card.revision;
    card.component.unload(); card.component = new Component(); card.component.load();
    card.body.empty(); card.context.empty(); card.context.hidden = true;
    card.formulaButton.hidden = true;
    card.target = undefined;
    card.jumpButton.disabled = true;
    if (!candidates.length) {
      card.body.createDiv({ cls: 'reflo-empty-icon', text: '∅' });
      card.body.createEl('strong', { text: card.heading ? '未找到这个章节' : '未找到这个编号' });
      card.body.createEl('p', { text: card.heading ? '检查笔记路径和章节标题是否正确，或目标是否已被删除。' : '当前笔记及同文件夹内未找到目标，请检查编号和目标标记。', cls: 'reflo-muted' });
      return;
    }
    if (!chosen) {
      card.locationEl.textContent = `${candidates.length} 个同名编号`;
      card.body.createEl('p', { text: '找到多个同号目标，请选择本次要查看的位置。', cls: 'reflo-muted' });
      for (const { path, target: option } of candidates) {
        const button = card.body.createEl('button', { cls: 'reflo-candidate' });
        const note = path === card.origin.path ? '' : `${path.replace(/\.md$/, '')} · `;
        button.createEl('strong', { text: `${note}${option.heading} · 第 ${option.line + 1} 行` });
        button.createSpan({ text: (option.caption || option.math || option.markdown).replace(/\s+/g, ' ').slice(0, 100) });
        button.addEventListener('click', () => {
          card.path = path; card.targetFrom = option.from; card.el.dataset.chosen = 'true'; card.contentSignature = ''; card.formulaExpanded = false; void this.render(card);
        }, { signal: card.abort.signal });
      }
      return;
    }
    const target = chosen.target;
    card.path = chosen.path; card.target = target; card.targetFrom = target.from;
    card.jumpButton.disabled = false;
    card.nameEl.textContent = displayName(target);
    const location = `${card.path !== card.origin.path ? card.path.split('/').at(-1)!.replace(/\.md$/, '') + ' · ' : ''}${target.heading}`;
    card.locationEl.textContent = card.heading ? card.path.replace(/\.md$/, '') : `${location}${(target.tagCount ?? 0) > 1 ? ' · 完整公式组' : ''}`;
    try {
      if (target.math !== undefined) {
        const focused = focusMath(target.math, target.label);
        card.formulaButton.hidden = !focused;
        card.formulaButton.textContent = card.formulaExpanded ? '聚焦引用' : (card.mobile ? '完整公式' : '展开完整公式组');
        card.formulaButton.setAttribute('aria-label', card.formulaExpanded ? '聚焦引用' : '展开完整公式组');
        card.formulaButton.setAttribute('aria-expanded', String(card.formulaExpanded));
        if (focused && !card.formulaExpanded) card.locationEl.textContent = `${location} · 公式节选`;
        await loadMathJax();
        if (revision !== card.revision || !this.cards.has(card)) return;
        const math = focused && !card.formulaExpanded ? focused.math : target.math;
        card.body.appendChild(renderMath(math, true));
        await finishRenderMath();
        if (revision !== card.revision || !this.cards.has(card)) return;
        // A custom macro can have effects the conservative row reader cannot
        // predict. Always recover the original formula if its excerpt fails.
        if (math !== target.math && card.body.querySelector('mjx-merror, [data-mjx-error]')) {
          card.body.empty(); card.body.appendChild(renderMath(target.math, true));
          card.formulaButton.hidden = true;
          card.locationEl.textContent = `${location} · 完整公式组`;
          await finishRenderMath();
          if (revision !== card.revision || !this.cards.has(card)) return;
        }
        card.body.scrollTop = 0; card.body.scrollLeft = 0;
        if ((target.tagCount ?? 0) > 1) highlightMathRow(card.body, target as Target);
      } else {
        await MarkdownRenderer.render(this.host.app, target.markdown, card.body, card.path, card.component);
        if (revision !== card.revision || !this.cards.has(card)) return;
        const contentTarget = target.kind === 'heading' || target.kind === 'definition' || target.kind === 'theorem';
        if (!contentTarget || target.caption) {
          const caption = card.body.createDiv({ cls: 'reflo-object-caption' });
          if (!contentTarget) caption.createEl('strong', { text: displayName(target) });
          if (target.caption) {
            const description = caption.createDiv();
            await MarkdownRenderer.render(this.host.app, target.caption, description, card.path, card.component);
          }
        }
      }
      if (index && target.kind !== 'heading' && card.contextOpen && this.cards.has(card) && revision === card.revision) {
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

  private targetPath(ref: PreviewReference, origin: ReferenceOrigin): string {
    return ref.kind === 'heading' ? this.host.headingPath(ref.linkpath, origin.path) ?? '' : origin.path;
  }
  private sameSource(card: Preview, ref: PreviewReference, origin: ReferenceOrigin): boolean {
    return ref.kind === 'heading' ? card.path === this.targetPath(ref, origin) : card.origin.path === origin.path;
  }
  mapPositions(path: string, changes: ChangeDesc): void {
    for (const card of this.cards) {
      if (card.origin.path === path) {
        card.origin.from = changes.mapPos(card.origin.from, 1);
        card.origin.to = changes.mapPos(card.origin.to, -1);
      }
      if (card.path === path && card.targetFrom >= 0) card.targetFrom = changes.mapPos(card.targetFrom, 1);
    }
  }
  refresh(path?: string): void { for (const card of this.cards) if (!path || !card.heading || card.path === path) void this.render(card); }
  setActivePath(path?: string): void {
    this.openGeneration++;
    for (const card of this.cards) {
      // A dragged card is a temporary comparison surface across reading tabs.
      // Its jump action still records the reader's current note and position.
      card.active = (card.pen && card.pinned) || card.origin.path === path || card.path === path;
      if (card.mobile && !card.active) this.minimize(card);
      card.el.hidden = !card.active || card.collapsed;
      if (card.restoreButton) card.restoreButton.hidden = !card.active || !card.collapsed;
    }
  }
  rename(from: string, to: string): void {
    for (const card of this.cards) {
      if (card.path === from) card.path = to;
      if (card.origin.path === from) card.origin.path = to;
    }
  }
  private fitPinned(card: Preview): void {
    const win = card.el.ownerDocument.defaultView!, rect = card.el.getBoundingClientRect();
    card.el.style.maxWidth = `${Math.max(300, win.innerWidth - rect.left - 12)}px`;
    card.el.style.maxHeight = `${Math.max(120, win.innerHeight - rect.top - 12)}px`;
  }
  private close(card: Preview): void {
    if (!this.cards.delete(card)) return;
    card.revision++; card.abort.abort(); card.component.unload(); card.el.remove();
    card.restoreButton?.remove();
    if (this.transient === card) this.transient = undefined;
  }
  destroy(): void {
    this.disposed = true; this.cancelOpen(); this.cancelClose();
    for (const card of [...this.cards]) this.close(card);
  }
}

export function highlightMathRow(container: HTMLElement, target: Target): void {
  const normal = (text: string | null) => (text ?? '').replace(/[()（）\s]/g, '');
  const labelCells = [...container.querySelectorAll<HTMLElement>('mjx-labels mjx-mtd, .mjx-label mjx-mtd')];
  // Older renderers can leave the label inside the body row. In CHTML the
  // first body cell is actual math, so do not mistake it for a tag.
  labelCells.push(...[...container.querySelectorAll<HTMLElement>('mjx-mlabeledtr > mjx-mtd:first-child')]
    .filter(cell => !cell.closest('mjx-mtable')?.querySelector(':scope > mjx-labels, :scope > .mjx-label')));
  const label = labelCells.find(el => normal(mathText(el)) === target.label);
  if (label) {
    label.classList.add('reflo-math-focus');
    const mathTable = label.closest('mjx-mtable');
    const inlineRow = label.parentElement;
    if (inlineRow?.tagName.toLowerCase() === 'mjx-mlabeledtr') {
      inlineRow.classList.add('reflo-math-focus');
    } else if (mathTable) {
      // CHTML combines consecutive unnumbered rows into one label spacer.
      // Pair actual label cells only with direct labeled body rows in this table.
      const labels = [...mathTable.querySelectorAll<HTMLElement>('mjx-labels mjx-mtd, .mjx-label mjx-mtd')]
        .filter(cell => cell.closest('mjx-mtable') === mathTable && normal(mathText(cell)) !== '');
      const rows = [...mathTable.querySelectorAll<HTMLElement>(':scope > mjx-table > mjx-itable > mjx-mlabeledtr')];
      const position = labels.indexOf(label);
      if (position >= 0 && labels.length === rows.length) rows[position].classList.add('reflo-math-focus');
    }
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
