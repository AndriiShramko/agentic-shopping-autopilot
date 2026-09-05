/**
 * Plain-folder adapter: any directory of `.md`, `.txt` and `.json` files (JSON is pretty-printed so
 * that each field is one line). The whole folder is read (no allow-list; CONTEXT_INCLUDE applies to
 * vaults only), but the same hard and default excludes as the vault adapter apply, and frontmatter is
 * skipped and read for the note date and the opt-out key only — it carries no weight here.
 */
import { FileStore, type FileAnalysis, type FileStoreOptions } from './files.js';
import { DEFAULT_EXCLUDES, HARD_EXCLUDES, noteDate, optedOut, parseFrontmatter } from './obsidian.js';

export const FOLDER_EXTS: readonly string[] = ['.md', '.txt', '.json'];

export class FolderStore extends FileStore {
  constructor(root: string, opts: FileStoreOptions | readonly string[] = {}) {
    const o: FileStoreOptions = Array.isArray(opts) ? { exclude: opts as readonly string[] } : (opts as FileStoreOptions);
    super('folder', root, [...HARD_EXCLUDES.filter((p) => !p.endsWith('.jsonl')), ...DEFAULT_EXCLUDES], undefined, { ...o, include: undefined });
  }

  protected exts(): readonly string[] {
    return FOLDER_EXTS;
  }

  protected prepare(text: string, rel: string): string {
    if (!rel.toLowerCase().endsWith('.json')) return text;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  protected analyse(text: string, rel: string, mtimeMs: number): FileAnalysis {
    if (!rel.toLowerCase().endsWith('.md')) return { weight: 1, date: new Date(mtimeMs).toISOString(), date_basis: 'mtime', body_offset: 0 };
    const { fm, bodyOffset } = parseFrontmatter(text);
    const d = noteDate(fm, mtimeMs);
    return { weight: optedOut(fm) ? 0 : 1, date: d.date, date_basis: d.basis, body_offset: bodyOffset };
  }
}
