import { editorLivePreviewField, type MarkdownView, type MarkdownPostProcessorContext } from 'obsidian';
import { indexField } from './editor';
import type { DocumentIndex } from './core/model';
import { parseHeadingLink, type HeadingReference } from './core/headings';
import type { ReferenceOrigin } from './ui/previews';
import type ReferenceBuoysPlugin from './main';

interface Link { el: HTMLElement; ref: HeadingReference; origin: ReferenceOrigin }

/** Intercept native link events at the pane boundary, without replacing Obsidian's link DOM. */
export class HeadingLinks {
  private panes = new Map<MarkdownView, AbortController>();
  private reading = new WeakMap<HTMLElement, Link>();
  constructor(private host: ReferenceBuoysPlugin) {}

  refresh(views: Set<MarkdownView>): void {
    for (const [view, abort] of this.panes) if (!views.has(view)) { abort.abort(); this.panes.delete(view); }
    for (const view of views) if (!this.panes.has(view)) {
      const abort = new AbortController(); this.panes.set(view, abort);
      const options = { capture: true, signal: abort.signal };
      const resolve = (event: Event): Link | undefined => this.resolve(view, event);
      for (const type of ['pointerdown', 'mousedown']) view.contentEl.addEventListener(type, event => {
        const mouse = event as MouseEvent;
        if (mouse.button !== 0 || modified(mouse) || !resolve(event)) return;
        // Avoid moving the caret into the source token or triggering native navigation before click.
        event.stopPropagation();
        if (!this.host.isMobile) event.preventDefault();
      }, options);
      view.contentEl.addEventListener('click', event => {
        if (event.button !== 0 || modified(event)) return;
        const link = resolve(event); if (!link) return;
        event.preventDefault(); event.stopPropagation();
        if (this.host.isMobile) void this.host.previews.open(link.el, link.ref, link.origin);
        else void this.host.followHeading(link.el, link.ref, link.origin);
      }, options);
      view.contentEl.addEventListener('mouseover', event => {
        if (this.host.isMobile || modified(event)) return;
        const link = resolve(event); if (!link) return;
        // Core Page Preview listens for the same native link hover; one preview is enough.
        event.stopPropagation();
        if (event.relatedTarget instanceof Node && link.el.contains(event.relatedTarget)) return;
        this.host.previews.queue(link.el, link.ref, link.origin);
      }, options);
      view.contentEl.addEventListener('mouseout', event => {
        const link = resolve(event); if (!link) return;
        if (event.relatedTarget instanceof Node && link.el.contains(event.relatedTarget)) return;
        this.host.previews.leaveSource(event.relatedTarget);
      }, options);
      view.contentEl.addEventListener('focusin', event => {
        const link = resolve(event);
        if (link && !this.host.isMobile) this.host.previews.queue(link.el, link.ref, link.origin);
      }, options);
      view.contentEl.addEventListener('focusout', event => {
        if (resolve(event)) this.host.previews.leaveSource(event.relatedTarget);
      }, options);
      view.contentEl.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || modified(event)) return;
        const link = resolve(event); if (!link) return;
        event.preventDefault(); event.stopPropagation();
        if (this.host.isMobile) void this.host.previews.open(link.el, link.ref, link.origin);
        else void this.host.followHeading(link.el, link.ref, link.origin);
      }, options);
    }
  }

  bindReading(el: HTMLElement, ctx: MarkdownPostProcessorContext, index: DocumentIndex): void {
    const section = ctx.getSectionInfo(el);
    let from = section ? index.source.split('\n').slice(0, section.lineStart).reduce((n, line) => n + line.length + 1, 0) : 0;
    const links = [...el.querySelectorAll<HTMLElement>('a.internal-link')];
    if (el.matches('a.internal-link')) links.unshift(el);
    for (const anchor of links) {
      if (anchor.closest('.internal-embed')) continue;
      const href = anchor.getAttribute('data-href') ?? anchor.getAttribute('href');
      if (!href) continue;
      const parsed = parseHeadingLink(`[[${href}]]`); if (!parsed) continue;
      const ref = index.headingLinks.find(r => r.from >= from && r.key === parsed.key && r.linkpath === parsed.linkpath);
      if (!ref) continue;
      from = ref.to;
      this.reading.set(anchor, { el: anchor, ref, origin: { path: ctx.sourcePath, from: ref.from, to: ref.to } });
    }
  }

  private resolve(view: MarkdownView, event: Event): Link | undefined {
    if (!this.host.settings.headingLinks || !(event.target instanceof Element)) return;
    const el = event.target.closest<HTMLElement>('a.internal-link, .cm-hmd-internal-link');
    if (!el || el.closest('.internal-embed, .reflo-preview')) return;
    if (el.closest('.cm-editor')) {
      const cm = this.host.cmForView(view), path = view.file?.path;
      if (!cm || !path || !cm.state.field(editorLivePreviewField, false)) return;
      let position: number;
      try { position = cm.posAtDOM(el); } catch { return; }
      const ref = cm.state.field(indexField).headingLinks.find(r => position >= r.from && position < r.to);
      if (!ref || cm.state.selection.ranges.some(s => s.empty ? s.head > ref.from && s.head <= ref.to : s.from < ref.to && s.to > ref.from)) return;
      return { el, ref, origin: { path, from: ref.from, to: ref.to, cm } };
    }
    const link = this.reading.get(el);
    return link && link.origin.path === view.file?.path ? { ...link, origin: { ...link.origin, view } } : undefined;
  }

  destroy(): void { for (const abort of this.panes.values()) abort.abort(); this.panes.clear(); }
}

function modified(event: MouseEvent | KeyboardEvent): boolean { return event.ctrlKey || event.metaKey || event.altKey || event.shiftKey; }
