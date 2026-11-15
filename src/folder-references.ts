import type { DocumentIndex, Target } from './core/model';

export interface LocatedTarget { path: string; target: Target }

const folder = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1);

/** Read only the current note and its immediate Markdown siblings, on demand.
 * The host supplies live editor contents and invalidates its file cache. */
export class FolderReferences {
  constructor(
    private getIndex: (path: string) => Promise<DocumentIndex | undefined>,
    private siblingPaths: (sourcePath: string) => string[]
  ) {}

  async resolve(path: string, key: string): Promise<LocatedTarget[]> {
    const local = (await this.getIndex(path))?.byKey.get(key) ?? [];
    // Keep existing within-note meanings, including locally ambiguous labels.
    if (local.length) return local.map(target => ({ path, target }));
    return (await this.siblingIndexes(path)).flatMap(entry =>
      (entry.index.byKey.get(key) ?? []).map(target => ({ path: entry.path, target })));
  }

  async suggestions(path: string): Promise<LocatedTarget[]> {
    const local = (await this.getIndex(path))?.targets ?? [];
    const localKeys = new Set(local.map(target => target.key));
    const siblings = await this.siblingIndexes(path);
    return [
      ...local.map(target => ({ path, target })),
      ...siblings.flatMap(entry => entry.index.targets.filter(target => !localKeys.has(target.key))
        .map(target => ({ path: entry.path, target })))
    ];
  }

  private async siblingIndexes(sourcePath: string): Promise<Array<{ path: string; index: DocumentIndex }>> {
    const parent = folder(sourcePath);
    // Enforce scope even if a caller accidentally supplies a broader file list.
    const paths = [...new Set(this.siblingPaths(sourcePath))]
      .filter(path => path !== sourcePath && /\.md$/i.test(path) && folder(path) === parent)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const results: Array<{ path: string; index: DocumentIndex } | undefined> = new Array(paths.length);
    let next = 0;
    const read = async () => {
      while (next < paths.length) {
        const position = next++, path = paths[position];
        try {
          const index = await this.getIndex(path);
          if (index) results[position] = { path, index };
        } catch {
          // A sibling can disappear or become unreadable during a vault update.
          // It must not prevent the remaining notes from providing references.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, paths.length) }, read));
    return results.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  }
}
