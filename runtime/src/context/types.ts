/**
 * Knowledge-store contract (context-first). Before the runtime searches or plans anything the operator
 * session must consult the user's own knowledge stores through these adapters; the gate in `brief.ts`
 * enforces that by construction. Adapters are synchronous, read only the local file system and never
 * touch the network. Nothing here ever exposes the root path: `id` is the kind plus the basename.
 */
import path from 'node:path';
import type { ScriptShare } from './match.js';

export type StoreKind = 'obsidian' | 'jsonl' | 'folder';
export const STORE_KINDS: readonly StoreKind[] = ['obsidian', 'jsonl', 'folder'];

export type DateBasis = 'frontmatter' | 'mtime' | 'unknown';

export const DEFAULT_STALE_DAYS = 180;

export interface ContextQuery {
  need: string;
  terms: string[];
  maxSnippets: number;
  /** Cap per file (default 5). */
  maxPerFile?: number;
  /** A note older than this is flagged `stale` (default 180 days). */
  staleDays?: number;
  now: Date;
}

export interface Snippet {
  /** "#n" — stable within one need brief, assigned after the final ranking. */
  id?: string;
  /** Store label: kind + basename of the root only, never the full path. */
  store: string;
  /** Path relative to the store root, `/`-separated, NFC. */
  file: string;
  line: number;
  text: string;
  /** Line score × file weight × recency boost. */
  score: number;
  /** ISO date of the note: frontmatter `updated` / `modified` / `created`, else the file mtime. */
  modified: string;
  date_basis: DateBasis;
  /** Older than CONTEXT_STALE_DAYS: shown with a `!stale` marker in the digest. */
  stale: boolean;
  /** Frontmatter `status`, when any. */
  status?: string;
  /** Nearest preceding Markdown heading, when any. */
  heading?: string;
  /** Header cells of the table the row belongs to, when the snippet is a table row. */
  columns?: string[];
}

export interface StoreInfo {
  files: number;
  bytes: number;
  script: ScriptShare;
  elapsed_ms: number;
}

export interface KnowledgeStore {
  /** "obsidian:<basename>" — what the digest and the audit log show. */
  readonly id: string;
  readonly kind: StoreKind;
  /** Resolved root; used for I/O only and never printed or audited. */
  readonly root: string;
  describe(): StoreInfo;
  /** Sync, local FS only, never network. */
  retrieve(q: ContextQuery): Snippet[];
  /** sha256 over (relative path, mtime, size) of every readable file — stat only, no content. */
  fingerprint(): string;
}

/** Store label for stdout and the audit log: the kind and the basename of the root, nothing more. */
export function storeLabel(kind: StoreKind, root: string): string {
  return `${kind}:${path.basename(path.resolve(root)) || root}`;
}
