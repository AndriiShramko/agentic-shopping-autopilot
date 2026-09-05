/**
 * File-system scanning shared by the knowledge-store adapters: glob-style include / exclude lists, a
 * synchronous directory walk that never follows links, size-capped reads and the line scanner that
 * turns a text into scored snippets. Everything here is read-only and local; nothing touches the network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { combinedMatcher, scoreFolded, fold, type TermMatcher } from './match.js';
import type { DateBasis, Snippet } from './store.js';

/** Files above this size are skipped (a note this big is an export, not knowledge). */
export const MAX_FILE_BYTES = 512 * 1024;
/** Snippet text is cut to this many characters. */
export const MAX_SNIPPET_CHARS = 240;
/** Default cap of snippets per file, so one long note cannot crowd out the others (CONTEXT_MAX_PER_FILE). */
export const DEFAULT_MAX_PER_FILE = 5;
/** Any path segment starting with this glyph is never read, whatever the configuration says. */
export const LOCK_PREFIX = '\u{1F512}';

/** Backslashes → `/`, NFC, no leading `./`, no trailing slashes. */
export function normalizeRel(rel: string): string {
  return rel.normalize('NFC').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * Minimal glob → RegExp: `**` any depth, `*` within a segment, `?` one character. Paths use `/`.
 * Matching is case-insensitive (Windows and macOS file systems are), Unicode-aware.
 */
export function globToRegExp(glob: string): RegExp {
  const g = normalizeRel(glob);
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'iu');
}

export function compileGlobs(patterns: readonly string[]): RegExp[] {
  return patterns.map((p) => p.trim()).filter(Boolean).map(globToRegExp);
}

/** @deprecated name kept for readers of the first design; use compileGlobs. */
export const compileExcludes = compileGlobs;

/**
 * True when the relative path (or any of its parent directories) matches an exclude pattern, or when
 * any segment starts with the lock glyph (compared on the NFC basename, not by regex) or with a dot
 * (`.obsidian`, `.git`, `.understand-anything`, …). These two are hard: no configuration removes them.
 */
export function isExcluded(rel: string, excludes: readonly RegExp[]): boolean {
  const clean = normalizeRel(rel);
  const segs = clean.split('/').filter(Boolean);
  if (segs.some((s) => s.startsWith(LOCK_PREFIX) || s.startsWith('.'))) return true;
  // a directory is offered both bare and with a trailing slash, so `**/Health/**` stops the walk at the folder itself
  const candidates: string[] = [clean, clean + '/'];
  let acc = '';
  for (let i = 0; i < segs.length - 1; i++) {
    acc += (i ? '/' : '') + segs[i];
    candidates.push(acc, acc + '/');
  }
  for (const re of excludes) for (const c of candidates) if (re.test(c)) return true;
  return false;
}

/** Compiled include list: whole-path regexps for files and per-segment regexps for the directory walk. */
export interface IncludeSet {
  files: RegExp[];
  /** One entry per glob: a regexp per segment, `null` for `**`. */
  segments: (RegExp | null)[][];
}

export function compileIncludes(globs: readonly string[] | undefined): IncludeSet | undefined {
  const list = (globs ?? []).map((g) => g.trim()).filter(Boolean);
  if (!list.length) return undefined;
  return {
    files: compileGlobs(list),
    segments: list.map((g) =>
      normalizeRel(g)
        .split('/')
        .filter(Boolean)
        .map((s) => (s === '**' ? null : globToRegExp(s))),
    ),
  };
}

/** True when a file path matches one of the include globs (no include list = everything). */
export function isIncluded(rel: string, includes: IncludeSet | undefined): boolean {
  if (!includes) return true;
  const clean = normalizeRel(rel);
  return includes.files.some((re) => re.test(clean));
}

/** True when some include glob could match a file below this directory (so the walk descends into it). */
export function dirMayBeIncluded(dirRel: string, includes: IncludeSet | undefined): boolean {
  if (!includes) return true;
  const dsegs = normalizeRel(dirRel).split('/').filter(Boolean);
  return includes.segments.some((gsegs) => {
    for (let i = 0; i < dsegs.length; i++) {
      const gs = gsegs[i];
      if (gs === undefined) return false;
      if (gs === null) return true;
      if (!gs.test(dsegs[i])) return false;
    }
    return true;
  });
}

export interface WalkedFile {
  /** Relative to the root, `/`-separated, NFC. */
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

export interface WalkOptions {
  exts: readonly string[];
  excludes: readonly RegExp[];
  includes?: IncludeSet;
}

/**
 * Synchronous recursive listing of regular files with one of `exts`. Symbolic links, junctions and
 * other reparse points are never followed; every entry is wrapped in its own try/catch (EACCES,
 * ENAMETOOLONG, a file that vanished between readdir and stat); names are NFC-normalised.
 */
export function walkFiles(root: string, opts: WalkOptions): WalkedFile[] {
  const out: WalkedFile[] = [];
  const wanted = opts.exts.map((e) => e.toLowerCase());
  const visit = (dirAbs: string, dirRel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      try {
        const name = e.name.normalize('NFC');
        const rel = dirRel ? `${dirRel}/${name}` : name;
        if (e.isSymbolicLink()) continue;
        const abs = path.join(dirAbs, e.name);
        if (e.isDirectory()) {
          if (isExcluded(rel + '/', opts.excludes)) continue;
          if (!dirMayBeIncluded(rel, opts.includes)) continue;
          // a junction can be reported as a directory by readdir; lstat tells the truth
          if (fs.lstatSync(abs).isSymbolicLink()) continue;
          visit(abs, rel);
          continue;
        }
        if (!e.isFile()) continue;
        const lower = name.toLowerCase();
        if (!wanted.some((x) => lower.endsWith(x))) continue;
        if (isExcluded(rel, opts.excludes)) continue;
        if (!isIncluded(rel, opts.includes)) continue;
        const st = fs.statSync(abs);
        out.push({ rel, abs, size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        /* EACCES, ENAMETOOLONG, vanished between readdir and stat: skip the entry */
      }
    }
  };
  visit(root, '');
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out;
}

/** UTF-8 text without BOM, CRLF normalised; undefined when the file is larger than the cap. */
export function readTextCapped(abs: string, size?: number): string | undefined {
  const bytes = size ?? fs.statSync(abs).size;
  if (bytes > MAX_FILE_BYTES) return undefined;
  let t = fs.readFileSync(abs, 'utf8');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t.replace(/\r\n?/g, '\n');
}

/** Cells of a Markdown table row; `null` for a separator row; undefined when the line is no row. */
export function splitTableRow(line: string): string[] | null | undefined {
  const s = line.trim();
  if (!s.startsWith('|')) return undefined;
  const cells = s.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length === 0) return undefined;
  if (cells.every((c) => /^:?-+:?$/.test(c) || c === '')) return null;
  return cells;
}

/** Strip list markers, heading marks, blockquote marks and bold, collapse blanks, cut to the cap. */
export function cleanSnippet(text: string): string {
  const s = text
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*|#{1,6}\s+)+/, '')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return s.length > MAX_SNIPPET_CHARS ? s.slice(0, MAX_SNIPPET_CHARS - 1) + '…' : s;
}

export interface ScanOptions {
  store: string;
  file: string;
  modified: string;
  date_basis: DateBasis;
  stale: boolean;
  status?: string;
  matchers: readonly TermMatcher[];
  /** Product of file weight and recency boost; multiplies the raw line score. */
  weight: number;
  /** First line (0-based) to scan — used to skip a frontmatter block. */
  startLine?: number;
  /** Cap per file (default DEFAULT_MAX_PER_FILE). */
  perFile?: number;
}

/**
 * Score every line of `text` that contains at least one term. A table row is one snippet (cells joined
 * with " · ", separator rows skipped, the header row attached as `columns` instead of being a snippet);
 * the nearest preceding heading is attached; at most `perFile` snippets survive, best first.
 */
export function scanText(text: string, opts: ScanOptions): Snippet[] {
  const combined = combinedMatcher(opts.matchers);
  if (!combined) return [];
  const orig = text.split('\n');
  let folded = fold(text).split('\n');
  if (folded.length !== orig.length) folded = orig.map(fold);
  const found: Snippet[] = [];
  let heading: string | undefined;
  let columns: string[] | undefined;
  for (let i = opts.startLine ?? 0; i < orig.length; i++) {
    const raw = orig[i];
    if (!raw.trim()) {
      columns = undefined;
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (h) heading = h[2].slice(0, 60);
    const cells = splitTableRow(raw);
    if (cells === undefined) columns = undefined;
    else if (cells === null) continue;
    else if (splitTableRow(orig[i + 1] ?? '') === null) {
      columns = cells.filter(Boolean);
      continue;
    }
    if (!combined.test(folded[i])) continue;
    const shown = cells ? cells.filter(Boolean).join(' · ') : raw;
    const score = scoreFolded(folded[i], opts.matchers);
    if (score <= 0) continue;
    const snippet: Snippet = {
      store: opts.store,
      file: opts.file,
      line: i + 1,
      text: cleanSnippet(shown),
      score: Math.round(score * opts.weight * 100) / 100,
      modified: opts.modified,
      date_basis: opts.date_basis,
      stale: opts.stale,
    };
    if (opts.status) snippet.status = opts.status;
    if (heading) snippet.heading = heading;
    if (cells && columns && columns.length) snippet.columns = columns;
    found.push(snippet);
  }
  found.sort((a, b) => b.score - a.score || a.line - b.line);
  return found.slice(0, Math.max(1, opts.perFile ?? DEFAULT_MAX_PER_FILE));
}
