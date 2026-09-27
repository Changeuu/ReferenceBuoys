import { setIcon } from 'obsidian';

export function iconButton(parent: HTMLElement, icon: string, label: string, action: (event: MouseEvent) => void): HTMLButtonElement {
  const button = parent.createEl('button', { cls: 'reflo-icon-button', attr: { type: 'button', 'aria-label': label, title: label } });
  setIcon(button, icon);
  button.addEventListener('click', event => { event.stopPropagation(); action(event); });
  return button;
}
export function clamp(value: number, min: number, max: number): number { return Math.min(Math.max(min, value), Math.max(min, max)); }
