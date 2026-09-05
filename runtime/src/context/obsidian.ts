/**
 * Obsidian vault adapter: Markdown notes with YAML frontmatter. Archived notes, locked notes and
 * tool folders are never read; frontmatter tunes the weight of a file; table rows are one snippet each.
 */
import { recencyBoost, termMatchers } from './match.js';
import { compileExcludes, readTextCapped, scanText, walkFiles, type WalkedFile } from './scan.js';
import { storeLabel, type ContextQuery, type KnowledgeStore, type Snippet } from './store.js';

/**
 * Exclusions that CONTEXT_EXCLUDE can only extend, never remove. The lock glyph and dot-folders are
 * additionally enforced per path segment in `isExcluded`, independently of these globs.
 */
export const HARD_EXCLUDES: readonly string[] = ['04 - Archive/**', '**/\u{1F512}*', '**/.obsidian/**', '**/.understand-anything/**', '**/Templates/**', '**/*.jsonl'];
export const DEFAULT_EXCLUDES: readonly string[] = [...HARD_EXCLUDES];

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

/**
 * 0 = skip (status archived / done); type area or project → 1.2; tags mentioning shopping → 1.3
 * (the larger of the two); a Daily note → × 0.8; a map note (type map) → × 0.7; an index / changelog
 * note → × 0.6.
 */
export function fileWeight(fm: Record<string, string>, relPath: string): number {
  const status = (fm.status ?? '').trim().toLowerCase();
  if (status === 'archived' || status === 'done') return 0;
  let w = 1;
  const type = (fm.type ?? '').trim().toLowerCase();
  if (type === 'area' || type === 'project') w = 1.2;
  if (/shopping|покупк|zakup/iu.test(fm.tags ?? '')) w = Math.max(w, 1.3);
  const rel = relPath.replace(/\\/g, '/');
  if (type === 'daily' || /(^|\/)Daily\//i.test(rel)) w *= 0.8;
  if (type === 'map') w *= 0.7;
  if (RE_INDEX_NOTE.test(rel.split('/').pop() ?? '')) w *= 0.6;
  return Math.round(w * 100) / 100;
}

export class ObsidianVaultStore implements KnowledgeStore {
  readonly kind = 'obsidian' as const;
  readonly id: string;
  private readonly excludes: RegExp[];
  private files?: WalkedFile[];

  constructor(
    readonly root: string,
    excludes: readonly string[] = [],
  ) {
    this.id = storeLabel('obsidian', root);
    this.excludes = compileExcludes([...HARD_EXCLUDES, ...excludes]);
  }

  list(): WalkedFile[] {
    if (!this.files) this.files = walkFiles(this.root, ['.md'], this.excludes);
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
      const text = readTextCapped(f.abs, f.size);
      if (text === undefined) continue;
      const { fm, bodyOffset } = parseFrontmatter(text);
      const w = fileWeight(fm, f.rel);
      if (w === 0) continue;
      const modified = new Date(f.mtimeMs).toISOString();
      const weight = w * recencyBoost(modified, q.now);
      found.push(...scanText(text, { store: this.id, file: f.rel, modified, matchers, weight, startLine: bodyOffset }));
    }
    return rankSnippets(found, q.maxSnippets);
  }
}

/** Newest first among equal scores, then by path and line, so that the order is stable. */
export function rankSnippets(list: Snippet[], max: number): Snippet[] {
  list.sort((a, b) => b.score - a.score || (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0) || a.file.localeCompare(b.file) || a.line - b.line);
  return list.slice(0, Math.max(0, max));
}

/** Relative paths of every readable note (honours the hard excludes even with an empty configuration). */
export function listMarkdown(root: string, excludes: readonly string[] = []): string[] {
  return new ObsidianVaultStore(root, excludes).list().map((f) => f.rel);
}
