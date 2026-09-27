import { EditorSelection, Prec, type Text } from '@codemirror/state';
import { EditorView, ViewPlugin, type MouseSelectionStyle, type ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { modifierHeld, type DragModifier } from './core/conversion';
import type ReferenceBuoysPlugin from './main';

interface Gesture { anchor: number; head: number; x: number; y: number; moved: boolean; mode: DragModifier; doc: Text; path: string }

export function dragConversionExtension(host: ReferenceBuoysPlugin) {
  return ViewPlugin.fromClass(class {
    private gesture?: Gesture;
    private timer?: number;
    private generation = 0;
    private usedAlt = false;
    private doc: Document;
    private win: Window;
    constructor(private view: EditorView) {
      this.doc = view.dom.ownerDocument; this.win = this.doc.defaultView!;
      this.doc.addEventListener('mouseup', this.finish);
      this.doc.addEventListener('keydown', this.keydown);
      this.doc.addEventListener('keyup', this.keyup);
      this.win.addEventListener('blur', this.blur);
    }
    start(event: MouseEvent): MouseSelectionStyle | null {
      this.cancel();
      const mode = host.settings.dragConversion;
      const path = this.view.state.field(editorInfoField, false)?.file?.path;
      if (event.button !== 0 || event.detail > 1 || !path || !modifierHeld(event, mode)
        || this.view.state.readOnly || !this.view.state.facet(EditorView.editable)) return null;
      const el = event.target as HTMLElement;
      if (!this.view.contentDOM.contains(el) || el.closest('a, button, input, textarea, .reflo-caption-label')) return null;
      const anchor = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (anchor === null) return null;
      const gesture: Gesture = { anchor, head: anchor, x: event.clientX, y: event.clientY, moved: false, mode, path, doc: this.view.state.doc };
      this.gesture = gesture;
      // A fresh gesture must select text, even if it starts inside an old selection.
      // Otherwise the browser may begin dragging/moving the previously selected text.
      this.view.dispatch({ selection: EditorSelection.single(anchor), userEvent: 'select.pointer' });
      return {
        get: event => {
          gesture.head = this.view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? gesture.head;
          gesture.moved ||= Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4;
          if (gesture.moved && gesture.mode === 'Alt') this.usedAlt = true;
          return EditorSelection.single(gesture.anchor, gesture.head);
        },
        update: update => {
          if (update.docChanged) {
            gesture.anchor = update.changes.mapPos(gesture.anchor);
            gesture.head = update.changes.mapPos(gesture.head);
            this.cancel();
          }
        }
      };
    }
    private finish = (event: MouseEvent) => {
      const gesture = this.gesture;
      this.gesture = undefined;
      if (!gesture || event.button !== 0 || !gesture.moved || gesture.anchor === gesture.head
        || host.settings.dragConversion !== gesture.mode || !modifierHeld(event, gesture.mode)
        || !this.view.contentDOM.contains(event.target as Node)) return;
      const generation = ++this.generation;
      // Let CodeMirror complete its native selection gesture before replacing text.
      this.timer = this.win.setTimeout(() => {
        this.timer = undefined;
        if (generation !== this.generation || !this.view.dom.isConnected || this.view.state.doc !== gesture.doc
          || this.view.state.field(editorInfoField, false)?.file?.path !== gesture.path
          || !this.view.state.selection.eq(EditorSelection.single(gesture.anchor, gesture.head))) return;
        host.converter.convert(this.view);
      }, 0);
    };
    private keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') this.cancel(); };
    private blur = () => { this.usedAlt = false; this.cancel(); };
    private keyup = (event: KeyboardEvent) => {
      // Consume Alt's menu activation only after it was used for this gesture.
      if (event.key === 'Alt' && this.usedAlt) { event.preventDefault(); this.usedAlt = false; }
      if (this.gesture && event.key === this.gesture.mode) this.cancel();
    };
    private cancel = () => {
      this.gesture = undefined; this.generation++;
      if (this.timer !== undefined) this.win.clearTimeout(this.timer);
      this.timer = undefined;
    };
    update(update: ViewUpdate): void { if (update.docChanged) this.cancel(); }
    destroy(): void {
      this.cancel();
      this.doc.removeEventListener('mouseup', this.finish);
      this.doc.removeEventListener('keydown', this.keydown);
      this.doc.removeEventListener('keyup', this.keyup);
      this.win.removeEventListener('blur', this.blur);
    }
  }, { provide: plugin => Prec.highest(EditorView.mouseSelectionStyle.of((view, event) => view.plugin(plugin)?.start(event) ?? null)) });
}
