import { setIcon } from 'obsidian';

export function iconButton(parent: HTMLElement, icon: string, label: string, action: (event: MouseEvent) => void): HTMLButtonElement {
  const button = parent.createEl('button', { cls: 'reflo-icon-button', attr: { type: 'button', 'aria-label': label, title: label } });
  setIcon(button, icon);
  button.addEventListener('click', event => { event.stopPropagation(); action(event); });
  return button;
}
export function clamp(value: number, min: number, max: number): number { return Math.min(Math.max(min, value), Math.max(min, max)); }

/** WebViews can suppress the next synthesized click after a swipe. Handle a
 * stationary touch explicitly and cancel its native click to avoid double actions. */
export function bindTouchButton(button: HTMLButtonElement, signal: AbortSignal): void {
  let start: { id: number; x: number; y: number } | undefined;
  button.addEventListener('touchstart', event => {
    const touch = event.touches[0];
    start = event.touches.length === 1 && !button.disabled ? { id: touch.identifier, x: touch.clientX, y: touch.clientY } : undefined;
  }, { passive: true, signal });
  button.addEventListener('touchmove', event => {
    const touch = [...event.touches].find(t => t.identifier === start?.id);
    if (!touch || event.touches.length !== 1 || Math.hypot(touch.clientX - start!.x, touch.clientY - start!.y) > 8) start = undefined;
  }, { passive: true, signal });
  button.addEventListener('touchcancel', () => { start = undefined; }, { signal });
  button.addEventListener('touchend', event => {
    const saved = start; start = undefined;
    const touch = [...event.changedTouches].find(t => t.identifier === saved?.id);
    if (!saved || !touch || !event.cancelable || event.touches.length || button.disabled || !button.isConnected
      || Math.hypot(touch.clientX - saved.x, touch.clientY - saved.y) > 8) return;
    event.preventDefault(); button.click();
  }, { passive: false, signal });
}
