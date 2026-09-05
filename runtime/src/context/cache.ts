/**
 * Stat-keyed index cache for the file-based knowledge stores: `<state>/context-index.json`.
 * Per store (keyed by kind + a hash of the root, never the path) and per relative path it remembers
 * mtime, size, the frontmatter-derived weight, date and status, the script sample and the body offset,
 * so that an unchanged file is not parsed again. Content is still read for every candidate file; the
 * cache only skips the frontmatter pass and lets `describe()` report the script share without reading.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DateBasis } from './store.js';

export const CACHE_VERSION = 1;

export interface IndexEntry {
  mtime: number;
  size: number;
  /** 0 = never read (archived, opted out, over the size cap). */
  weight: number;
  /** ISO date of the note (frontmatter updated/modified/created, else mtime). */
  date: string;
  date_basis: DateBasis;
  status?: string;
  /** Letter counts [cyrillic, latin] in the first 4 KB. */
  script: [number, number];
  /** First body line (0-based) after the frontmatter block. */
  body_offset: number;
}

interface CacheFile {
  version: number;
  stores: Record<string, Record<string, IndexEntry>>;
}

/** Cache key of a store: the kind and a short hash of the resolved root (paths never reach the file). */
export function storeCacheKey(kind: string, root: string): string {
  const h = crypto.createHash('sha256').update(path.resolve(root).toLowerCase(), 'utf8').digest('hex');
  return `${kind}:${h.slice(0, 16)}`;
}

export class IndexCache {
  private data: CacheFile = { version: CACHE_VERSION, stores: {} };
  private dirty = false;
  private loaded = false;

  /** Without a file the cache lives in memory only (tests, one-off runs). */
  constructor(readonly file?: string) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<CacheFile>;
      if (parsed && parsed.version === CACHE_VERSION && parsed.stores && typeof parsed.stores === 'object') this.data = { version: CACHE_VERSION, stores: parsed.stores };
    } catch {
      /* a torn or foreign file is ignored and rewritten on save */
    }
  }

  get(store: string, rel: string): IndexEntry | undefined {
    this.load();
    return this.data.stores[store]?.[rel];
  }

  set(store: string, rel: string, entry: IndexEntry): void {
    this.load();
    (this.data.stores[store] ??= {})[rel] = entry;
    this.dirty = true;
  }

  /** Forget files that no longer exist in the store. */
  prune(store: string, keep: ReadonlySet<string>): void {
    this.load();
    const map = this.data.stores[store];
    if (!map) return;
    for (const rel of Object.keys(map)) {
      if (!keep.has(rel)) {
        delete map[rel];
        this.dirty = true;
      }
    }
  }

  size(store: string): number {
    this.load();
    return Object.keys(this.data.stores[store] ?? {}).length;
  }

  /** Write the file when something changed (tmp + rename, so a crash never leaves a torn cache). */
  save(): boolean {
    if (!this.file || !this.dirty) return false;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data) + '\n', { encoding: 'utf8' });
    fs.renameSync(tmp, this.file);
    this.dirty = false;
    return true;
  }
}
