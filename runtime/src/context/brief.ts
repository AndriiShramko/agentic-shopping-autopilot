/**
 * The context brief — the artefact that proves the user's knowledge stores were consulted for THIS
 * need in THIS run — and the hard gate that `search` and `basket:plan` apply before doing anything.
 *
 *   .state/context-brief.json   {need, terms, ts, run_id, stores, snippets, facts_confirmed,
 *                                assumptions, open_questions, brief_hash}
 *   run.json.context            {brief_hash, need, ts} — written by `asa context:brief`
 *
 * Privacy: every snippet passes the REF_* redaction filter and is dropped when it looks like PII
 * (postal code, phone, locker code, NIP, IBAN). The brief stays in `.state/` (gitignored); audit
 * events carry counts and hashes, never snippet texts.
 */
import crypto from 'node:crypto';
import { piiKindsIn } from '../profile.js';
import { redactString } from '../redact.js';
import { readState, writeState } from '../state.js';
import { foldedTokens } from './match.js';
import { rankSnippets } from './obsidian.js';
import { storeRootExists, type ContextQuery, type KnowledgeStore, type Snippet } from './store.js';

export const BRIEF_FILE = 'context-brief.json';
export const BRIEF_MAX_AGE_MIN = 240;

export interface BriefStore {
  id: string;
  kind: string;
  files: number;
  /** Snippets kept from this store before the global cap. */
  hits: number;
  /** Snippets dropped by the PII filter. */
  dropped: number;
}

export interface ContextBrief {
  need: string;
  terms: string[];
  ts: string;
  run_id?: string;
  stores: BriefStore[];
  snippets: Snippet[];
  facts_confirmed: { fact: string; source: string; ts: string }[];
  assumptions: { text: string; reason: string; ts: string }[];
  open_questions: { text: string; ts: string }[];
  /** sha256 of need + terms + snippet (file, line, text): changes whenever the stores change. */
  brief_hash: string;
}

export function briefHash(b: Pick<ContextBrief, 'need' | 'terms' | 'snippets'>): string {
  const payload = JSON.stringify({ need: needKey(b.need), terms: b.terms.map((t) => t.trim()), snippets: b.snippets.map((s) => [s.file, s.line, s.text]) });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** NFKC, lower case, collapsed whitespace — how needs are compared between run, brief and CLI. */
export function needKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Retrieve from every store, redact REF_* values, drop PII-looking snippets, keep the best
 * `q.maxSnippets` over all stores. A store whose root does not exist contributes nothing.
 */
export function buildBrief(stores: readonly KnowledgeStore[], q: ContextQuery, redactValues: readonly string[]): ContextBrief {
  const all: Snippet[] = [];
  const briefStores: BriefStore[] = [];
  for (const store of stores) {
    if (!storeRootExists(store)) {
      briefStores.push({ id: store.id, kind: store.kind, files: 0, hits: 0, dropped: 0 });
      continue;
    }
    const kept: Snippet[] = [];
    let dropped = 0;
    for (const s of store.retrieve(q)) {
      const text = redactString(s.text, redactValues);
      if (piiKindsIn(text).length) {
        dropped++;
        continue;
      }
      kept.push({ ...s, text });
    }
    briefStores.push({ id: store.id, kind: store.kind, files: store.describe().files, hits: kept.length, dropped });
    all.push(...kept);
  }
  const snippets = rankSnippets(all, q.maxSnippets);
  const brief: ContextBrief = {
    need: q.need,
    terms: q.terms,
    ts: q.now.toISOString(),
    stores: briefStores,
    snippets,
    facts_confirmed: [],
    assumptions: [],
    open_questions: [],
    brief_hash: '',
  };
  brief.brief_hash = briefHash(brief);
  return brief;
}

export function writeBrief(b: ContextBrief): string {
  return writeState(BRIEF_FILE, b);
}

export function readBrief(): ContextBrief | undefined {
  const b = readState<ContextBrief>(BRIEF_FILE);
  if (!b || typeof b !== 'object' || typeof b.need !== 'string' || !Array.isArray(b.snippets)) return undefined;
  b.facts_confirmed ??= [];
  b.assumptions ??= [];
  b.open_questions ??= [];
  b.terms ??= [];
  return b;
}

export interface RunContextRef {
  brief_hash: string;
  need: string;
  ts: string;
}

export type GateReason = 'no_brief' | 'need_mismatch' | 'stale' | 'run_mismatch' | 'no_stores';
export type GateVerdict = { ok: true; brief: ContextBrief } | { ok: false; reason: GateReason; brief?: ContextBrief };

export interface GateOptions {
  now?: Date;
  maxAgeMin?: number;
  /** false → a missing brief is reported as `no_stores` (the gate cannot be satisfied until configured). */
  storesConfigured?: boolean;
  /** Test hook: the brief to check instead of the one on disk. */
  brief?: ContextBrief;
}

/**
 * Does the brief cover `need`? Equal keys, or — for "a;b" needs — every label either appears in the
 * brief need or shares a significant token (3+ characters, or a code like m5 / 180x200) with the brief
 * need or its terms. An empty need is satisfied by any brief.
 */
export function needMatches(brief: Pick<ContextBrief, 'need' | 'terms'>, need: string): boolean {
  const key = needKey(need);
  if (!key) return true;
  const briefKey = needKey(brief.need);
  if (briefKey === key) return true;
  const pool = foldedTokens(`${brief.need} ${brief.terms.join(' ')}`);
  const significant = (tok: string) => tok.length >= 3 || /\d/.test(tok);
  return key
    .split(';')
    .map((l) => l.trim())
    .filter(Boolean)
    .every((label) => {
      if (briefKey.includes(needKey(label))) return true;
      const toks = Array.from(foldedTokens(label)).filter(significant);
      return toks.length > 0 && toks.some((tok) => pool.has(tok));
    });
}

export function checkContextGate(run: { run_id: string; context?: RunContextRef }, need: string, opts: GateOptions = {}): GateVerdict {
  const brief = opts.brief ?? readBrief();
  if (!run.context || !brief) return { ok: false, reason: opts.storesConfigured === false ? 'no_stores' : 'no_brief' };
  if (brief.run_id && brief.run_id !== run.run_id) return { ok: false, reason: 'run_mismatch', brief };
  if (brief.brief_hash !== run.context.brief_hash) return { ok: false, reason: 'run_mismatch', brief };
  const ageMs = (opts.now ?? new Date()).getTime() - Date.parse(brief.ts);
  if (!Number.isFinite(ageMs) || ageMs > (opts.maxAgeMin ?? BRIEF_MAX_AGE_MIN) * 60_000) return { ok: false, reason: 'stale', brief };
  if (!needMatches(brief, need)) return { ok: false, reason: 'need_mismatch', brief };
  return { ok: true, brief };
}

/** Compact stdout digest; snippet text truncated to 120 characters. */
export function formatBriefDigest(b: ContextBrief, maxLines = 25): string {
  const out: string[] = [];
  out.push(`context brief for "${b.need}" — ${b.snippets.length} snippet(s) from ${b.stores.length} store(s); terms: ${b.terms.join(', ') || '(none)'}`);
  for (const s of b.stores) out.push(`  ${s.id} — ${s.files} file(s), ${s.hits} hit(s)${s.dropped ? `, ${s.dropped} dropped (PII)` : ''}${s.files === 0 ? ' (empty or missing root)' : ''}`);
  b.snippets.slice(0, Math.max(0, maxLines)).forEach((s, i) => {
    const text = s.text.length > 120 ? s.text.slice(0, 119) + '…' : s.text;
    out.push(`  ${String(i + 1).padStart(2)}. [${s.score.toFixed(2)}] ${s.file}:${s.line}${s.heading ? ` §${s.heading}` : ''} — ${text}`);
  });
  if (b.snippets.length > maxLines) out.push(`  … ${b.snippets.length - maxLines} more in .state/${BRIEF_FILE}`);
  for (const f of b.facts_confirmed) out.push(`  fact: ${f.fact}${f.source ? ` (${f.source})` : ''}`);
  for (const a of b.assumptions) out.push(`  assumption: ${a.text}${a.reason ? ` (${a.reason})` : ''}`);
  for (const q of b.open_questions) out.push(`  open question: ${q.text}`);
  out.push(`  facts ${b.facts_confirmed.length} · assumptions ${b.assumptions.length} · open questions ${b.open_questions.length} · hash ${b.brief_hash.slice(0, 12)}`);
  return out.join('\n');
}

export type NoteKind = 'fact' | 'assumption' | 'question';

/** Append a note to the brief on disk (the hash covers snippets only, so it does not change). */
export function addNote(kind: NoteKind, text: string, extra: { source?: string; reason?: string; now?: Date } = {}): ContextBrief {
  const b = readBrief();
  if (!b) throw new Error(`no .state/${BRIEF_FILE}: run \`asa context:brief --need "…" --terms …\` first`);
  const clean = text.trim();
  if (!clean) throw new Error('the note text is empty');
  const ts = (extra.now ?? new Date()).toISOString();
  if (kind === 'fact') b.facts_confirmed.push({ fact: clean, source: (extra.source ?? '').trim(), ts });
  else if (kind === 'assumption') b.assumptions.push({ text: clean, reason: (extra.reason ?? '').trim(), ts });
  else b.open_questions.push({ text: clean, ts });
  writeBrief(b);
  return b;
}
