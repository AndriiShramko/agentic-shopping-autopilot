/**
 * Store specs and construction (context-first).
 *
 *   obsidian:<path>   an Obsidian vault (Markdown with frontmatter; allow-listed folders only)
 *   jsonl:<path>      the shopping-profile directory (wishlist, history, sellers, do-not-buy)
 *   folder:<path>     any folder of .md / .txt / .json files
 *
 * `CONTEXT_STORES=obsidian:<path>;jsonl:<path>;folder:<path>` — semicolon-separated; the kind is
 * everything before the FIRST colon, so a Windows drive letter after it is fine. A path may list
 * `|`-separated fallbacks (`obsidian:U:\vault|C:\other\vault`): the first existing directory wins,
 * so one config.env serves two machines. A path with blanks may be quoted (`obsidian:"C:\My Vault"`).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IndexCache } from './cache.js';
import { FolderStore } from './folder.js';
import { JsonlStore } from './jsonl.js';
import { ObsidianVaultStore } from './obsidian.js';
import { STORE_KINDS, type KnowledgeStore, type StoreKind } from './types.js';

export { fold, recencyBoost, scoreLine, splitTerms, termMatchers } from './match.js';
export { rankSnippets } from './files.js';
export { STORE_KINDS, storeLabel, DEFAULT_STALE_DAYS } from './types.js';
export type { ContextQuery, DateBasis, KnowledgeStore, Snippet, StoreInfo, StoreKind } from './types.js';

export interface StoreSpec {
  kind: StoreKind;
  /** The resolved root that will be used (the first existing candidate, else the first candidate). */
  root: string;
  /** Every candidate, in the order written. */
  candidates: string[];
}

export interface StoreOptions {
  /** Include globs for vault stores; undefined = the default allow-list. */
  include?: readonly string[];
  /** Extra exclude globs (the defaults and the hard excludes always apply). */
  exclude?: readonly string[];
  cache?: IndexCache;
}

function unquote(s: string): string {
  const t = s.trim();
  return t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) ? t.slice(1, -1).trim() : t;
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** "obsidian:U:\vault|C:\other" → { kind: 'obsidian', root: <first existing>, candidates }; the split is on the first colon only. */
export function parseSpec(spec: string): StoreSpec {
  const s = unquote(spec);
  const i = s.indexOf(':');
  if (i <= 0) throw new Error(`store spec "${s}" must look like <kind>:<path> (kinds: ${STORE_KINDS.join(', ')})`);
  const kind = s.slice(0, i).trim().toLowerCase() as StoreKind;
  if (!STORE_KINDS.includes(kind)) throw new Error(`unknown store kind "${kind}" in "${s}" (kinds: ${STORE_KINDS.join(', ')})`);
  const candidates = s
    .slice(i + 1)
    .split('|')
    .map(unquote)
    .filter(Boolean)
    .map((p) => path.resolve(p));
  if (!candidates.length) throw new Error(`store spec "${s}" has no path`);
  const root = candidates.find(isDir) ?? candidates[0];
  return { kind, root, candidates };
}

export function parseStoreSpec(spec: string, opts: StoreOptions = {}): KnowledgeStore {
  const { kind, root } = parseSpec(spec);
  switch (kind) {
    case 'obsidian':
      return new ObsidianVaultStore(root, { include: opts.include, exclude: opts.exclude, cache: opts.cache });
    case 'jsonl':
      return new JsonlStore(root);
    case 'folder':
      return new FolderStore(root, { exclude: opts.exclude, cache: opts.cache });
  }
}

/** Split a CONTEXT_STORES value (or an already split list) into adapters. */
export function parseStoreSpecs(specs: string | readonly string[], opts: StoreOptions = {}): KnowledgeStore[] {
  const list = typeof specs === 'string' ? splitSpecs(specs) : specs;
  return list.map((s) => s.trim()).filter(Boolean).map((s) => parseStoreSpec(s, opts));
}

/** Semicolon-separated specs; a `;` inside a quoted path is kept. */
export function splitSpecs(value: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | undefined;
  for (const ch of value) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      cur += ch;
      quote = ch;
    } else if (ch === ';') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function storeRootExists(store: KnowledgeStore): boolean {
  return isDir(store.root);
}
