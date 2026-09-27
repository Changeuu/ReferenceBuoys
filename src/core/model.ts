export type TargetKind = 'equation' | 'figure' | 'table' | 'addon';
export interface Span { from: number; to: number }
export interface Reference extends Span {
  kind: TargetKind;
  label: string;
  key: string;
  definition: boolean;
}
export interface Target extends Span {
  kind: TargetKind;
  label: string;
  key: string;
  line: number;
  focus: Span;
  markdown: string;
  math?: string;
  tagIndex?: number;
  tagCount?: number;
  heading: string;
  caption: string;
  definition?: Span;
}
export interface DocumentIndex {
  source: string;
  references: Reference[];
  targets: Target[];
  byKey: Map<string, Target[]>;
  excluded: Span[];
}
export const kindName: Record<TargetKind, string> = {
  equation: '式', figure: '图', table: '表', addon: '附'
};
export function targetKey(kind: TargetKind, label: string): string {
  return `${kind}\u0000${label}`;
}
export function displayName(item: Pick<Reference, 'kind' | 'label'>): string {
  return `${kindName[item.kind]} ${item.label}`;
}
export function referenceSource(item: Pick<Reference, 'kind' | 'label'>): string {
  const prefix = item.kind === 'equation' ? '' : item.kind === 'figure' ? 'fig' : item.kind === 'table' ? 'tab' : 'add';
  return `@${prefix}{${item.label}}`;
}
