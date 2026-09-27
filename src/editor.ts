import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import { indexDocument } from './core/parser';
import { displayName, type DocumentIndex, type Reference } from './core/model';
import type ReferenceBuoysPlugin from './main';
import { dragConversionExtension } from './drag-conversion';

export const indexField = StateField.define<DocumentIndex>({
  create: state => indexDocument(state.doc.toString()),
  update: (value, transaction) => transaction.docChanged ? indexDocument(transaction.newDoc.toString()) : value
});
export const flashEffect = StateEffect.define<{ from: number; to: number } | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(flashEffect)) {
      value = effect.value && effect.value.to > effect.value.from
        ? Decoration.set([Decoration.mark({ class: 'reflo-jump-highlight' }).range(effect.value.from, effect.value.to)])
        : Decoration.none;
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field)
});

class ReferenceWidget extends WidgetType {
  constructor(private host: ReferenceBuoysPlugin, private ref: Reference, private path: string, private status: number) { super(); }
  eq(other: ReferenceWidget): boolean {
    return this.path === other.path && this.ref.from === other.ref.from && this.ref.to === other.ref.to
      && this.ref.key === other.ref.key && this.ref.definition === other.ref.definition && this.status === other.status;
  }
  toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument;
    if (this.ref.definition) {
      const el = doc.createElement('span');
      el.className = `reflo-caption-label${this.status === 0 ? ' is-invalid' : ''}`;
      el.textContent = displayName(this.ref);
      if (this.status === 0) el.setAttribute('aria-description', '编号标记前面需要紧接对应的内容块');
      return el;
    }
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `reflo-reference reflo-${this.ref.kind}${this.status === 0 ? ' is-missing' : this.status > 1 ? ' is-ambiguous' : ''}`;
    button.textContent = `（${displayName(this.ref)}）`;
    button.dataset.refloKey = this.ref.key;
    // Obsidian turns aria-label into a visual tooltip. The visible button text
    // already supplies its accessible name; keep status separate from that tooltip.
    if (this.status === 0) button.setAttribute('aria-description', '未找到目标');
    else if (this.status > 1) button.setAttribute('aria-description', '存在重复编号');
    this.host.bindReference(button, this.ref, this.path, view);
    return button;
  }
  ignoreEvent(): boolean { return true; }
}

function decorations(view: EditorView, host: ReferenceBuoysPlugin): DecorationSet {
  if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
  const index = view.state.field(indexField);
  const path = view.state.field(editorInfoField, false)?.file?.path;
  if (!path) return Decoration.none;
  const ranges = [];
  for (const ref of index.references) {
    if (!view.visibleRanges.some(r => ref.to > r.from && ref.from < r.to)) continue;
    // Arrow keys put the caret inside the token and reveal its exact editable source.
    if (view.state.selection.ranges.some(s => s.empty
      ? s.head > ref.from && s.head <= ref.to
      : s.from < ref.to && s.to > ref.from)) continue;
    const status = index.byKey.get(ref.key)?.length ?? 0;
    ranges.push(Decoration.replace({ widget: new ReferenceWidget(host, ref, path, status) }).range(ref.from, ref.to));
  }
  return Decoration.set(ranges, true);
}

export function editorExtensions(host: ReferenceBuoysPlugin): Extension[] {
  const live = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(public view: EditorView) {
      this.decorations = decorations(view, host);
      host.observeEditor(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.transactions.length) {
        this.decorations = decorations(update.view, host);
      }
      if (update.docChanged) host.editorChanged(update);
      else host.observeEditor(update.view);
    }
    destroy(): void { host.forgetEditor(this.view); }
  }, { decorations: value => value.decorations });
  return [indexField, live, flashField, ...(host.isMobile ? [] : [dragConversionExtension(host)])];
}
