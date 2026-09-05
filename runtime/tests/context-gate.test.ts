import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_EVENTS } from '../src/audit.js';
import { loadConfig, parseEnvText } from '../src/config.js';
import { buildNeedBrief, checkContextGate, formatBriefDigest, needKey, needLabels, parseSnippetIds, storesFingerprint, upsertBrief, type ContextBrief, type NeedBrief } from '../src/context/brief.js';
import { IndexCache, storeCacheKey } from '../src/context/cache.js';
import { ObsidianVaultStore } from '../src/context/obsidian.js';
import { assertNoteClean, sanitizeSnippet } from '../src/context/privacy.js';
import { parseSpec, parseStoreSpecs } from '../src/context/store.js';
import { computeMandateHash } from '../src/mandate.js';
import { FIXTURES, MANDATE_LF, tmpDir, withSignedHash, writePrivateRepo } from './helpers.js';

const VAULT = path.join(FIXTURES, 'vault');
const RUNTIME = path.resolve(FIXTURES, '..', '..');
const NOW = new Date('2026-09-05T12:00:00Z');

const stores = [new ObsidianVaultStore(VAULT)];
const build = (need: string, terms: string[]): NeedBrief => buildNeedBrief(stores, { need, terms, maxSnippets: 40, now: NOW }, []).need;
const meta = (now = NOW) => ({ run_id: 'run-1', stores: buildNeedBrief(stores, { need: 'x', terms: ['матрас'], maxSnippets: 1, now: NOW }, []).stores, store_fingerprint: storesFingerprint(stores), now });
const runOf = (b: ContextBrief) => ({ run_id: b.run_id, context: { brief_hash: b.brief_hash, needs: Object.keys(b.needs), built: b.built } });

/** A brief with a need that has hits (M5 DIN 912, from the printer note) and one with none. */
function twoNeeds(): { brief: ContextBrief; run: ReturnType<typeof runOf> } {
  const withHits = build('M5 DIN 912', ['m5', 'din 912', 'nakrętka']);
  expect(withHits.hits).toBeGreaterThan(0);
  const empty = build('nothing here', ['zzzz-no-such-term']);
  expect(empty.hits).toBe(0);
  const brief = upsertBrief(upsertBrief(undefined, withHits, meta()), empty, meta());
  return { brief, run: runOf(brief) };
}

describe('context gate', () => {
  it('no_run without run.json, no_stores / no_brief without a brief, run_mismatch on another run id or hash', () => {
    const { brief, run } = twoNeeds();
    expect(checkContextGate(undefined, 'M5 DIN 912', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'no_run' });
    expect(checkContextGate({ run_id: 'run-1' }, 'M5 DIN 912', { now: NOW, storesConfigured: false })).toMatchObject({ ok: false, reason: 'no_stores' });
    expect(checkContextGate({ run_id: 'run-1' }, 'M5 DIN 912', { now: NOW, storesConfigured: true })).toMatchObject({ ok: false, reason: 'no_brief' });
    expect(checkContextGate({ ...run, run_id: 'run-2' }, 'M5 DIN 912', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'run_mismatch' });
    expect(checkContextGate({ ...run, context: { ...run.context, brief_hash: 'deadbeef' } }, 'M5 DIN 912', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'run_mismatch' });
    expect(checkContextGate({ run_id: 'run-1' }, 'M5 DIN 912', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'run_mismatch' });
    expect(checkContextGate(run, 'M5 DIN 912', { brief, now: NOW }).ok).toBe(true);
  });

  it('need_missing: labels match exactly (NFKC, case, blanks) — substring containment never passes', () => {
    const { brief, run } = twoNeeds();
    expect(checkContextGate(run, 'M5', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'need_missing', need: 'M5' });
    expect(checkContextGate(run, 'DIN 912', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'need_missing' });
    expect(checkContextGate(run, 'M5 DIN 912 A2', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'need_missing' });
    expect(checkContextGate(run, '', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'need_missing' });
    expect(checkContextGate(run, 'M5 DIN 912;poszewka', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'need_missing', need: 'poszewka' });
    expect(checkContextGate(run, '  m5   din 912 ', { brief, now: NOW }).ok).toBe(true);
    expect(checkContextGate(run, 'Ｍ5 DIN 912', { brief, now: NOW }).ok).toBe(true);
    expect(needKey('  PrzeŚcieradło   I  ')).toBe('prześcieradło i');
    expect(needLabels(' a ; b;;')).toEqual(['a', 'b']);
  });

  it('empty_without_notes: a 0-hit need passes only once an assumption or an open question is recorded', () => {
    const { brief, run } = twoNeeds();
    expect(checkContextGate(run, 'nothing here', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'empty_without_notes', need: 'nothing here' });
    expect(checkContextGate(run, 'M5 DIN 912;nothing here', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'empty_without_notes' });
    brief.needs['nothing here'].assumptions.push({ text: 'default size', reason: 'no note', ts: '' });
    expect(checkContextGate(run, 'nothing here', { brief, now: NOW }).ok).toBe(true);
    expect(checkContextGate(run, 'M5 DIN 912;nothing here', { brief, now: NOW }).ok).toBe(true);
    const questionOnly = twoNeeds();
    questionOnly.brief.needs['nothing here'].open_questions.push({ text: 'which size', critical: false, ts: '' });
    expect(checkContextGate(questionOnly.run, 'nothing here', { brief: questionOnly.brief, now: NOW }).ok).toBe(true);
  });

  it('query_not_derived: the search string must equal a query recorded for that need (needKey comparison)', () => {
    const { brief, run } = twoNeeds();
    expect(checkContextGate(run, 'M5 DIN 912', { brief, now: NOW, query: 'nakrętka M5 DIN 912 A2' })).toMatchObject({ ok: false, reason: 'query_not_derived', need: 'M5 DIN 912' });
    brief.needs['m5 din 912'].queries.push({ query: 'Nakrętka  M5 DIN 912 A2', from_ids: ['#1'], ts: '' });
    expect(checkContextGate(run, 'M5 DIN 912', { brief, now: NOW, query: 'nakrętka m5 din 912 a2' }).ok).toBe(true);
    expect(checkContextGate(run, 'M5 DIN 912', { brief, now: NOW, query: 'nakrętka M5' })).toMatchObject({ ok: false, reason: 'query_not_derived' });
    // no query given (a state-sourced search without --query): the binding is not checked
    expect(checkContextGate(run, 'M5 DIN 912', { brief, now: NOW }).ok).toBe(true);
    expect(parseSnippetIds('#3, 7;#12')).toEqual(['#3', '#7', '#12']);
    expect(parseSnippetIds(undefined)).toEqual([]);
  });

  it('stale counts from `built`, not from the notes, and CONTEXT_BRIEF_MAX_AGE_MIN moves the limit', () => {
    const { brief, run } = twoNeeds();
    brief.needs['m5 din 912'].assumptions.push({ text: 'a', reason: 'r', ts: new Date(NOW.getTime() + 300 * 60_000).toISOString() });
    expect(checkContextGate(run, 'M5 DIN 912', { brief, now: new Date(NOW.getTime() + 240 * 60_000) }).ok).toBe(true);
    expect(checkContextGate(run, 'M5 DIN 912', { brief, now: new Date(NOW.getTime() + 241 * 60_000) })).toMatchObject({ ok: false, reason: 'stale' });
    expect(checkContextGate(run, 'M5 DIN 912', { brief, now: new Date(NOW.getTime() + 241 * 60_000), maxAgeMin: 600 }).ok).toBe(true);
    expect(checkContextGate(run, 'M5 DIN 912', { brief: { ...brief, built: 'not a date' }, now: NOW })).toMatchObject({ ok: false, reason: 'stale' });
  });

  it('critical_open stops a search; basket:plan asks for allowCritical and gets the labels to leave out', () => {
    const { brief, run } = twoNeeds();
    brief.needs['nothing here'].assumptions.push({ text: 'a', reason: 'r', ts: '' });
    brief.needs['m5 din 912'].open_questions.push({ text: 'thread pitch', critical: true, ts: '' });
    expect(checkContextGate(run, 'M5 DIN 912', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'critical_open', need: 'M5 DIN 912' });
    const allowed = checkContextGate(run, 'M5 DIN 912;nothing here', { brief, now: NOW, allowCritical: true });
    expect(allowed).toMatchObject({ ok: true, critical: ['M5 DIN 912'] });
    if (allowed.ok) expect(allowed.needs.map((n) => n.need)).toEqual(['M5 DIN 912', 'nothing here']);
    brief.needs['m5 din 912'].open_questions[0].critical = false;
    expect(checkContextGate(run, 'M5 DIN 912', { brief, now: NOW })).toMatchObject({ ok: true, critical: [] });
  });

  it('the digest names a Cyrillic store when Latin-only terms find nothing, and a generic hint otherwise', () => {
    const nothing: NeedBrief = { ...build('sheet', ['zzzz-no-such-term']), terms: ['sheet', 'linen'] };
    const cyr = upsertBrief(undefined, nothing, { ...meta(), stores: [{ id: 'obsidian:vault', kind: 'obsidian', files: 100, script: { cyrillic: 0.9, latin: 0.1 } }] });
    expect(formatBriefDigest(cyr, 'sheet')).toContain('obsidian:vault is mostly Cyrillic and none of the terms is');
    const withRu: NeedBrief = { ...nothing, terms: ['sheet', 'простыня'] };
    expect(formatBriefDigest(upsertBrief(undefined, withRu, { ...meta(), stores: cyr.stores }), 'sheet')).toContain('hint: no line of the stores');
    const latin = upsertBrief(undefined, nothing, { ...meta(), stores: [{ id: 'folder:notes', kind: 'folder', files: 3, script: { cyrillic: 0.1, latin: 0.9 } }] });
    expect(formatBriefDigest(latin, 'sheet')).toContain('hint: no line of the stores');
  });
});

describe('privacy helpers', () => {
  it('sanitizeSnippet redacts REF values and drops PII; assertNoteClean refuses phones, e-mails, secrets and accepts plain facts', () => {
    expect(sanitizeSnippet('bed Merax 180x200', ['Merax'])).toBe('bed [REDACTED] 180x200');
    expect(sanitizeSnippet('bed  Merax', ['bed Merax'])).toBe('[REDACTED]');
    expect(sanitizeSnippet('bed Merax jan@example.com', ['Merax'])).toBeNull();
    expect(sanitizeSnippet('paczkomat WAW123A', [])).toBeNull();
    expect(sanitizeSnippet('DIN 912 M5 A2 pack of 20', [])).toBe('DIN 912 M5 A2 pack of 20');
    expect(() => assertNoteClean('call +48 600 100 200')).toThrow(/pii_phone/);
    expect(() => assertNoteClean('mail jan@example.com')).toThrow(/pii_email/);
    expect(() => assertNoteClean('the wifi password')).toThrow(/secret_word/);
    expect(() => assertNoteClean('mattress 180×200 → sheet 180×200')).not.toThrow();
    expect(() => assertNoteClean('colour: black, two pieces, pack of 20')).not.toThrow();
  });
});

describe('config and cache plumbing', () => {
  it('config.env: quoted CONTEXT_STORES with blanks and a `|` fallback resolve to the existing root; CONTEXT_INCLUDE / EXCLUDE split on `;`', () => {
    const dir = tmpDir('asa-cfg-');
    const spaced = path.join(dir, 'My Vault');
    fs.mkdirSync(spaced);
    const nowhere = path.join(dir, 'nowhere');
    const text = [`CONTEXT_STORES="obsidian:${nowhere}|${spaced};jsonl:${path.join(dir, 'profile')}"`, 'CONTEXT_INCLUDE=Notes/**;Daily/**', 'CONTEXT_EXCLUDE=Private/**', 'CONTEXT_OPTIONAL=1'].join('\n');
    expect(parseEnvText(text).CONTEXT_STORES).toBe(`obsidian:${nowhere}|${spaced};jsonl:${path.join(dir, 'profile')}`);
    fs.writeFileSync(path.join(dir, 'config.env'), text + '\n', 'utf8');
    const cfg = loadConfig({ privateDir: dir, env: {} });
    expect(cfg.contextStores).toHaveLength(2);
    expect(cfg.contextInclude).toEqual(['Notes/**', 'Daily/**']);
    expect(cfg.contextExclude).toEqual(['Private/**']);
    expect(cfg.contextOptional).toBe(true);
    const parsed = parseStoreSpecs(cfg.contextStores, { include: cfg.contextInclude, exclude: cfg.contextExclude });
    expect(parsed.map((s) => s.kind)).toEqual(['obsidian', 'jsonl']);
    expect(parsed[0].root).toBe(path.resolve(spaced));
    expect(parsed[0].id).toBe('obsidian:My Vault');
    expect(parseSpec(`obsidian:"${spaced}"`).root).toBe(path.resolve(spaced));
    expect(parseSpec(`obsidian:${nowhere}|${nowhere}2`).root).toBe(path.resolve(nowhere));
  });

  it('the index cache key hides the root, entries are pruned and the file is written atomically', () => {
    const key = storeCacheKey('obsidian', VAULT);
    expect(key).toMatch(/^obsidian:[0-9a-f]{16}$/);
    expect(key).toBe(storeCacheKey('obsidian', VAULT.toUpperCase()));
    expect(key).not.toBe(storeCacheKey('folder', VAULT));
    const file = path.join(tmpDir('asa-cache-'), 'sub', 'context-index.json');
    const cache = new IndexCache(file);
    expect(cache.get(key, 'a.md')).toBeUndefined();
    cache.set(key, 'a.md', { mtime: 1, size: 2, weight: 1, date: '', date_basis: 'unknown', script: [0, 0], body_offset: 0 });
    cache.set(key, 'b.md', { mtime: 1, size: 2, weight: 1, date: '', date_basis: 'unknown', script: [0, 0], body_offset: 0 });
    cache.prune(key, new Set(['a.md']));
    expect(cache.size(key)).toBe(1);
    expect(cache.save()).toBe(true);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['context-index.json']);
    expect(new IndexCache(file).get(key, 'a.md')).toMatchObject({ mtime: 1, size: 2 });
    expect(new IndexCache().save()).toBe(false);
  });

  it('the audit event list names every context event', () => {
    for (const e of ['context_brief', 'context_note', 'context_query', 'context_skipped', 'context_gate_stop', 'context_store_changed']) expect(AUDIT_EVENTS).toContain(e);
  });
});

describe('CLI include / exclude from config.env', () => {
  const privateDir = tmpDir('asa-priv-');
  const stateDir = tmpDir('asa-state-');
  const h = computeMandateHash(MANDATE_LF);
  if ('error' in h) throw new Error(h.error);
  const tsx = path.join(RUNTIME, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const asa = (args: string[], extra: Record<string, string> = {}) =>
    new Promise<{ code: number; out: string; err: string }>((resolve) => {
      const child = spawn(process.execPath, [tsx, path.join(RUNTIME, 'src', 'cli.ts'), ...args], {
        cwd: RUNTIME,
        env: { ...process.env, ASA_PRIVATE_DIR: privateDir, ASA_STATE_DIR: stateDir, ASA_CONTEXT_STORES: `obsidian:${VAULT}`, ASA_LANG: 'en', ...extra },
      });
      let out = '';
      let err = '';
      child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
      child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
      child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
    });

  it('CONTEXT_EXCLUDE hides a folder from the digest, CONTEXT_INCLUDE opens one outside the default allow-list, the hard excludes still hold', async () => {
    writePrivateRepo(privateDir, withSignedHash(MANDATE_LF, h.hash), { MANDATE_SHA256: h.hash, CONTEXT_EXCLUDE: 'Daily/**' });
    expect((await asa(['run:start', '--command', 'include / exclude test'])).code).toBe(0);
    const b1 = await asa(['context:brief', '--need', 'наволочка', '--terms', 'наволочка,poszewka']);
    expect(b1.code).toBe(0);
    expect(b1.out).not.toContain('Daily/2026-08-01.md');
    expect(b1.out).toContain('obsidian:vault — 10 file(s)');
    writePrivateRepo(privateDir, withSignedHash(MANDATE_LF, h.hash), { MANDATE_SHA256: h.hash, CONTEXT_INCLUDE: 'tmp/**;secrets/**;02 - Areas/**' });
    const b2 = await asa(['context:brief', '--need', 'матрас', '--terms', 'матрас']);
    expect(b2.code).toBe(0);
    expect(b2.out).toContain('tmp/x.md');
    expect(b2.out).not.toContain('secrets/a.md');
    expect(b2.out).not.toContain('02 - Areas/Health/b.md');
    expect(b2.out).not.toContain('01 - Projects/');
    expect(b2.out).toContain('needs in brief: 2');
  }, 120_000);
});
