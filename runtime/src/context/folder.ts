/**
 * Plain-folder adapter: any directory of `.md`, `.txt` and `.json` files (JSON is pretty-printed so
 * that each field is one line). The same hard excludes as the vault adapter apply; frontmatter is
 * skipped but carries no weight here.
 */
import { recencyBoost, termMatchers } from './match.js';
import { HARD_EXCLUDES, parseFrontmatter, rankSnippets } from './obsidian.js';
import { compileExcludes, readTextCapped, scanText, walkFiles, type WalkedFile } from './scan.js';
import { storeLabel, type ContextQuery, type KnowledgeStore, type Snippet } from './store.js';

export const FOLDER_EXTS: readonly string[] = ['.md', '.txt', '.json'];

export class FolderStore implements KnowledgeStore {
  readonly kind = 'folder' as const;
  readonly id: string;
  private readonly excludes: RegExp[];
  private files?: WalkedFile[];

  constructor(
    readonly root: string,
    excludes: readonly string[] = [],
  ) {
    this.id = storeLabel('folder', root);
    this.excludes = compileExcludes([...HARD_EXCLUDES.filter((p) => !p.endsWith('.jsonl')), ...excludes]);
  }

  list(): WalkedFile[] {
    if (!this.files) this.files = walkFiles(this.root, FOLDER_EXTS, this.excludes);
    return this.files;
  }

  describe(): { root: string; files: number } {
    return { root: this.root, files: this.list().length };
  }

  retrieve(q: ContextQuery): Snippet[] {
    const matchers = termMatchers(q.terms);
    if (!matchers.length) return [];
    const found: Snippet[] = [];
    for (const f of this.list()) {
      let text = readTextCapped(f.abs, f.size);
      if (text === undefined) continue;
      let startLine = 0;
      if (f.rel.toLowerCase().endsWith('.json')) {
        try {
          text = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          /* not valid JSON: scan it as text */
        }
      } else if (f.rel.toLowerCase().endsWith('.md')) {
        startLine = parseFrontmatter(text).bodyOffset;
      }
      const modified = new Date(f.mtimeMs).toISOString();
      found.push(...scanText(text, { store: this.id, file: f.rel, modified, matchers, weight: recencyBoost(modified, q.now), startLine }));
    }
    return rankSnippets(found, q.maxSnippets);
  }
}
