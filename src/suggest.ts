import { EditorSuggest, type Editor, type EditorPosition, type EditorSuggestContext, type EditorSuggestTriggerInfo, type TFile, renderMath, finishRenderMath, loadMathJax } from 'obsidian';
import { displayName, referenceSource, type Target, typedKinds } from './core/model';
import { referenceSuggestions } from './core/suggestions';
import type ReferenceBuoysPlugin from './main';

export class ReferenceSuggest extends EditorSuggest<Target> {
  private mathObserver?: IntersectionObserver;
  private pendingMath = new Map<Element, () => void>();
  private mathGeneration = 0;
  constructor(private host: ReferenceBuoysPlugin) {
    super(host.app);
    this.limit = Number.MAX_SAFE_INTEGER;
    host.register(() => this.clearMath());
  }
  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!file || !this.host.settings.suggestions) return null;
    const line = editor.getLine(cursor.line);
    const before = line.slice(0, cursor.ch);
    const match = /@(fig|tab|add|def|thm)?\{([^{}]*)$/.exec(before);
    if (!match || match[2].startsWith('#')) return null;
    const from = before.length - match[0].length;
    if ((/\\+$/.exec(before.slice(0, from))?.[0].length ?? 0) % 2 === 1) return null;
    const index = this.host.getEditorIndex(editor, file.path);
    const offset = editor.posToOffset({ line: cursor.line, ch: from });
    if (index.excluded.some(r => offset >= r.from && offset < r.to)) return null;
    const tail = line.slice(cursor.ch);
    const close = /^[^{}]*\}/.exec(tail);
    return { start: { line: cursor.line, ch: from }, end: { line: cursor.line, ch: cursor.ch + (close?.[0].length ?? 0) }, query: match[2] };
  }
  getSuggestions(context: EditorSuggestContext): Target[] {
    this.clearMath();
    const index = this.host.getEditorIndex(context.editor, context.file.path);
    const prefix = context.editor.getLine(context.start.line).slice(context.start.ch).match(/^@(fig|tab|add|def|thm)?\{/);
    const kind = typedKinds[prefix?.[1] as keyof typeof typedKinds];
    return referenceSuggestions(index.targets, context.query, kind);
  }
  renderSuggestion(target: Target, el: HTMLElement): void {
    el.addClass('reflo-suggestion');
    const top = el.createDiv({ cls: 'reflo-suggestion-top' });
    top.createEl('strong', { text: displayName(target) });
    top.createSpan({ text: target.heading, cls: 'reflo-muted' });
    if (target.math && target.math.length < 600) {
      const mathEl = el.createDiv({ cls: 'reflo-suggestion-math' });
      const math = target.math, generation = this.mathGeneration;
      const current = () => generation === this.mathGeneration && mathEl.isConnected;
      // All matches remain available, but only visible candidates need MathJax.
      // Use the element's window so suggestions also work in pop-out windows.
      this.mathObserver ??= new el.ownerDocument.defaultView!.IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) {
          this.mathObserver?.unobserve(entry.target);
          const render = this.pendingMath.get(entry.target);
          this.pendingMath.delete(entry.target); render?.();
        }
      });
      this.pendingMath.set(mathEl, () => {
        void loadMathJax().then(() => {
          if (!current()) return;
          try { mathEl.appendChild(renderMath(math, true)); void finishRenderMath(); }
          catch { mathEl.textContent = math.slice(0, 100); }
        }).catch(() => { if (current()) mathEl.textContent = math.slice(0, 100); });
      });
      this.mathObserver.observe(mathEl);
    } else if (target.caption) el.createDiv({ text: target.caption, cls: 'reflo-suggestion-caption' });
  }
  private clearMath(): void {
    this.mathGeneration++;
    this.mathObserver?.disconnect(); this.mathObserver = undefined;
    this.pendingMath.clear();
  }
  close(): void { this.clearMath(); super.close(); }
  selectSuggestion(target: Target): void {
    if (!this.context) return;
    const { editor, start, end } = this.context;
    const text = referenceSource(target);
    editor.replaceRange(text, start, end);
    editor.setCursor({ line: start.line, ch: start.ch + text.length });
    this.close();
  }
}
