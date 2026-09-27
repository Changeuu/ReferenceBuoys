import { EditorSuggest, type Editor, type EditorPosition, type EditorSuggestContext, type EditorSuggestTriggerInfo, type TFile, renderMath, finishRenderMath, loadMathJax } from 'obsidian';
import { displayName, referenceSource, type Target } from './core/model';
import type ReferenceBuoysPlugin from './main';

export class ReferenceSuggest extends EditorSuggest<Target> {
  constructor(private host: ReferenceBuoysPlugin) { super(host.app); this.limit = 12; }
  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!file || !this.host.settings.suggestions) return null;
    const line = editor.getLine(cursor.line);
    const before = line.slice(0, cursor.ch);
    const match = /@(fig|tab|add)?\{([^{}]*)$/.exec(before);
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
    const index = this.host.getEditorIndex(context.editor, context.file.path);
    const query = context.query.trim().toLocaleLowerCase();
    const prefix = context.editor.getLine(context.start.line).slice(context.start.ch).match(/^@(fig|tab|add)?\{/);
    const kind = prefix?.[1] === 'fig' ? 'figure' : prefix?.[1] === 'tab' ? 'table' : prefix?.[1] === 'add' ? 'addon' : undefined;
    return index.targets.filter(t => (!kind || t.kind === kind) && `${displayName(t).replace(' ', '')} ${t.heading} ${t.caption} ${t.math ?? ''}`.toLocaleLowerCase().includes(query)).slice(0, 12);
  }
  renderSuggestion(target: Target, el: HTMLElement): void {
    el.addClass('reflo-suggestion');
    const top = el.createDiv({ cls: 'reflo-suggestion-top' });
    top.createEl('strong', { text: displayName(target) });
    top.createSpan({ text: target.heading, cls: 'reflo-muted' });
    if (target.math && target.math.length < 600) {
      const mathEl = el.createDiv({ cls: 'reflo-suggestion-math' });
      const math = target.math;
      void loadMathJax().then(() => {
        if (!mathEl.isConnected) return;
        try { mathEl.appendChild(renderMath(math, true)); void finishRenderMath(); }
        catch { mathEl.textContent = math.slice(0, 100); }
      }).catch(() => { mathEl.textContent = math.slice(0, 100); });
    } else if (target.caption) el.createDiv({ text: target.caption, cls: 'reflo-suggestion-caption' });
  }
  selectSuggestion(target: Target): void {
    if (!this.context) return;
    const { editor, start, end } = this.context;
    const text = referenceSource(target);
    editor.replaceRange(text, start, end);
    editor.setCursor({ line: start.line, ch: start.ch + text.length });
    this.close();
  }
}
