import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { briefHash, buildBrief, checkContextGate, formatBriefDigest, needKey, needMatches } from '../src/context/brief.js';
import { FolderStore } from '../src/context/folder.js';
import { JsonlStore } from '../src/context/jsonl.js';
import { fold, recencyBoost, scoreLine, termMatchers } from '../src/context/match.js';
import { fileWeight, listMarkdown, ObsidianVaultStore, parseFrontmatter } from '../src/context/obsidian.js';
import { globToRegExp, isExcluded, MAX_FILE_BYTES, readTextCapped, splitTableRow } from '../src/context/scan.js';
import { parseSpec, parseStoreSpecs } from '../src/context/store.js';
import { computeMandateHash } from '../src/mandate.js';
import { FIXTURES, MANDATE_LF, tmpDir, withSignedHash, writePrivateRepo } from './helpers.js';

const VAULT = path.join(FIXTURES, 'vault');
const RUNTIME = path.resolve(FIXTURES, '..', '..');
const NOW = new Date('2026-09-05T12:00:00Z');
const TERMS = ['простыня', '180x200', 'матрас'];

describe('vault listing and excludes', () => {
  it('listMarkdown honours the hard excludes (archive, locked notes, tool folders, templates, jsonl) even with an empty CONTEXT_EXCLUDE', () => {
    const files = listMarkdown(VAULT, []);
    expect(files).toContain('02 - Areas/Дом.md');
    expect(files).toContain('02 - Areas/Zakupy.md');
    expect(files).toContain('01 - Projects/Bedroom.md');
    expect(files).toContain('Daily/2026-08-01.md');
    expect(files.some((f) => f.includes('\u{1F512}'))).toBe(false);
    expect(files.some((f) => f.startsWith('04 - Archive/'))).toBe(false);
    expect(files.some((f) => f.startsWith('Templates/'))).toBe(false);
    expect(files.some((f) => f.includes('.obsidian'))).toBe(false);
    expect(files.some((f) => f.endsWith('.jsonl'))).toBe(false);
    // CONTEXT_EXCLUDE can only add
    expect(listMarkdown(VAULT, ['Daily/**'])).not.toContain('Daily/2026-08-01.md');
    expect(globToRegExp('**/\u{1F512}*').test('02 - Areas/\u{1F512} x.md')).toBe(true);
    expect(globToRegExp('04 - Archive/**').test('04 - Archive/deep/old.md')).toBe(true);
    expect(globToRegExp('**/*.jsonl').test('a/b/c.jsonl')).toBe(true);
    expect(isExcluded('a/.git/x.md', [])).toBe(true);
    expect(isExcluded('02 - Areas/\u{1F512}dir/x.md', [])).toBe(true);
    expect(isExcluded('02 - Areas/x.md', [])).toBe(false);
  });

  it('parseFrontmatter handles BOM, CRLF, list tags and no block; fileWeight orders files as designed', () => {
    const p = parseFrontmatter('\uFEFF---\r\ntype: area\r\ntags:\r\n  - shopping\r\n  - home\r\nstatus: active\r\n---\r\n# Title\r\nbody');
    expect(p.fm).toEqual({ type: 'area', tags: 'shopping, home', status: 'active' });
    expect(p.bodyOffset).toBe(7);
    expect(p.body).toBe('# Title\nbody');
    expect(parseFrontmatter('no frontmatter\n---\nnot a block').bodyOffset).toBe(0);
    expect(parseFrontmatter('---\nunterminated').bodyOffset).toBe(0);
    expect(fileWeight({ status: 'archived' }, 'x.md')).toBe(0);
    expect(fileWeight({ status: 'done', type: 'area' }, 'x.md')).toBe(0);
    expect(fileWeight({}, 'x.md')).toBe(1);
    expect(fileWeight({ type: 'area' }, 'x.md')).toBe(1.2);
    expect(fileWeight({ type: 'project' }, 'x.md')).toBe(1.2);
    expect(fileWeight({ type: 'area', tags: '[home, shopping]' }, 'x.md')).toBe(1.3);
    expect(fileWeight({ tags: 'покупки' }, 'x.md')).toBe(1.3);
    expect(fileWeight({}, 'Daily/2026-08-01.md')).toBe(0.8);
    expect(fileWeight({ type: 'daily' }, 'notes/x.md')).toBe(0.8);
    expect(fileWeight({ type: 'area' }, 'Daily/x.md')).toBe(0.96);
    // index-like notes mention everything and say little
    expect(fileWeight({}, 'AGENT_INDEX.md')).toBe(0.6);
    expect(fileWeight({}, 'sub/CHANGELOG.md')).toBe(0.6);
    expect(fileWeight({}, 'INDEX-projects.md')).toBe(0.6);
    expect(fileWeight({ type: 'map' }, 'Maps/Home.md')).toBe(0.7);
    expect(fileWeight({}, 'Changelog notes.md')).toBe(1);
  });
});

describe('retrieval', () => {
  it('returns the Дом.md table row first for простыня,180x200,матрас and folds × / diacritics / suffixes', () => {
    const store = new ObsidianVaultStore(VAULT);
    expect(store.id).toBe('obsidian:vault');
    const found = store.retrieve({ need: 'простыня', terms: TERMS, maxSnippets: 20, now: NOW });
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].file).toBe('02 - Areas/Дом.md');
    expect(found[0].text).toBe('Кровать · матрасы 90×200 и 180×200 · Merax');
    expect(found[0].heading).toBe('Спальня');
    expect(found[0].line).toBe(12);
    const files = found.map((s) => s.file);
    expect(files.some((f) => f.includes('\u{1F512}'))).toBe(false);
    expect(files.some((f) => f.startsWith('04 - Archive/'))).toBe(false);
    expect(files.some((f) => f.startsWith('Templates/'))).toBe(false);
    expect(files).not.toContain('01 - Projects/old-project.md');
    expect(files).toContain('01 - Projects/Bedroom.md');
    expect(fold('Матрасы 90×200 и 180 × 200, 1,5 кг')).toBe('матрасы 90x200 и 180x200, 1.5 кг');
    expect(scoreLine('купил наволочки 50×70', ['наволочка'])).toBe(1);
    expect(scoreLine('poszewki na poduszki', ['poszewka'])).toBe(1);
    expect(scoreLine('sheep and sheer', ['sheet'])).toBe(0);
    expect(scoreLine('кровати Merax, кроватью', ['кровать'])).toBe(2);
    expect(scoreLine('Pościel i pościeli', ['pościel'])).toBe(2);
    expect(scoreLine('Матрасы 90×200 и 180×200', ['матрас', '180x200'])).toBe(4);
    expect(scoreLine('наматрасник', ['матрас'])).toBe(0);
    expect(scoreLine('Prześcieradło z gumką', ['przescieradlo'])).toBe(1);
    expect(scoreLine('bed sheets, charcoal', ['bed sheet'])).toBe(1);
    expect(scoreLine('M5 M5 M5 M5 M5', ['m5'])).toBe(3);
    expect(termMatchers(['a', '', 'матрас', 'Матрас'])).toHaveLength(1);
    expect(splitTableRow('| a | b |')).toEqual(['a', 'b']);
    expect(splitTableRow('|---|:-:|')).toBeNull();
    expect(splitTableRow('plain')).toBeUndefined();
  });

  it('recencyBoost is monotonic and the newer of two equal lines ranks first; files over 512 KB are skipped', () => {
    expect(recencyBoost('2026-09-01T00:00:00Z', NOW)).toBe(1);
    const at = (days: number) => recencyBoost(new Date(NOW.getTime() - days * 86_400_000).toISOString(), NOW);
    expect(at(29)).toBe(1);
    expect(at(100)).toBeLessThan(1);
    expect(at(100)).toBeGreaterThan(at(200));
    expect(at(200)).toBeGreaterThan(0.5);
    expect(at(365)).toBe(0.5);
    expect(at(1000)).toBe(0.5);
    expect(recencyBoost('not a date', NOW)).toBe(0.75);

    const root = tmpDir('asa-vault-');
    fs.writeFileSync(path.join(root, 'a.md'), '- матрас 180x200 old\n', 'utf8');
    fs.writeFileSync(path.join(root, 'b.md'), '- матрас 180x200 new\n', 'utf8');
    fs.writeFileSync(path.join(root, 'big.md'), '- матрас 180x200 big\n' + 'x'.repeat(MAX_FILE_BYTES + 10), 'utf8');
    const old = new Date(NOW.getTime() - 400 * 86_400_000);
    fs.utimesSync(path.join(root, 'a.md'), old, old);
    expect(readTextCapped(path.join(root, 'big.md'))).toBeUndefined();
    const r = new ObsidianVaultStore(root).retrieve({ need: '', terms: ['матрас'], maxSnippets: 10, now: new Date() });
    expect(r.map((s) => s.file)).toEqual(['b.md', 'a.md']);
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });

  it('JsonlStore turns the profile into snippets; FolderStore reads .txt and .json; store specs split on the first colon', () => {
    const dir = tmpDir('asa-jsonl-');
    fs.writeFileSync(path.join(dir, 'wishlist.jsonl'), '{"label":"przescieradlo-180","query_pl":"prześcieradło z gumką 180x200","category":"Dom","qty":1,"priority":1,"source":"[[Zakupy]]"}\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'purchase-history.jsonl'), '{"date":"2026-07-01","seller":"sklep_posciel","title":"Poszewka 50x70 bawełna","qty":2,"price_pln":19.9,"category":"Dom","source":"test"}\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'sellers.json'), '{"trusted":["sklep_posciel"],"avoid":["zly_sklep"]}\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'do-not-buy.txt'), 'poszewka jedwabna\n', 'utf8');
    const js = new JsonlStore(dir);
    expect(js.describe().files).toBe(4);
    const r = js.retrieve({ need: '', terms: ['prześcieradło', 'poszewka', 'sklep_posciel'], maxSnippets: 10, now: NOW });
    const files = r.map((s) => s.file);
    expect(files).toEqual(expect.arrayContaining(['wishlist.jsonl', 'purchase-history.jsonl', 'sellers.json', 'do-not-buy.txt']));
    expect(r.find((s) => s.file === 'wishlist.jsonl')?.text).toBe('wishlist: przescieradlo-180 | prześcieradło z gumką 180x200 | qty 1 | Dom | [[Zakupy]]');
    expect(r.find((s) => s.file === 'purchase-history.jsonl')?.text).toContain('bought 2026-07-01 sklep_posciel: Poszewka 50x70 bawełna ×2 19.9 PLN');
    expect(r.find((s) => s.file === 'sellers.json')?.text).toBe('trusted seller: sklep_posciel');
    expect(r.every((s) => s.modified.length > 0)).toBe(true);

    const folder = tmpDir('asa-folder-');
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'Bed: mattress 180x200, sheets charcoal\n', 'utf8');
    fs.writeFileSync(path.join(folder, 'data.json'), '{"bed":{"mattress":"180x200"}}', 'utf8');
    fs.writeFileSync(path.join(folder, 'note.md'), '---\ntitle: 180x200 in frontmatter only\n---\nnothing here\n', 'utf8');
    fs.mkdirSync(path.join(folder, '.git'));
    fs.writeFileSync(path.join(folder, '.git', 'x.txt'), '180x200 in a dot folder\n', 'utf8');
    const fsStore = new FolderStore(folder);
    const f = fsStore.retrieve({ need: '', terms: ['180x200'], maxSnippets: 10, now: NOW });
    expect(f.map((s) => s.file).sort()).toEqual(['data.json', 'notes.txt']);
    expect(f.find((s) => s.file === 'data.json')?.text).toBe('"mattress": "180x200"');

    expect(parseSpec('obsidian:C:\\vault x')).toEqual({ kind: 'obsidian', root: path.resolve('C:\\vault x') });
    expect(parseStoreSpecs('obsidian:C:\\a;jsonl:D:\\b; folder:E:\\c ;').map((s) => s.kind)).toEqual(['obsidian', 'jsonl', 'folder']);
    expect(() => parseSpec('notion:x')).toThrow(/unknown store kind/);
    expect(() => parseSpec('C:\\no-kind')).toThrow(/unknown store kind/);
  });
});

describe('brief and gate', () => {
  const q = { need: 'prześcieradło i poszewka', terms: ['простыня', 'наволочка', 'матрас', '180x200', 'poszewka', 'prześcieradło', 'pillowcase'], maxSnippets: 40, now: NOW };

  it('buildBrief drops the PII line, redacts a planted REF value, and hashes deterministically', () => {
    const store = new ObsidianVaultStore(VAULT);
    const b1 = buildBrief([store], q, ['Merax']);
    expect(b1.stores).toEqual([{ id: 'obsidian:vault', kind: 'obsidian', files: 6, hits: expect.any(Number), dropped: 1 }]);
    const texts = b1.snippets.map((s) => s.text).join('\n');
    expect(texts).not.toMatch(/WAW123A|00-001|600 100 200/);
    expect(texts).toContain('Notatka bez PII');
    expect(JSON.stringify(b1)).not.toContain('Merax');
    expect(b1.snippets.find((s) => s.file === '02 - Areas/Дом.md')?.text).toBe('Кровать · матрасы 90×200 и 180×200 · [REDACTED]');
    expect(b1.snippets.some((s) => s.file === 'Daily/2026-08-01.md')).toBe(true);
    expect(b1.snippets.some((s) => s.file === '02 - Areas/Zakupy.md')).toBe(true);
    expect(b1.snippets.some((s) => s.file === '01 - Projects/Bedroom.md')).toBe(true);
    expect(b1.brief_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(buildBrief([store], q, ['Merax']).brief_hash).toBe(b1.brief_hash);
    expect(buildBrief([store], { ...q, terms: q.terms.slice(0, 2) }, ['Merax']).brief_hash).not.toBe(b1.brief_hash);
    expect(briefHash({ ...b1, snippets: b1.snippets.map((s, i) => (i === 0 ? { ...s, text: s.text + ' x' } : s)) })).not.toBe(b1.brief_hash);
    // a missing root contributes nothing instead of throwing
    const missing = buildBrief([new ObsidianVaultStore(path.join(VAULT, 'nowhere'))], q, []);
    expect(missing.stores[0]).toMatchObject({ files: 0, hits: 0 });
    expect(missing.snippets).toEqual([]);
    const digest = formatBriefDigest(b1, 3);
    expect(digest).toContain('context brief for "prześcieradło i poszewka"');
    expect(digest).toContain('obsidian:vault — 6 file(s)');
    expect(digest).toContain('1 dropped (PII)');
    expect(digest).toContain('02 - Areas/Дом.md:12 §Спальня');
    expect(digest).not.toContain(VAULT);
  });

  it('checkContextGate reports no_brief / no_stores / need_mismatch / stale / run_mismatch and passes the ok path', () => {
    const brief = buildBrief([new ObsidianVaultStore(VAULT)], q, []);
    brief.run_id = 'run-1';
    const run = { run_id: 'run-1', context: { brief_hash: brief.brief_hash, need: brief.need, ts: brief.ts } };
    expect(checkContextGate({ run_id: 'run-1' }, 'x', { brief })).toMatchObject({ ok: false, reason: 'no_brief' });
    expect(checkContextGate({ run_id: 'run-1' }, 'x', { brief, storesConfigured: false })).toMatchObject({ ok: false, reason: 'no_stores' });
    expect(checkContextGate(run, 'wkręty 4x40', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'need_mismatch' });
    expect(checkContextGate(run, 'poszewka;wkręty', { brief, now: NOW })).toMatchObject({ ok: false, reason: 'need_mismatch' });
    expect(checkContextGate(run, brief.need, { brief, now: new Date(NOW.getTime() + 5 * 3_600_000) })).toMatchObject({ ok: false, reason: 'stale' });
    expect(checkContextGate(run, brief.need, { brief, now: new Date(NOW.getTime() + 5 * 3_600_000), maxAgeMin: 600 }).ok).toBe(true);
    expect(checkContextGate({ ...run, run_id: 'run-2' }, brief.need, { brief, now: NOW })).toMatchObject({ ok: false, reason: 'run_mismatch' });
    expect(checkContextGate({ ...run, context: { ...run.context, brief_hash: 'deadbeef' } }, brief.need, { brief, now: NOW })).toMatchObject({ ok: false, reason: 'run_mismatch' });
    expect(checkContextGate(run, 'PRZEŚCIERADŁO   i poszewka', { brief, now: NOW }).ok).toBe(true);
    expect(checkContextGate(run, 'prześcieradło 180x200 bawełna', { brief, now: NOW }).ok).toBe(true);
    expect(checkContextGate(run, 'poszewka;prześcieradło', { brief, now: NOW }).ok).toBe(true);
    expect(checkContextGate(run, '', { brief, now: NOW }).ok).toBe(true);
    expect(needKey('  PrzeŚcieradło   I  ')).toBe('prześcieradło i');
    expect(needMatches({ need: 'sheet', terms: ['bed sheet', 'm5'] }, 'nakretka-m5')).toBe(true);
    expect(needMatches({ need: 'sheet', terms: [] }, 'nakretka-m5')).toBe(false);
  });

  it('CLI: search / basket:plan stop without a brief (exit 2, stop context_missing), --no-context is audited, a brief and notes unlock them', () => {
    const privateDir = tmpDir('asa-priv-');
    const stateDir = tmpDir('asa-state-');
    const h = computeMandateHash(MANDATE_LF);
    if ('error' in h) throw new Error(h.error);
    writePrivateRepo(privateDir, withSignedHash(MANDATE_LF, h.hash), { MANDATE_SHA256: h.hash, REF_FULL_NAME: 'Jan Testowy' });
    const tsx = path.join(RUNTIME, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const asa = (args: string[], extra: Record<string, string> = {}) => {
      const r = spawnSync(process.execPath, [tsx, path.join(RUNTIME, 'src', 'cli.ts'), ...args], {
        cwd: RUNTIME,
        encoding: 'utf8',
        env: { ...process.env, ASA_PRIVATE_DIR: privateDir, ASA_STATE_DIR: stateDir, ASA_CONTEXT_STORES: `obsidian:${VAULT}`, ASA_LANG: 'en', ...extra },
      });
      return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
    };
    const auditText = () => {
      const raw = path.join(privateDir, 'measurements', 'raw');
      return fs.existsSync(raw) ? fs.readdirSync(raw).map((f) => fs.readFileSync(path.join(raw, f), 'utf8')).join('') : '';
    };
    const events = () => auditText().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { event: string; data?: Record<string, unknown> });

    expect(asa(['run:start', '--command', 'sheet and pillowcase test']).code).toBe(0);
    // 29.90 + the assumed 10.95 Smart! delivery stays under the 50 PLN order limit of the test mandate
    const offer = { id: 'o1', title: 'Prześcieradło z gumką 180x200 czarne', url: 'https://allegro.pl/oferta/o1', price_pln: 29.9, shipping_pln: 0, smart: true, free_delivery: true, seller: 'sklep_posciel', seller_rating: 99.5, super_seller: false, sales_count: 500, condition: 'new', format: 'BUY_NOW', seller_type: 'firma' };
    fs.writeFileSync(path.join(stateDir, 'offers.session.json'), JSON.stringify({ offers: [offer] }), 'utf8');

    // 1. no brief → STOP
    const s1 = asa(['search', '--source', 'state', '--need', 'prześcieradło', '--category', 'Dom']);
    expect(s1.code).toBe(2);
    expect(s1.err).toContain('STOP: context_missing');
    expect(s1.err).toContain('asa context:brief --need');
    expect(events().some((e) => e.event === 'stop' && e.data?.reason === 'context_missing' && e.data?.hint)).toBe(true);
    expect(events().some((e) => e.event === 'context_gate_stop' && e.data?.reason === 'no_brief')).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, 'step-result.json'), 'utf8'))).toMatchObject({ status: 'stop', note: 'STOP: context_missing' });

    // 2. --no-context needs a reason and is audited
    expect(asa(['search', '--source', 'state', '--need', 'prześcieradło', '--no-context']).code).toBe(1);
    const s2 = asa(['search', '--source', 'state', '--need', 'prześcieradło', '--category', 'Dom', '--no-context', 'test bypass']);
    expect(s2.code).toBe(0);
    expect(events().some((e) => e.event === 'context_skipped' && e.data?.reason === 'test bypass' && e.data?.gate === 'no_brief')).toBe(true);

    // 3. the brief: digest on stdout, brief on disk, hash in run.json, nothing sensitive
    const b = asa(['context:brief', '--need', 'prześcieradło i poszewka', '--terms', 'простыня,наволочка,матрас,180x200,poszewka,pillowcase']);
    expect(b.code).toBe(0);
    expect(b.out).toContain('context brief for "prześcieradło i poszewka"');
    expect(b.out).toContain('obsidian:vault');
    expect(b.out).toContain('02 - Areas/Дом.md');
    expect(b.out).not.toContain(VAULT);
    expect(b.out).not.toMatch(/WAW123A|00-001/);
    const brief = JSON.parse(fs.readFileSync(path.join(stateDir, 'context-brief.json'), 'utf8')) as { brief_hash: string; run_id: string; snippets: unknown[] };
    const run = JSON.parse(fs.readFileSync(path.join(stateDir, 'run.json'), 'utf8')) as { run_id: string; context?: { brief_hash: string; need: string } };
    expect(run.context).toMatchObject({ brief_hash: brief.brief_hash, need: 'prześcieradło i poszewka' });
    expect(brief.run_id).toBe(run.run_id);
    const cb = events().find((e) => e.event === 'context_brief');
    expect(cb?.data).toMatchObject({ need: 'prześcieradło i poszewka', brief_hash: brief.brief_hash, snippets: brief.snippets.length });
    expect(JSON.stringify(cb)).not.toContain('Кровать');

    // 4. search passes now (the need shares a token with the brief); a foreign need does not
    expect(asa(['search', '--source', 'state', '--need', 'prześcieradło', '--category', 'Dom']).code).toBe(0);
    const foreign = asa(['search', '--source', 'state', '--need', 'wkręty 4x40', '--category', 'Dom']);
    expect(foreign.code).toBe(2);
    expect(events().some((e) => e.event === 'context_gate_stop' && e.data?.reason === 'need_mismatch')).toBe(true);

    // 5. notes land in the brief and in the proposal
    expect(asa(['context:note', '--fact', 'mattress 180×200 → sheet 180×200', '--source', '[[Дом]]']).code).toBe(0);
    expect(asa(['context:note', '--assumption', 'colour: black', '--reason', 'all bedroom textiles are black']).code).toBe(0);
    expect(asa(['context:note', '--question', 'pillowcase size unknown']).code).toBe(0);
    expect(asa(['context:note', '--fact', 'a', '--question', 'b']).code).toBe(1);
    const withNotes = JSON.parse(fs.readFileSync(path.join(stateDir, 'context-brief.json'), 'utf8')) as { facts_confirmed: unknown[]; assumptions: unknown[]; open_questions: unknown[]; brief_hash: string };
    expect(withNotes.facts_confirmed).toHaveLength(1);
    expect(withNotes.assumptions).toHaveLength(1);
    expect(withNotes.open_questions).toHaveLength(1);
    expect(withNotes.brief_hash).toBe(brief.brief_hash);
    expect(events().filter((e) => e.event === 'context_note')).toHaveLength(3);

    const plan = asa(['basket:plan']);
    expect(plan.code).toBe(0);
    expect(plan.out).toContain('🛒 Proposal #');
    expect(plan.out).toContain('Facts from your notes: mattress 180×200 → sheet 180×200.');
    expect(plan.out).toContain('Assumptions from your notes: colour: black.');
    expect(plan.out).toContain('not derived: pillowcase size unknown');
    expect(plan.out).toContain('Reply: "ok" (=A)');
    const planRu = asa(['basket:plan'], { ASA_LANG: 'ru' });
    expect(planRu.code).toBe(0);
    expect(planRu.out).toContain('🛒 Предложение #');
    expect(planRu.out).toContain('Допущения из vault: colour: black.');
    expect(planRu.out).toContain('не вывел: pillowcase size unknown');

    // 6. a new run deletes the brief: the gate closes again; without stores the reason is no_stores
    expect(asa(['run:start', '--command', 'again']).code).toBe(0);
    expect(fs.existsSync(path.join(stateDir, 'context-brief.json'))).toBe(false);
    expect(asa(['search', '--source', 'state', '--need', 'prześcieradło', '--category', 'Dom']).code).toBe(2);
    const noStores = asa(['context:brief', '--need', 'x'], { ASA_CONTEXT_STORES: '' });
    expect(noStores.code).toBe(2);
    expect(noStores.err).toContain('no_stores');
  }, 180_000);
});
