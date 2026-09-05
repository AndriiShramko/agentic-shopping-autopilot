/**
 * Base of the file-based adapters (Obsidian vault, plain folder): the walk with include / exclude
 * lists, the stat-keyed index (frontmatter parsed once per changed file), the script share, the
 * fingerprint and the retrieval loop. Subclasses decide the extensions, how a file is analysed
 * (weight, date, status, body offset) and how its text is prepared for scanning.
 */
import crypto from 'node:crypto';
import { IndexCache, storeCacheKey, type IndexEntry } from './cache.js';
import { ageDays, recencyBoost, scriptCounts, scriptShareOf, termMatchers } from './match.js';
import { compileGlobs, compileIncludes, DEFAULT_MAX_PER_FILE, MAX_FILE_BYTES, readTextCapped, scanText, walkFiles, type IncludeSet, type WalkedFile } from './scan.js';
import { DEFAULT_STALE_DAYS, storeLabel, type ContextQuery, type KnowledgeStore, type Snippet, type StoreInfo, type StoreKind } from './types.js';

export interface FileStoreOptions {
  /** Include globs; undefined = the adapter's default allow-list. */
  include?: readonly string[];
  /** Extra exclude globs on top of the adapter's defaults (they can only be extended). */
  exclude?: readonly string[];
  /** Index cache shared by the stores of one run; without it the index lives in memory only. */
  cache?: IndexCache;
}

/** What a subclass derives from a file's text (everything but the stat and script fields of the entry). */
export type FileAnalysis = Pick<IndexEntry, 'weight' | 'date' | 'date_basis' | 'status' | 'body_offset'>;

export interface IndexedFile extends WalkedFile {
  entry: IndexEntry;
}

export abstract class FileStore implements KnowledgeStore {
  readonly id: string;
  protected readonly excludes: RegExp[];
  protected readonly includes: IncludeSet | undefined;
  protected readonly cache: IndexCache;
  private readonly cacheKey: string;
  private walked?: WalkedFile[];
  private indexed?: IndexedFile[];
  private fp?: string;
  private elapsedMs = 0;
  /** Texts read while indexing, so that retrieval does not read an uncached file twice. */
  private readonly texts = new Map<string, string>();

  protected constructor(
    readonly kind: StoreKind,
    readonly root: string,
    hardExcludes: readonly string[],
    defaultIncludes: readonly string[] | undefined,
    opts: FileStoreOptions,
  ) {
    this.id = storeLabel(kind, root);
    this.excludes = compileGlobs([...hardExcludes, ...(opts.exclude ?? [])]);
    this.includes = compileIncludes(opts.include ?? defaultIncludes);
    this.cache = opts.cache ?? new IndexCache();
    this.cacheKey = storeCacheKey(kind, root);
  }

  protected abstract exts(): readonly string[];
  /** Derive weight / date / status / body offset from the (prepared) text of a file. */
  protected abstract analyse(text: string, rel: string, mtimeMs: number): FileAnalysis;
  /** Hook for adapters that reshape a file before scanning (pretty-printed JSON). */
  protected prepare(text: string, _rel: string): string {
    return text;
  }

  list(): WalkedFile[] {
    if (!this.walked) this.walked = walkFiles(this.root, { exts: this.exts(), excludes: this.excludes, includes: this.includes });
    return this.walked;
  }

  /** Stat-keyed index: an unchanged file reuses its cached entry, a changed one is parsed again. */
  index(): IndexedFile[] {
    if (this.indexed) return this.indexed;
    const started = Date.now();
    const out: IndexedFile[] = [];
    const keep = new Set<string>();
    for (const f of this.list()) {
      keep.add(f.rel);
      let entry = this.cache.get(this.cacheKey, f.rel);
      if (!entry || entry.mtime !== f.mtimeMs || entry.size !== f.size) {
        entry = this.parse(f);
        this.cache.set(this.cacheKey, f.rel, entry);
      }
      out.push({ ...f, entry });
    }
    this.cache.prune(this.cacheKey, keep);
    this.indexed = out;
    this.elapsedMs = Date.now() - started;
    return out;
  }

  private parse(f: WalkedFile): IndexEntry {
    const base = { mtime: f.mtimeMs, size: f.size };
    if (f.size > MAX_FILE_BYTES) return { ...base, weight: 0, date: new Date(f.mtimeMs).toISOString(), date_basis: 'mtime', script: [0, 0], body_offset: 0 };
    let text: string | undefined;
    try {
      text = readTextCapped(f.abs, f.size);
    } catch {
      text = undefined;
    }
    if (text === undefined) return { ...base, weight: 0, date: new Date(f.mtimeMs).toISOString(), date_basis: 'mtime', script: [0, 0], body_offset: 0 };
    const prepared = this.prepare(text, f.rel);
    const a = this.analyse(prepared, f.rel, f.mtimeMs);
    if (a.weight > 0) this.texts.set(f.rel, prepared);
    const entry: IndexEntry = { ...base, weight: a.weight, date: a.date, date_basis: a.date_basis, script: scriptCounts(prepared.slice(0, 4096)), body_offset: a.body_offset };
    if (a.status) entry.status = a.status;
    return entry;
  }

  describe(): StoreInfo {
    const files = this.index();
    const counts: [number, number] = [0, 0];
    let bytes = 0;
    for (const f of files) {
      bytes += f.size;
      counts[0] += f.entry.script[0];
      counts[1] += f.entry.script[1];
    }
    return { files: files.length, bytes, script: scriptShareOf(counts), elapsed_ms: this.elapsedMs };
  }

  fingerprint(): string {
    if (!this.fp) {
      const h = crypto.createHash('sha256');
      for (const f of this.list()) h.update(`${f.rel}|${Math.round(f.mtimeMs)}|${f.size}\n`, 'utf8');
      this.fp = h.digest('hex');
    }
    return this.fp;
  }

  retrieve(q: ContextQuery): Snippet[] {
    const matchers = termMatchers(q.terms);
    if (!matchers.length) return [];
    const staleDays = q.staleDays ?? DEFAULT_STALE_DAYS;
    const perFile = q.maxPerFile ?? DEFAULT_MAX_PER_FILE;
    const found: Snippet[] = [];
    for (const f of this.index()) {
      const e = f.entry;
      if (e.weight <= 0) continue;
      let text = this.texts.get(f.rel);
      if (text === undefined) {
        let raw: string | undefined;
        try {
          raw = readTextCapped(f.abs, f.size);
        } catch {
          raw = undefined;
        }
        if (raw === undefined) continue;
        text = this.prepare(raw, f.rel);
      }
      const weight = e.weight * recencyBoost(e.date, q.now);
      found.push(
        ...scanText(text, {
          store: this.id,
          file: f.rel,
          modified: e.date,
          date_basis: e.date_basis,
          stale: ageDays(e.date, q.now) > staleDays,
          status: e.status,
          matchers,
          weight,
          startLine: e.body_offset,
          perFile,
        }),
      );
    }
    return rankSnippets(found, q.maxSnippets);
  }
}

/** Newest first among equal scores, then by path and line, so that the order is stable. */
export function rankSnippets(list: Snippet[], max: number): Snippet[] {
  list.sort((a, b) => b.score - a.score || (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0) || a.file.localeCompare(b.file) || a.line - b.line);
  return list.slice(0, Math.max(0, max));
}
