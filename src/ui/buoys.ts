import { MarkdownView, Menu } from 'obsidian';
import { iconButton } from './dom';
import type ReferenceBuoysPlugin from '../main';
import type { ReturnPoint } from '../core/anchors';

export class BuoyPanel {
  private root: HTMLElement;
  private collapsed = false;
  private previousSignature = '';
  private longPressTimer?: number;
  constructor(private host: ReferenceBuoysPlugin, private view: MarkdownView) {
    view.contentEl.addClass('reflo-view-host');
    this.root = view.contentEl.createDiv({ cls: `reflo-buoys${host.isMobile ? ' reflo-mobile-buoys' : ''}`, attr: { 'aria-label': '本篇笔记的返回浮标' } });
  }
  render(): void {
    const path = this.view.file?.path;
    const points = path ? this.host.points.get(path) ?? [] : [];
    if (!points.length) { this.cancelLongPress(); this.root.empty(); this.root.hidden = true; this.previousSignature = ''; return; }
    this.root.hidden = false;
    this.root.dataset.side = this.host.settings.buoySide;
    const cm = this.host.cmForView(this.view);
    let position = 0;
    try { position = cm?.lineBlockAtHeight(cm.scrollDOM.scrollTop + (this.host.isMobile ? cm.scrollDOM.clientHeight / 2 : 0)).from ?? 0; } catch { /* An inactive pane has no layout yet. */ }
    const signature = `${path}:${this.collapsed}:${this.host.settings.buoySide}:${points.map(p => `${p.id}:${p.from}:${p.lost}:${p.heading}:${p.excerpt}:${p.from < position}`).join('|')}`;
    if (signature === this.previousSignature) return;
    this.previousSignature = signature;
    this.cancelLongPress();
    this.root.empty();
    if (this.host.isMobile) { this.renderMobile(points, position); return; }
    const header = this.root.createDiv({ cls: 'reflo-buoys-header' });
    const toggle = header.createEl('button', { cls: 'reflo-buoys-toggle', attr: { 'aria-expanded': String(!this.collapsed) } });
    toggle.setAttribute('aria-label', this.collapsed ? '展开返回浮标' : '折叠返回浮标');
    toggle.createSpan({ text: '返回' });
    toggle.createSpan({ text: String(points.length), cls: 'reflo-count' });
    toggle.createSpan({ text: this.collapsed ? '▸' : '▾', cls: 'reflo-buoys-chevron', attr: { 'aria-hidden': 'true' } });
    toggle.addEventListener('click', () => { this.collapsed = !this.collapsed; this.render(); });
    if (this.collapsed) return;
    const list = this.root.createDiv({ cls: 'reflo-buoys-list' });
    for (const point of [...points].reverse()) {
      const row = list.createDiv({ cls: `reflo-buoy${point.lost ? ' is-lost' : ''}` });
      const button = row.createEl('button', { cls: 'reflo-buoy-go', attr: { title: `${point.heading}\n${point.excerpt}${point.lost ? '\n原文已删除，将返回附近位置' : ''}` } });
      button.createSpan({ text: point.from < position ? '↑' : '↓', cls: 'reflo-buoy-direction', attr: { 'aria-hidden': 'true' } });
      button.createSpan({ text: point.lost ? '原文已删除 · 返回附近' : point.excerpt, cls: 'reflo-buoy-excerpt' });
      button.setAttribute('aria-label', `返回 ${point.heading}：${point.excerpt}`);
      button.addEventListener('click', () => { void this.host.returnTo(point, this.view); });
      iconButton(row, 'x', `移除浮标 ${point.id}`, () => this.host.removeBuoy(point));
    }
  }

  private renderMobile(points: ReturnPoint[], position: number): void {
    const above = this.root.createDiv({ cls: 'reflo-mobile-buoy-stack', attr: { 'data-edge': 'top' } });
    const below = this.root.createDiv({ cls: 'reflo-mobile-buoy-stack', attr: { 'data-edge': 'bottom' } });
    for (const point of [...points].reverse()) {
      const up = point.from < position;
      const button = (up ? above : below).createEl('button', {
        cls: `reflo-mobile-buoy${point.lost ? ' is-lost' : ''}`,
        text: `${up ? '↑' : '↓'} ${point.id}${point.lost ? ' ·' : ''}`,
        attr: { type: 'button', 'data-buoy-id': String(point.id),
          'aria-label': `返回浮标 ${point.id}${point.lost ? '，原文已删除，将返回附近位置' : ''}` }
      });
      let start: { x: number; y: number } | undefined;
      let menuShown = false;
      const menu = (x: number, y: number) => {
        this.cancelLongPress();
        if (menuShown || !button.isConnected) return;
        menuShown = true;
        new Menu().addItem(item => item.setTitle('移除浮标').setIcon('x').onClick(() => this.host.removeBuoy(point)))
          .showAtPosition({ x, y });
      };
      button.addEventListener('pointerdown', event => {
        this.cancelLongPress(); menuShown = false;
        if (event.button !== 0) return;
        start = { x: event.clientX, y: event.clientY };
        this.longPressTimer = window.setTimeout(() => { if (start) menu(start.x, start.y); }, 550);
      });
      button.addEventListener('pointermove', event => {
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) { start = undefined; this.cancelLongPress(); }
      });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(type, () => { start = undefined; this.cancelLongPress(); });
      button.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); menu(event.clientX, event.clientY); });
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        if (!menuShown) void this.host.returnTo(point, this.view);
      });
    }
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== undefined) window.clearTimeout(this.longPressTimer);
    this.longPressTimer = undefined;
  }
  destroy(): void { this.cancelLongPress(); this.root.remove(); this.view.contentEl.removeClass('reflo-view-host'); }
}
