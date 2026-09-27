// A deliberately small Obsidian API substitute for component tests, not an app emulator.
import { StateField } from '@codemirror/state';
import MarkdownIt from 'markdown-it';
declare global { interface Window { MathJax: any; lab: any } }
export const editorLivePreviewField = StateField.define<boolean>({ create: () => true, update: value => value });
export const editorInfoField = StateField.define<any>({ create: () => (window as any).__info, update: value => value });
export class Component {
  cleanups: Array<() => void> = [];
  load() {} unload() { this.cleanups.splice(0).forEach(fn => fn()); }
  register(fn: () => void) { this.cleanups.push(fn); }
}
export class TFile { extension = 'md'; constructor(public path: string) {} }
export class MarkdownView {
  file: any; contentEl!: HTMLElement; editor: any; leaf: any;
  getMode() { return 'source'; }
  setEphemeralState() {}
}
export class Plugin extends Component {
  extensions: any[] = []; commands: any[] = []; processors: any[] = [];
  constructor(public app: any, public manifest: any) { super(); }
  async loadData() { return null; } async saveData(data: any) { (window as any).savedData = data; }
  addSettingTab() {} registerEditorSuggest() {}
  registerEditorExtension(extension: any) { this.extensions.push(extension); }
  registerMarkdownPostProcessor(fn: any) { this.processors.push(fn); }
  registerEvent() {}
  registerDomEvent(el: EventTarget, type: string, fn: EventListener, options?: any) { el.addEventListener(type, fn, options); this.register(() => el.removeEventListener(type, fn, options)); }
  addCommand(command: any) { this.commands.push(command); }
}
export class PluginSettingTab { containerEl: any; constructor(..._args: any[]) {} }
export class Setting { constructor(..._args: any[]) {} }
export class EditorSuggest<T> { limit = 0; context: any; constructor(..._args: any[]) {} close() {} }
export class Notice { constructor(message: string) { (window as any).notices.push(message); } }
export class Modal {
  modalEl = document.createElement('div');
  titleEl = document.createElement('h2'); contentEl = document.createElement('div');
  constructor(..._args: any[]) { this.modalEl.className = 'test-modal'; this.modalEl.append(this.titleEl, this.contentEl); }
  open() { document.body.appendChild(this.modalEl); this.onOpen(); }
  close() { this.onClose(); this.modalEl.remove(); }
  onOpen() {} onClose() {}
}
export class Menu { addItem(fn: any) { fn({ setTitle() { return this; }, setIcon() { return this; }, onClick() { return this; } }); } showAtMouseEvent() {} }
export function setIcon(el: HTMLElement, name: string) {
  const paths: Record<string, string> = {
    x: '<path d="m6 6 12 12M6 18 18 6"/>', pin: '<path d="m16 3 5 5-4 1-4 4v4l-3-3-6 6 6-6-3-3h4l4-4z"/>',
    'pin-off': '<path d="m16 3 5 5-4 1-4 4v4l-3-3-6 6M3 3l18 18"/>', sigma: '<path d="M19 4H5l8 8-8 8h14"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/><circle cx="15" cy="8" r="1"/>',
    'table-2': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
    'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>'
  };
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? '<circle cx="12" cy="12" r="8"/>'}</svg>`;
}
export function renderMath(math: string, display: boolean) { return window.MathJax.tex2chtml(math, { display }); }
export async function loadMathJax() { await window.MathJax.startup.promise; }
export async function finishRenderMath() {
  const mathDocument = window.MathJax.startup.document;
  const style = mathDocument.outputJax.styleSheet(mathDocument);
  const previous = document.getElementById('MJX-CHTML-styles');
  if (previous && previous !== style) previous.remove();
  if (!style.isConnected) document.head.appendChild(style);
}
const md = new MarkdownIt({ html: false });
md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  if (state.src.slice(start, start + 2) !== '$$') return false;
  const end = state.src.indexOf('$$', start + 2);
  if (end < 0 || end >= (state.bMarks[endLine] ?? state.src.length)) return false;
  if (silent) return true;
  let nextLine = startLine + 1;
  while (nextLine < endLine && state.bMarks[nextLine] < end + 2) nextLine++;
  const token = state.push('math_block', '', 0);
  token.content = state.src.slice(start + 2, end);
  token.map = [startLine, nextLine]; token.block = true;
  state.line = nextLine;
  return true;
}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
md.renderer.rules.math_block = (tokens, idx) => renderMath(tokens[idx].content, true).outerHTML;
md.inline.ruler.before('escape', 'math', (state, silent) => {
  if (state.src[state.pos] !== '$') return false;
  const end = state.src.indexOf('$', state.pos + 1);
  if (end < 0) return false;
  if (!silent) { const token = state.push('math', '', 0); token.content = state.src.slice(state.pos + 1, end); }
  state.pos = end + 1; return true;
});
md.renderer.rules.math = (tokens, idx) => renderMath(tokens[idx].content, false).outerHTML;
export class MarkdownRenderer {
  static async render(_app: any, source: string, el: HTMLElement, _path: string, _component: any) {
    const expanded = source.replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_, name) => `![](/examples/${encodeURIComponent(name)})`);
    el.innerHTML = md.render(expanded);
    await finishRenderMath();
  }
}

function create(parent: HTMLElement, tag: string, options?: any) {
  const el = parent.ownerDocument.createElement(tag);
  if (typeof options === 'string') el.className = options;
  else if (options) {
    if (options.cls) el.className = options.cls;
    if (options.text) el.textContent = options.text;
    if (options.type) el.setAttribute('type', options.type);
    if (options.value !== undefined) (el as HTMLInputElement).value = options.value;
    for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, String(value));
  }
  parent.appendChild(el); return el;
}
Object.assign(HTMLElement.prototype, {
  empty() { this.replaceChildren(); },
  setText(text: string) { this.textContent = text; },
  createEl(tag: string, options: any) { return create(this, tag, options); },
  createDiv(options: any) { return create(this, 'div', options); },
  createSpan(options: any) { return create(this, 'span', options); },
  addClass(...classes: string[]) { this.classList.add(...classes); },
  removeClass(...classes: string[]) { this.classList.remove(...classes); },
  toggleClass(name: string, value: boolean) { this.classList.toggle(name, value); }
});
