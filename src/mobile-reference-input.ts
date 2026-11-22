export type ReferenceActivation = 'preview' | 'follow' | 'ignore';
type Modifiers = Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;
export const modifiedInput = (event: Modifiers): boolean => event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

interface Gesture {
  id: number;
  type: string;
  target: Element;
  x: number;
  y: number;
  started: number;
  valid: boolean;
}
interface Completed extends Gesture { ended: number; consumed: boolean }

/** Observe contacts once per document. Click is the only activation event, so
 * pointerup and a WebView's compatibility mouse events cannot activate twice. */
export class MobileReferenceInput {
  private abort = new AbortController();
  private active = new Map<number, Gesture>();
  private completed: Completed[] = [];
  constructor(doc: Document, private enabled: () => boolean) {
    const options = { capture: true, passive: true, signal: this.abort.signal };
    doc.addEventListener('pointerdown', event => {
      if (!this.enabled() || !(event.target instanceof Element)) { this.reset(); return; }
      this.prune();
      // Pointer IDs can be reused for the next real tap.
      this.completed = this.completed.filter(item => item.id !== event.pointerId);
      this.active.set(event.pointerId, {
        id: event.pointerId, type: event.pointerType, target: event.target,
        x: event.clientX, y: event.clientY, started: performance.now(),
        valid: event.button === 0 && event.isPrimary && !modifiedInput(event)
      });
      if (this.active.size > 1) this.invalidate();
    }, options);
    doc.addEventListener('pointermove', event => {
      const gesture = this.active.get(event.pointerId);
      if (gesture && (modifiedInput(event) || Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8)) gesture.valid = false;
    }, options);
    const finish = (event: PointerEvent, cancelled: boolean) => {
      const gesture = this.active.get(event.pointerId);
      if (!gesture) return;
      this.active.delete(event.pointerId);
      gesture.valid &&= !cancelled && event.button === 0 && !modifiedInput(event)
        && performance.now() - gesture.started <= 700
        && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 8;
      this.completed.push({ ...gesture, ended: performance.now(), consumed: false });
      this.prune();
    };
    doc.addEventListener('pointerup', event => finish(event, false), options);
    doc.addEventListener('pointercancel', event => finish(event, true), options);
    doc.addEventListener('scroll', () => this.invalidate(), options);
    doc.addEventListener('contextmenu', () => this.invalidate(), options);
    doc.defaultView?.addEventListener('blur', () => {
      // A lost contact may never send pointerup after switching applications.
      for (const item of this.active.values()) this.completed.push({ ...item, valid: false, ended: performance.now(), consumed: false });
      this.active.clear(); this.prune();
    }, { signal: this.abort.signal });
  }

  activation(event: MouseEvent, element: HTMLElement): ReferenceActivation {
    if (!this.enabled()) return 'preview';
    this.prune();
    const pointer = event as Partial<PointerEvent>;
    const type = pointer.pointerType ?? '';
    // Keyboard and assistive activation have no contact to classify. Do not
    // inherit a previous finger tap merely because it occurred on this link.
    if (!type && event.detail === 0) return 'preview';
    const matching = (item: Gesture) => element.contains(item.target);
    const typed = type && pointer.pointerId !== undefined
      ? [...this.completed].reverse().find(item => item.id === pointer.pointerId && item.type === type) : undefined;
    const contact = type ? typed : [...this.completed].reverse().find(matching);
    if (contact) {
      if (!matching(contact) || contact.consumed) return 'ignore';
      contact.consumed = true;
      if (!contact.valid || this.active.size || performance.now() - contact.ended > 1200) return 'ignore';
      return contact.type === 'touch' ? 'follow' : 'preview';
    }
    // Clicks delivered without their pointer sequence are deliberately safe:
    // explicit pen, unknown touch and accessibility all preview, never jump.
    if (this.active.size) return 'ignore';
    // An explicit new input identity must not inherit an old touch contact.
    // Retire that contact so a delayed legacy click cannot reverse this choice.
    for (const item of this.completed) if (matching(item)) item.consumed = true;
    return 'preview';
  }

  private invalidate(): void { for (const item of this.active.values()) item.valid = false; }
  private prune(): void {
    // Retain rejection records until replaced by real contact. Late WebView
    // clicks after a scroll/cancel are suppressed even beyond the tap window.
    this.completed = this.completed.slice(-16);
  }
  private reset(): void { this.active.clear(); this.completed = []; }
  destroy(): void { this.abort.abort(); this.reset(); }
}
