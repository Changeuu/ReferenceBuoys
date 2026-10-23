import { displayName, type Target, type TargetKind } from './model';

const labels = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Match literal labels of any shape; metadata matches must not bury label matches. */
export function referenceSuggestions(targets: Target[], query: string, kind?: TargetKind): Target[] {
  const original = query.trim(), needle = original.toLowerCase();
  return targets.flatMap(target => {
    if (kind && target.kind !== kind) return [];
    const label = target.label.toLowerCase();
    const rank = !needle || target.label === original ? 0
      : label === needle ? 1
      : label.startsWith(needle) ? 2
      : label.includes(needle) ? 3
      : `${displayName(target).replace(' ', '')} ${target.heading} ${target.caption} ${target.math ?? ''}`.toLowerCase().includes(needle) ? 4 : -1;
    return rank < 0 ? [] : [{ target, rank }];
  }).sort((a, b) => a.rank - b.rank || labels.compare(a.target.label, b.target.label))
    .map(item => item.target);
}
