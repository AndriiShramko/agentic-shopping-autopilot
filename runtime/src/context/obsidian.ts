/**
 * Obsidian vault adapter: Markdown notes with YAML frontmatter.
 *
 * Privacy by default: only the allow-listed folders are walked (`00 - Inbox`, `01 - Projects`,
 * `02 - Areas`, `03 - Resources`, `Daily`; `CONTEXT_INCLUDE` replaces the list), the default excludes
 * (archive, health, finance, mail, relationships, chat archives, deployment, memory, bank / broker /
 * passport / treatment notes, index and changelog notes, `.log/`) can only be extended by
 * `CONTEXT_EXCLUDE`, and the hard excludes (any segment starting with the lock glyph, `secrets/`,
 * `.git/`, `.jsonl` files, dot-folders) hold whatever the configuration says. A note opts out with
 * `asa_context: no` or a tag `sensitive` / `private` / `health` / `family`; `status: archived|done` is
 * never read either.
 */
import { FileStore, type FileAnalysis, type FileStoreOptions } from './files.js';
import type { DateBasis } from './types.js';

/** Folders read by default; anything else in the vault root is never opened. */
export const DEFAULT_INCLUDE: readonly string[] = ['00 - Inbox/**', '01 - Projects/**', '02 - Areas/**', '03 - Resources/**', 'Daily/**'];

/** Exclusions that no configuration can remove (the lock glyph and dot-folders are enforced per segment in `isExcluded`). */
export const HARD_EXCLUDES: readonly string[] = ['secrets/**', '**/secrets/**', '**/.git/**', '**/*.jsonl', '**/.obsidian/**', '**/.understand-anything/**'];

/** Default exclusions; CONTEXT_EXCLUDE extends them, nothing removes them. */
export const DEFAULT_EXCLUDES: readonly string[] = [
  '04 - Archive/**',
  '**/Templates/**',
  '**/Health/**',
  '**/Финансы/**',
  '**/Finance/**',
  '**/Почта/**',
  '**/Mail/**',
  '**/Отношения/**',
  '**/Relationships/**',
  '**/Telegram Archive/**',
  '**/Deployment/**',
  '**/Memory/**',
  '**/*Банковск*',
  '**/*Брокерск*',
  '**/*Паспорт*',
  '**/*лечение*',
  '**/*INDEX*',
  '**/CHANGELOG*',
  '**/.log/**',
];

export interface Frontmatter {
  fm: Record<string, string>;
  body: string;
  /** Number of leading lines taken by the frontmatter block (0 when there is none). */
  bodyOffset: number;
}

/** Tolerates BOM, CRLF, a missing block, `key: value` lines and `- item` list continuations. */
export function parseFrontmatter(text: string): Frontmatter {
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  t = t.replace(/\r\n?/g, '\n');
  const lines = t.split('\n');
  const fm: Record<string, string> = {};
  if (lines[0]?.trim() !== '---') return { fm, body: t, bodyOffset: 0 };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s === '---' || s === '...') {
      end = i;
      break;
    }
  }
  if (end < 0) return { fm, body: t, bodyOffset: 0 };
  let lastKey: string | undefined;
  for (const raw of lines.slice(1, end)) {
    const list = /^\s*-\s+(.+?)\s*$/.exec(raw);
    if (list && lastKey !== undefined) {
      fm[lastKey] = fm[lastKey] ? `${fm[lastKey]}, ${list[1]}` : list[1];
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(raw);
    if (!kv) continue;
    lastKey = kv[1].toLowerCase();
    fm[lastKey] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { fm, body: lines.slice(end + 1).join('\n'), bodyOffset: end + 1 };
}

/** Index-like notes mention everything and say little: AGENT_INDEX, CHANGELOG, _INDEX, INDEX-*, README. */
const RE_INDEX_NOTE = /^(?:AGENT_INDEX|CHANGELOG|_INDEX|INDEX[-_][^/]*|README)\.md$/i;
const RE_OPT_OUT_TAGS = /(?<![\p{L}])(?:sensitive|private|health|family)(?![\p{L}])/iu;
const RE_OPT_IN_TAGS = /(?<![\p{L}])(?:shopping|asa|equipment|home|покупк\p{L}*|zakup\p{L}*)(?![\p{L}])/iu;

/** `asa_context: no` (also false / 0 / off) opts a note out. */
export function optedOut(fm: Record<string, string>): boolean {
  const v = (fm.asa_context ?? '').trim().toLowerCase();
  return v === 'no' || v === 'false' || v === '0' || v === 'off';
}

/**
 * 0 = never read (status archived / done, `asa_context: no`, a sensitive / private / health / family
 * tag); type area or project → 1.2; tags shopping / asa / equipment / home → 1.3 (the larger of the
 * two); a Daily note → × 0.8; a map note (type map) → × 0.7; an index / changelog note → × 0.6.
 */
export function fileWeight(fm: Record<string, string>, relPath: string): number {
  const status = (fm.status ?? '').trim().toLowerCase();
  if (status === 'archived' || status === 'done') return 0;
  if (optedOut(fm)) return 0;
  const tags = fm.tags ?? '';
  if (RE_OPT_OUT_TAGS.test(tags)) return 0;
  let w = 1;
  const type = (fm.type ?? '').trim().toLowerCase();
  if (type === 'area' || type === 'project') w = 1.2;
  if (RE_OPT_IN_TAGS.test(tags)) w = Math.max(w, 1.3);
  const rel = relPath.replace(/\\/g, '/');
  if (type === 'daily' || /(^|\/)Daily\//i.test(rel)) w *= 0.8;
  if (type === 'map') w *= 0.7;
  if (RE_INDEX_NOTE.test(rel.split('/').pop() ?? '')) w *= 0.6;
  return Math.round(w * 100) / 100;
}

/** Frontmatter `updated` / `modified` / `created` (in that order) beats the file mtime, which git clones reset. */
export function noteDate(fm: Record<string, string>, mtimeMs: number): { date: string; basis: DateBasis } {
  for (const key of ['updated', 'modified', 'created']) {
    const raw = (fm[key] ?? '').trim();
    if (!raw) continue;
    const t = Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw.replace(' ', 'T'));
    if (Number.isFinite(t)) return { date: new Date(t).toISOString(), basis: 'frontmatter' };
  }
  return Number.isFinite(mtimeMs) && mtimeMs > 0 ? { date: new Date(mtimeMs).toISOString(), basis: 'mtime' } : { date: '', basis: 'unknown' };
}

export class ObsidianVaultStore extends FileStore {
  constructor(root: string, opts: FileStoreOptions | readonly string[] = {}) {
    // the second argument used to be the extra exclude list; keep that shape for callers
    const o: FileStoreOptions = Array.isArray(opts) ? { exclude: opts as readonly string[] } : (opts as FileStoreOptions);
    super('obsidian', root, [...HARD_EXCLUDES, ...DEFAULT_EXCLUDES], DEFAULT_INCLUDE, o);
  }

  protected exts(): readonly string[] {
    return ['.md'];
  }

  protected analyse(text: string, rel: string, mtimeMs: number): FileAnalysis {
    const { fm, bodyOffset } = parseFrontmatter(text);
    const d = noteDate(fm, mtimeMs);
    const status = (fm.status ?? '').trim();
    const a: FileAnalysis = { weight: fileWeight(fm, rel), date: d.date, date_basis: d.basis, body_offset: bodyOffset };
    if (status) a.status = status;
    return a;
  }
}

/** Relative paths of every readable note (honours the allow-list and the hard excludes even with an empty configuration). */
export function listMarkdown(root: string, excludes: readonly string[] = [], include?: readonly string[]): string[] {
  return new ObsidianVaultStore(root, { exclude: excludes, include }).list().map((f) => f.rel);
}

export { rankSnippets } from './files.js';
