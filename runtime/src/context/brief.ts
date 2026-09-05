/**
 * The context brief — the artefact that proves the user's knowledge stores were consulted for each
 * need in THIS run — and the hard gate that `search` and `basket:plan` apply before doing anything.
 *
 *   .state/context-brief.json  {run_id, needs: {<needKey>: NeedBrief}, stores, store_fingerprint,
 *                               brief_hash, dropped_pii, built}
 *   run.json.context           {brief_hash, needs, built} — written by `asa context:brief`
 *
 * One brief per run holds one NeedBrief per need; `context:brief` upserts a need and never wipes the
 * notes of the others. Needs are matched by exact key (NFKC, lower case, collapsed blanks) — label
 * "M5" does not satisfy a brief for "M5 DIN 912". A search string is accepted by the gate only when
 * it was recorded with `context:note --query` for that need (query binding). A need with no hits
 * passes only when at least one assumption or open question was recorded for it.
 *
 * Privacy: every snippet passes the REF_* redaction and the PII / secret-word filter (privacy.ts) and
 * is dropped, counted, when it hits. The brief stays in `.state/` (gitignored); audit events carry
 * counts, ids and hashes, never snippet or note texts.
 */
import crypto from 'node:crypto';
import { readState, writeState } from '../state.js';
import { rankSnippets } from './files.js';
import { hasCyrillic, type ScriptShare } from './match.js';
import { sanitizeSnippet } from './privacy.js';
import { storeRootExists } from './store.js';
import type { ContextQuery, KnowledgeStore, Snippet } from './types.js';

export const BRIEF_FILE = 'context-brief.json';
export const BRIEF_MAX_AGE_MIN = 240;

export interface BriefStore {
  id: string;
  kind: string;
  files: number;
  script: ScriptShare;
}

export interface StoreHits {
  id: string;
  /** Snippets kept from this store before the global cap. */
  hits: number;
  /** Snippets dropped by the PII / secret filter. */
  dropped: number;
}

export interface Fact {
  text: string;
  /** Snippet ids the fact was read from ("#3"); file / line / modified are copied from the first one. */
  from_ids: string[];
  file?: string;
  line?: number;
  modified?: string;
  ts: string;
}

export interface Assumption {
  text: string;
  /** "unsourced" when a --fact came without --from. */
  reason: string;
  ts: string;
}

export interface OpenQuestion {
  text: string;
  /** A critical unknown: the need is not searched and is left out of the plan. */
  critical: boolean;
  ts: string;
}

export interface DerivedQuery {
  query: string;
  from_ids: string[];
  ts: string;
}

export interface NeedBrief {
  need: string;
  terms: string[];
  ts: string;
  /** Snippets kept over all stores (after the PII filter, before the global cap). */
  hits: number;
  dropped: number;
  by_store: StoreHits[];
  snippets: Snippet[];
  facts: Fact[];
  assumptions: Assumption[];
  open_questions: OpenQuestion[];
  queries: DerivedQuery[];
}

export interface ContextBrief {
  run_id: string;
  needs: Record<string, NeedBrief>;
  stores: BriefStore[];
  /** sha256 over every store's fingerprint (paths, mtimes, sizes): changes when the stores change. */
  store_fingerprint: string;
  /** sha256 over the needs, terms and snippets (file, line, text) of every need; notes do not change it. */
  brief_hash: string;
  dropped_pii: number;
  /** ISO time of the last `context:brief`; BRIEF_MAX_AGE counts from here, notes do not refresh it. */
  built: string;
}

/** NFKC, lower case, collapsed whitespace — how needs and queries are compared between run, brief and CLI. */
export function needKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function briefHash(needs: Record<string, NeedBrief>): string {
  const keys = Object.keys(needs).sort();
  const payload = JSON.stringify(keys.map((k) => ({ need: k, terms: needs[k].terms.map((t) => t.trim()), snippets: needs[k].snippets.map((s) => [s.file, s.line, s.text]) })));
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function storesFingerprint(stores: readonly KnowledgeStore[]): string {
  const h = crypto.createHash('sha256');
  for (const s of stores) h.update(`${s.id}|${storeRootExists(s) ? s.fingerprint() : 'missing'}\n`, 'utf8');
  return h.digest('hex');
}

export interface NeedBuild {
  need: NeedBrief;
  stores: BriefStore[];
}

/**
 * Retrieve from every store, redact REF_* values, drop PII-looking snippets, keep the best
 * `q.maxSnippets` over all stores, number them #1..#n. A store whose root does not exist contributes
 * nothing (and is reported with 0 files).
 */
export function buildNeedBrief(stores: readonly KnowledgeStore[], q: ContextQuery, redactValues: readonly string[]): NeedBuild {
  const all: Snippet[] = [];
  const briefStores: BriefStore[] = [];
  const byStore: StoreHits[] = [];
  let droppedTotal = 0;
  for (const store of stores) {
    if (!storeRootExists(store)) {
      briefStores.push({ id: store.id, kind: store.kind, files: 0, script: { cyrillic: 0, latin: 0 } });
      byStore.push({ id: store.id, hits: 0, dropped: 0 });
      continue;
    }
    const kept: Snippet[] = [];
    let dropped = 0;
    for (const s of store.retrieve(q)) {
      const text = sanitizeSnippet(s.text, redactValues);
      if (text === null) {
        dropped++;
        continue;
      }
      const clean: Snippet = { ...s, text };
      if (s.heading) clean.heading = sanitizeSnippet(s.heading, redactValues) ?? undefined;
      if (clean.heading === undefined) delete clean.heading;
      kept.push(clean);
    }
    const info = store.describe();
    briefStores.push({ id: store.id, kind: store.kind, files: info.files, script: info.script });
    byStore.push({ id: store.id, hits: kept.length, dropped });
    droppedTotal += dropped;
    all.push(...kept);
  }
  const snippets = rankSnippets(all, q.maxSnippets).map((s, i) => ({ ...s, id: `#${i + 1}` }));
  const need: NeedBrief = {
    need: q.need,
    terms: q.terms,
    ts: q.now.toISOString(),
    hits: all.length,
    dropped: droppedTotal,
    by_store: byStore,
    snippets,
    facts: [],
    assumptions: [],
    open_questions: [],
    queries: [],
  };
  return { need, stores: briefStores };
}

export interface UpsertMeta {
  run_id: string;
  stores: BriefStore[];
  store_fingerprint: string;
  now: Date;
}

/**
 * Insert or replace one need in the brief of this run. Other needs and their notes stay untouched;
 * when the same need is briefed again its notes are kept (facts already carry file:line), only the
 * snippets, terms and counts are replaced. A brief of another run is discarded.
 */
export function upsertBrief(existing: ContextBrief | undefined, nb: NeedBrief, meta: UpsertMeta): ContextBrief {
  const base = existing && existing.run_id === meta.run_id ? existing : undefined;
  const needs: Record<string, NeedBrief> = { ...(base?.needs ?? {}) };
  const key = needKey(nb.need);
  const prev = needs[key];
  needs[key] = prev ? { ...nb, facts: prev.facts, assumptions: prev.assumptions, open_questions: prev.open_questions, queries: prev.queries } : nb;
  let dropped = 0;
  for (const n of Object.values(needs)) dropped += n.dropped;
  return {
    run_id: meta.run_id,
    needs,
    stores: meta.stores,
    store_fingerprint: meta.store_fingerprint,
    brief_hash: briefHash(needs),
    dropped_pii: dropped,
    built: meta.now.toISOString(),
  };
}

export function writeBrief(b: ContextBrief): string {
  return writeState(BRIEF_FILE, b);
}

export function readBrief(): ContextBrief | undefined {
  const b = readState<ContextBrief>(BRIEF_FILE);
  if (!b || typeof b !== 'object' || typeof b.run_id !== 'string' || !b.needs || typeof b.needs !== 'object' || typeof b.built !== 'string') return undefined;
  for (const n of Object.values(b.needs)) {
    n.snippets ??= [];
    n.facts ??= [];
    n.assumptions ??= [];
    n.open_questions ??= [];
    n.queries ??= [];
    n.terms ??= [];
    n.by_store ??= [];
    n.hits ??= n.snippets.length;
    n.dropped ??= 0;
  }
  b.stores ??= [];
  b.dropped_pii ??= 0;
  return b;
}

export function getNeed(b: ContextBrief, need: string): NeedBrief | undefined {
  return b.needs[needKey(need)];
}

export interface RunContextRef {
  brief_hash: string;
  needs: string[];
  built: string;
}

export type GateReason = 'no_run' | 'no_stores' | 'no_brief' | 'run_mismatch' | 'need_missing' | 'empty_without_notes' | 'query_not_derived' | 'stale' | 'critical_open';

export interface GateOk {
  ok: true;
  brief: ContextBrief;
  needs: NeedBrief[];
  /** Labels with a critical open question (empty unless `opts.allowCritical`). */
  critical: string[];
}

export interface GateFail {
  ok: false;
  reason: GateReason;
  /** The label that failed, for `need_missing` / `empty_without_notes` / `query_not_derived` / `critical_open`. */
  need?: string;
  brief?: ContextBrief;
}

export type GateVerdict = GateOk | GateFail;

export interface GateOptions {
  now?: Date;
  maxAgeMin?: number;
  /** The search string about to be used; must equal a recorded query of the need (needKey). */
  query?: string;
  /** false → a missing brief is reported as `no_stores` (the gate cannot be satisfied until configured). */
  storesConfigured?: boolean;
  /** true → a critical open question does not stop; the labels are returned in `critical` (basket:plan leaves them out). */
  allowCritical?: boolean;
  /** Test hook: the brief to check instead of the one on disk. */
  brief?: ContextBrief;
}

/** Labels of a "a;b" need; an empty need has no labels. */
export function needLabels(need: string): string[] {
  return need
    .split(';')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function checkContextGate(run: { run_id: string; context?: RunContextRef } | undefined, need: string, opts: GateOptions = {}): GateVerdict {
  if (!run) return { ok: false, reason: 'no_run' };
  const brief = opts.brief ?? readBrief();
  if (!brief) return { ok: false, reason: opts.storesConfigured === false ? 'no_stores' : 'no_brief' };
  if (brief.run_id !== run.run_id) return { ok: false, reason: 'run_mismatch', brief };
  if (!run.context || brief.brief_hash !== run.context.brief_hash) return { ok: false, reason: 'run_mismatch', brief };
  const ageMs = (opts.now ?? new Date()).getTime() - Date.parse(brief.built);
  if (!Number.isFinite(ageMs) || ageMs > (opts.maxAgeMin ?? BRIEF_MAX_AGE_MIN) * 60_000) return { ok: false, reason: 'stale', brief };
  const labels = needLabels(need);
  if (!labels.length) return { ok: false, reason: 'need_missing', need: '', brief };
  const needs: NeedBrief[] = [];
  const critical: string[] = [];
  for (const label of labels) {
    const nb = getNeed(brief, label);
    if (!nb) return { ok: false, reason: 'need_missing', need: label, brief };
    if (nb.hits === 0 && nb.assumptions.length + nb.open_questions.length === 0) return { ok: false, reason: 'empty_without_notes', need: label, brief };
    if (nb.open_questions.some((q) => q.critical)) {
      if (!opts.allowCritical) return { ok: false, reason: 'critical_open', need: label, brief };
      critical.push(label);
    }
    if (opts.query !== undefined) {
      const wanted = needKey(opts.query);
      if (!nb.queries.some((q) => needKey(q.query) === wanted)) return { ok: false, reason: 'query_not_derived', need: label, brief };
    }
    needs.push(nb);
  }
  return { ok: true, brief, needs, critical };
}

/** True when the stores changed since the brief was built (stat-only recomputation). */
export function storeChanged(brief: Pick<ContextBrief, 'store_fingerprint'>, stores: readonly KnowledgeStore[]): boolean {
  return storesFingerprint(stores) !== brief.store_fingerprint;
}

function shortDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '????-??-??';
}

/**
 * Compact stdout digest of one need: "#id  date[!stale]  file:line  §heading  [columns]  text(120)
 * (score)". Footer: store script shares, dropped count, the notes so far and the next commands.
 */
export function formatBriefDigest(b: ContextBrief, need: string, maxLines = 60): string {
  const nb = getNeed(b, need);
  const out: string[] = [];
  if (!nb) {
    out.push(`context brief: no need "${need}" in .state/${BRIEF_FILE} (needs: ${Object.values(b.needs).map((n) => `"${n.need}"`).join(', ') || 'none'})`);
    return out.join('\n');
  }
  out.push(`context brief for "${nb.need}" — ${nb.snippets.length} snippet(s) from ${b.stores.length} store(s); terms: ${nb.terms.join(', ') || '(none)'}`);
  for (const s of b.stores) {
    const h = nb.by_store.find((x) => x.id === s.id);
    const script = s.files ? `, script cyrillic ${Math.round(s.script.cyrillic * 100)}% / latin ${Math.round(s.script.latin * 100)}%` : '';
    out.push(`  ${s.id} — ${s.files} file(s), ${h?.hits ?? 0} hit(s)${h?.dropped ? `, ${h.dropped} dropped (PII)` : ''}${script}${s.files === 0 ? ' (empty or missing root)' : ''}`);
  }
  nb.snippets.slice(0, Math.max(0, maxLines)).forEach((s) => {
    const text = s.text.length > 120 ? s.text.slice(0, 119) + '…' : s.text;
    const cols = s.columns && s.columns.length ? `  [${s.columns.join(' · ')}]` : '';
    const status = s.status ? `, ${s.status}` : '';
    out.push(`  ${(s.id ?? '#?').padStart(4)}  ${shortDate(s.modified)}${s.stale ? '!stale' : ''}  ${s.file}:${s.line}${s.heading ? `  §${s.heading}` : ''}${cols}  ${text}  (${s.score.toFixed(2)}${status})`);
  });
  if (nb.snippets.length > maxLines) out.push(`  … ${nb.snippets.length - maxLines} more in .state/${BRIEF_FILE}`);
  if (nb.snippets.length === 0) {
    const cyr = b.stores.filter((s) => s.files > 0 && s.script.cyrillic >= 0.6);
    if (cyr.length && !nb.terms.some(hasCyrillic)) out.push(`  hint: ${cyr.map((s) => s.id).join(', ')} is mostly Cyrillic and none of the terms is — add Russian terms with --terms`);
    else out.push('  hint: no line of the stores contains any of the terms — add synonyms (RU / PL / EN, sizes in both × and x) or record an assumption / open question');
  }
  for (const f of nb.facts) out.push(`  fact: ${f.text} [${f.from_ids.join(',')}]${f.file ? ` (${f.file}:${f.line})` : ''}`);
  for (const a of nb.assumptions) out.push(`  assumption: ${a.text}${a.reason ? ` (${a.reason})` : ''}`);
  for (const q of nb.open_questions) out.push(`  open question: ${q.text}${q.critical ? ' [critical — the need is left out until answered in the notes]' : ''}`);
  for (const q of nb.queries) out.push(`  query: ${q.query}${q.from_ids.length ? ` [${q.from_ids.join(',')}]` : ''}`);
  out.push(`  hits ${nb.hits} · dropped (PII) ${nb.dropped} · facts ${nb.facts.length} · assumptions ${nb.assumptions.length} · open questions ${nb.open_questions.length} · queries ${nb.queries.length} · needs in brief ${Object.keys(b.needs).length} · hash ${b.brief_hash.slice(0, 12)}`);
  out.push(`  next: asa context:note --need "${nb.need}" --fact "…" --from "#1,#2" | --assumption "…" --reason "…" | --question "…" [--critical] | --query "<search string>" --from "#1"`);
  return out.join('\n');
}

export type NoteKind = 'fact' | 'assumption' | 'question' | 'query';

export interface NoteInput {
  /** The need label; may be omitted when the brief holds exactly one need. */
  need?: string;
  kind: NoteKind;
  text: string;
  /** Snippet ids ("#3,#7" or "3;7"); required for a fact to stay a fact. */
  from?: string;
  reason?: string;
  critical?: boolean;
  now?: Date;
}

export interface NoteResult {
  brief: ContextBrief;
  need: NeedBrief;
  /** The kind actually recorded (a fact without --from becomes an assumption). */
  kind: NoteKind;
  downgraded: boolean;
  from_ids: string[];
  file?: string;
  line?: number;
}

/** "#3,#7" / "3; 7" → ["#3", "#7"]. */
export function parseSnippetIds(from: string | undefined): string[] {
  return (from ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith('#') ? s : `#${s}`));
}

/** Append a note to one need of the brief on disk (the hash covers snippets only; `built` is not refreshed). */
export function addNote(input: NoteInput): NoteResult {
  const b = readBrief();
  if (!b) throw new Error(`no .state/${BRIEF_FILE}: run \`asa context:brief --need "…" --terms …\` first`);
  const keys = Object.keys(b.needs);
  let nb: NeedBrief | undefined;
  if (input.need !== undefined && input.need.trim()) nb = getNeed(b, input.need);
  else if (keys.length === 1) nb = b.needs[keys[0]];
  else throw new Error(`--need is required: the brief holds ${keys.length} need(s)${keys.length ? ` (${Object.values(b.needs).map((n) => `"${n.need}"`).join(', ')})` : ''}`);
  if (!nb) throw new Error(`no brief for need "${input.need}": run \`asa context:brief --need "${input.need}" --terms …\` first (needs in the brief: ${Object.values(b.needs).map((n) => `"${n.need}"`).join(', ') || 'none'})`);
  const text = input.text.trim();
  if (!text) throw new Error('the note text is empty');
  const ts = (input.now ?? new Date()).toISOString();
  const ids = parseSnippetIds(input.from);
  const known = new Map(nb.snippets.map((s) => [s.id ?? '', s]));
  for (const id of ids) if (!known.has(id)) throw new Error(`unknown snippet id ${id} for need "${nb.need}" (ids: #1..#${nb.snippets.length})`);
  let kind = input.kind;
  let downgraded = false;
  let file: string | undefined;
  let line: number | undefined;
  if (kind === 'fact' && !ids.length) {
    kind = 'assumption';
    downgraded = true;
  }
  switch (kind) {
    case 'fact': {
      const first = known.get(ids[0]) as Snippet;
      file = first.file;
      line = first.line;
      nb.facts.push({ text, from_ids: ids, file, line, modified: first.modified, ts });
      break;
    }
    case 'assumption':
      nb.assumptions.push({ text, reason: downgraded ? 'unsourced' : (input.reason ?? '').trim(), ts });
      break;
    case 'question':
      nb.open_questions.push({ text, critical: input.critical === true, ts });
      break;
    case 'query':
      nb.queries.push({ query: text, from_ids: ids, ts });
      break;
  }
  writeBrief(b);
  return { brief: b, need: nb, kind, downgraded, from_ids: ids, file, line };
}
