/**
 * Knowledge-store contract (context-first, 2026-09-05). Before the runtime searches or plans anything
 * the operator session must consult the user's own knowledge stores through these adapters; the gate
 * in `brief.ts` enforces that by construction.
 *
 *   obsidian:<path>   an Obsidian vault (Markdown with frontmatter; archive / locked notes excluded)
 *   jsonl:<path>      the shopping-profile directory (wishlist, history, sellers, do-not-buy)
 *   folder:<path>     any folder of .md / .txt / .json files
 *
 * Adapters are synchronous, read only the local file system and never touch the network.
 * `CONTEXT_STORES=obsidian:<path>;jsonl:<path>;folder:<path>` — semicolon-separated; the kind is
 * everything before the FIRST colon, so a Windows drive letter after it is fine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FolderStore } from './folder.js';
import { JsonlStore } from './jsonl.js';
import { ObsidianVaultStore } from './obsidian.js';

export { fold, recencyBoost, scoreLine, termMatchers } from './match.js';

export type StoreKind = 'obsidian' | 'jsonl' | 'folder';
export const STORE_KINDS: readonly StoreKind[] = ['obsidian', 'jsonl', 'folder'];

export interface ContextQuery {
  need: string;
  terms: string[];
  maxSnippets: number;
  now: Date;
}

export interface Snippet {
  /** Store label: kind + basename of the root only, never the full path. */
  store: string;
  /** Path relative to the store root. */
  file: string;
  line: number;
  text: string;
  /** Line score × file weight × recency boost. */
  score: number;
  /** ISO mtime of the file. */
  modified: string;
  /** Nearest preceding Markdown heading, when any. */
  heading?: string;
}

export interface KnowledgeStore {
  /** "obsidian:<basename>" — what the digest and the audit log show. */
  readonly id: string;
  readonly kind: StoreKind;
  readonly root: string;
  describe(): { root: string; files: number };
  /** Sync, local FS only, never network. */
  retrieve(q: ContextQuery): Snippet[];
}

/** Store label for stdout and the audit log: the kind and the basename of the root, nothing more. */
export function storeLabel(kind: StoreKind, root: string): string {
  return `${kind}:${path.basename(path.resolve(root)) || root}`;
}

export interface StoreSpec {
  kind: StoreKind;
  root: string;
}

/** "obsidian:C:\vault" → { kind: 'obsidian', root: 'C:\vault' }; the split is on the first colon only. */
export function parseSpec(spec: string): StoreSpec {
  const s = spec.trim();
  const i = s.indexOf(':');
  if (i <= 0) throw new Error(`store spec "${s}" must look like <kind>:<path> (kinds: ${STORE_KINDS.join(', ')})`);
  const kind = s.slice(0, i).trim().toLowerCase() as StoreKind;
  const root = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  if (!STORE_KINDS.includes(kind)) throw new Error(`unknown store kind "${kind}" in "${s}" (kinds: ${STORE_KINDS.join(', ')})`);
  if (!root) throw new Error(`store spec "${s}" has no path`);
  return { kind, root: path.resolve(root) };
}

export function parseStoreSpec(spec: string, excludes: readonly string[] = []): KnowledgeStore {
  const { kind, root } = parseSpec(spec);
  switch (kind) {
    case 'obsidian':
      return new ObsidianVaultStore(root, excludes);
    case 'jsonl':
      return new JsonlStore(root);
    case 'folder':
      return new FolderStore(root, excludes);
  }
}

/** Split a CONTEXT_STORES value (or an already split list) into adapters. */
export function parseStoreSpecs(specs: string | readonly string[], excludes: readonly string[] = []): KnowledgeStore[] {
  const list = typeof specs === 'string' ? splitSpecs(specs) : specs;
  return list.map((s) => s.trim()).filter(Boolean).map((s) => parseStoreSpec(s, excludes));
}

/** Semicolon-separated specs; a bare `;` inside a path is not supported (quote is not needed). */
export function splitSpecs(value: string): string[] {
  return value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function storeRootExists(store: KnowledgeStore): boolean {
  try {
    return fs.statSync(store.root).isDirectory();
  } catch {
    return false;
  }
}
