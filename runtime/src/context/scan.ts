/**
 * File-system scanning shared by the knowledge-store adapters: glob-style excludes, a synchronous
 * directory walk, size-capped reads and the line scanner that turns a text into scored snippets.
 * Everything here is read-only and local; nothing ever touches the network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { combinedMatcher, scoreFolded, fold, type TermMatcher } from './match.js';
import type { Snippet } from './store.js';

/** Files above this size are skipped (a note this big is an export, not knowledge). */
export const MAX_FILE_BYTES = 512 * 1024;
/** Snippet text is cut to this many characters. */
export const MAX_SNIPPET_CHARS = 240;
/** At most this many snippets per file, so one long note cannot crowd out the others. */
export const MAX_SNIPPETS_PER_FILE = 10;
/** Any path segment starting with this glyph is never read, whatever the configuration says. */
export const LOCK_PREFIX = '\u{1F512}';

/** Minimal glob → RegExp: `**` any depth, `*` within a segment, `?` one character. Paths use `/`. */
export function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
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
  return new RegExp(`^${re}$`, 'u');
}

export function compileExcludes(patterns: readonly string[]): RegExp[] {
  return patterns.map((p) => p.trim()).filter(Boolean).map(globToRegExp);
}

/**
 * True when the relative path (or any of its parent directories) matches an exclude pattern, or when
 * any segment starts with the lock glyph or a dot (`.obsidian`, `.git`, `.understand-anything`, …).
 */
export function isExcluded(rel: string, excludes: readonly RegExp[]): boolean {
  const clean = rel.replace(/\\/g, '/').replace(/\/+$/, '');
  const segs = clean.split('/').filter(Boolean);
  if (segs.some((s) => s.startsWith(LOCK_PREFIX) || s.startsWith('.'))) return true;
  const candidates: string[] = [clean];
  let acc = '';
  for (let i = 0; i < segs.length - 1; i++) {
    acc += (i ? '/' : '') + segs[i];
    candidates.push(acc, acc + '/');
  }
  for (const re of excludes) for (const c of candidates) if (re.test(c)) return true;
  return false;
}

export interface WalkedFile {
  /** Relative to the root, `/`-separated. */
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

/** Synchronous recursive listing of regular files with one of `exts`; symlinks are not followed. */
export function walkFiles(root: string, exts: readonly string[], excludes: readonly RegExp[]): WalkedFile[] {
  const out: WalkedFile[] = [];
  const wanted = exts.map((e) => e.toLowerCase());
  const visit = (dirAbs: string, dirRel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!isExcluded(rel + '/', excludes)) visit(path.join(dirAbs, e.name), rel);
        continue;
      }
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      if (!wanted.some((x) => lower.endsWith(x))) continue;
      if (isExcluded(rel, excludes)) continue;
      const abs = path.join(dirAbs, e.name);
      try {
        const st = fs.statSync(abs);
        out.push({ rel, abs, size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        /* vanished between readdir and stat */
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
    .replace(/[ \t ]+/g, ' ')
    .trim();
  return s.length > MAX_SNIPPET_CHARS ? s.slice(0, MAX_SNIPPET_CHARS - 1) + '…' : s;
}

export interface ScanOptions {
  store: string;
  file: string;
  modified: string;
  matchers: readonly TermMatcher[];
  /** Product of file weight and recency boost; multiplies the raw line score. */
  weight: number;
  /** First line (0-based) to scan — used to skip a frontmatter block. */
  startLine?: number;
  /** Cap per file (default MAX_SNIPPETS_PER_FILE). */
  perFile?: number;
}

/**
 * Score every line of `text` that contains at least one term. Table rows are scored and shown as one
 * snippet (cells joined with " · ", separator rows skipped); the nearest preceding heading is attached.
 */
export function scanText(text: string, opts: ScanOptions): Snippet[] {
  const combined = combinedMatcher(opts.matchers);
  if (!combined) return [];
  const orig = text.split('\n');
  let folded = fold(text).split('\n');
  if (folded.length !== orig.length) folded = orig.map(fold);
  const found: Snippet[] = [];
  let heading: string | undefined;
  for (let i = opts.startLine ?? 0; i < orig.length; i++) {
    const raw = orig[i];
    if (!raw.trim()) continue;
    const h = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (h) heading = h[2].slice(0, 60);
    if (!combined.test(folded[i])) continue;
    const cells = splitTableRow(raw);
    if (cells === null) continue;
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
    };
    if (heading) snippet.heading = heading;
    found.push(snippet);
  }
  found.sort((a, b) => b.score - a.score || a.line - b.line);
  return found.slice(0, opts.perFile ?? MAX_SNIPPETS_PER_FILE);
}
