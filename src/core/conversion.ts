import { referenceSource, type TargetKind } from './model';

export interface ConversionTemplate { pattern: string; kind: TargetKind }
export interface ConversionProfile {
  id: string;
  name: string;
  includePresets: boolean;
  templates: ConversionTemplate[];
}
export interface ConversionMatch { kind: TargetKind; label: string; replacement: string; template: string }
export type DragModifier = 'off' | 'Alt' | 'Control';
export const PRESET_TEMPLATES: ConversionTemplate[] = [
  ...['式{n}', '式({n})', '(式{n})', '公式{n}', '公式({n})', '({n})', 'Eq. ({n})', 'Eq. {n}', 'Equation ({n})']
    .map(pattern => ({ pattern, kind: 'equation' as const })),
  ...['图{n}', '图({n})', '(图{n})', 'Fig. {n}', 'Fig. ({n})', 'Figure {n}']
    .map(pattern => ({ pattern, kind: 'figure' as const })),
  ...['表{n}', '表({n})', '(表{n})', 'Table {n}'].map(pattern => ({ pattern, kind: 'table' as const })),
  ...['附{n}', '附({n})', '(附{n})'].map(pattern => ({ pattern, kind: 'addon' as const }))
];
export function defaultProfiles(): ConversionProfile[] {
  return [{ id: 'default', name: '通用', includePresets: true, templates: [] }];
}

const isKind = (value: unknown): value is TargetKind => ['equation', 'figure', 'table', 'addon'].includes(String(value));
export function loadProfiles(raw: unknown): ConversionProfile[] {
  if (!Array.isArray(raw)) return defaultProfiles();
  const seen = new Set<string>();
  const profiles: ConversionProfile[] = [];
  for (const item of raw) {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    profiles.push({ id: item.id, name: typeof item.name === 'string' ? item.name : '未命名', includePresets: item.includePresets !== false,
      templates: Array.isArray(item.templates) ? item.templates.filter((t: any) => t && typeof t.pattern === 'string' && isKind(t.kind))
        .map((t: ConversionTemplate) => ({ pattern: t.pattern, kind: t.kind })) : [] });
  }
  return profiles.length ? profiles : defaultProfiles();
}

export function templateError(pattern: string): string | undefined {
  if (!pattern.trim()) return '请输入模板，例如 式({n})。';
  if (pattern.length > 200 || /[\r\n]/.test(pattern)) return '模板需要在一行内，长度不超过 200 字符。';
  if (pattern.split('{n}').length !== 2 || /[{}]/.test(pattern.replace('{n}', ''))) return '模板需要且只能包含一个 {n}。';
}

const space = '[^\\S\\r\\n]*';
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function literalPattern(text: string): string {
  const brackets: Record<string, string> = { '(': '[(（]', '（': '[(（]', ')': '[)）]', '）': '[)）]', '[': '[\\[［]', '［': '[\\[［]', ']': '[\\]］]', '］': '[\\]］]' };
  let result = '';
  for (const char of text) {
    const part = /\s/.test(char) ? space : brackets[char] ? `${space}${brackets[char]}${space}` : escapeRegex(char);
    result += part;
  }
  // Consecutive optional-space groups would add needless regex backtracking.
  return result.split(space).filter((part, i, all) => part || i === 0 || i === all.length - 1).join(space);
}

/** Anchored matching on one explicitly selected reference, never a document search. */
export function matchSelectedReference(text: string, profile: ConversionProfile): ConversionMatch[] {
  if (!text.trim() || text.length > 500 || /[\r\n]/.test(text)) return [];
  const leading = /^\s*/.exec(text)![0], trailing = /\s*$/.exec(text)![0];
  const input = text.trim();
  const templates = [...(profile.includePresets ? PRESET_TEMPLATES : []), ...profile.templates];
  const matches = new Map<string, ConversionMatch>();
  for (const template of templates) {
    if (templateError(template.pattern)) continue;
    const [prefix, suffix] = template.pattern.trim().split('{n}');
    // Labels retain their case and spelling; a prose sentence/list is not a label.
    const labelPattern = '([A-Za-z0-9]+(?:[.\\-][A-Za-z0-9]+)*(?:\\([A-Za-z0-9]+\\))?)';
    const regex = new RegExp(`^${literalPattern(prefix)}${space}${labelPattern}${space}${literalPattern(suffix)}$`);
    const match = regex.exec(input);
    if (!match || match[1].length > 100) continue;
    const replacement = leading + referenceSource({ kind: template.kind, label: match[1] }) + trailing;
    matches.set(replacement, { kind: template.kind, label: match[1], replacement, template: template.pattern });
  }
  return [...matches.values()];
}

export function modifierHeld(event: Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>, mode: DragModifier): boolean {
  if (event.metaKey || event.shiftKey) return false;
  return mode === 'Alt' ? event.altKey && !event.ctrlKey : mode === 'Control' ? event.ctrlKey && !event.altKey : false;
}
