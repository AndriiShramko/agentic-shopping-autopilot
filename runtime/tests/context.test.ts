import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addNote, buildNeedBrief, formatBriefDigest, readBrief, storeChanged, storesFingerprint, upsertBrief, writeBrief, type ContextBrief, type NeedBrief } from '../src/context/brief.js';
import { IndexCache, storeCacheKey } from '../src/context/cache.js';
import { FolderStore } from '../src/context/folder.js';
import { JsonlStore } from '../src/context/jsonl.js';
import { ageDays, fold, recencyBoost, scoreLine, scriptShare, splitTerms, termMatchers } from '../src/context/match.js';
import { DEFAULT_EXCLUDES, fileWeight, listMarkdown, noteDate, ObsidianVaultStore, optedOut, parseFrontmatter } from '../src/context/obsidian.js';
import { assertNoteClean, contextPiiKinds, isPeselLike, sanitizeSnippet } from '../src/context/privacy.js';
import { compileGlobs, dirMayBeIncluded, compileIncludes, globToRegExp, isExcluded, MAX_FILE_BYTES, readTextCapped, splitTableRow, walkFiles } from '../src/context/scan.js';
import { parseSpec, parseStoreSpecs, splitSpecs } from '../src/context/store.js';
import { computeMandateHash } from '../src/mandate.js';
import { FIXTURES, MANDATE_LF, tmpDir, withSignedHash, writePrivateRepo } from './helpers.js';

const VAULT = path.join(FIXTURES, 'vault');
const RUNTIME = path.resolve(FIXTURES, '..', '..');
const NOW = new Date('2026-09-05T12:00:00Z');
const TERMS = ['простыня', '180x200', 'матрас'];
const LOCK = '\u{1F512}';

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

/** A throw-away vault with the given files (content) and optional mtimes. */
function makeVault(files: Record<string, string>, mtimes: Record<string, Date> = {}): string {
  const root = tmpDir('asa-vault-');
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
    const m = mtimes[rel];
    if (m) fs.utimesSync(abs, m, m);
  }
  return root;
}

/** Recursive copy by readdir + copyFile (fs.cpSync trips over the lock-glyph name on Windows). */
function copyTree(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.name.normalize('NFC').startsWith(LOCK)) continue; // Node on Windows cannot open such names; the stores never read them
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

const q = (need: string, terms: string[], extra: Partial<{ maxSnippets: number; maxPerFile: number; staleDays: number; now: Date }> = {}) => ({ need, terms, maxSnippets: extra.maxSnippets ?? 40, maxPerFile: extra.maxPerFile, staleDays: extra.staleDays, now: extra.now ?? NOW });

describe('allow-list and excludes', () => {
  it('reads only the allow-listed folders: a root note and tmp/ are never listed, even with an empty CONTEXT_EXCLUDE', () => {
    const files = listMarkdown(VAULT, []);
    expect(files).toContain('00 - Inbox/kontakt.md');
    expect(files).toContain('01 - Projects/Bedroom.md');
    expect(files).toContain('02 - Areas/Дом.md');
    expect(files).toContain('Daily/2026-08-01.md');
    expect(files).not.toContain('root-note.md');
    expect(files.some((f) => f.startsWith('tmp/'))).toBe(false);
    expect(fs.existsSync(path.join(VAULT, 'root-note.md'))).toBe(true);
    expect(fs.existsSync(path.join(VAULT, 'tmp', 'x.md'))).toBe(true);
    // CONTEXT_INCLUDE replaces the allow-list
    const only = listMarkdown(VAULT, [], ['tmp/**']);
    expect(only).toEqual(['tmp/x.md']);
    expect(listMarkdown(VAULT, [], ['**'])).toContain('root-note.md');
  });

  it('never lists Health/, secrets/, finance / bank notes, index notes, the archive, Templates, dot-folders or .jsonl — the hard and default excludes cannot be removed', () => {
    const files = listMarkdown(VAULT, []);
    for (const f of ['02 - Areas/Health/b.md', 'secrets/a.md', '02 - Areas/Финансы/x.md', '02 - Areas/Банковские счета.md', '02 - Areas/INDEX-home.md', '04 - Archive/old.md', 'Templates/note.md']) {
      expect(fs.existsSync(path.join(VAULT, f))).toBe(true);
      expect(files).not.toContain(f);
    }
    expect(files.some((f) => f.includes('.obsidian'))).toBe(false);
    expect(files.some((f) => f.endsWith('.jsonl'))).toBe(false);
    // even with an include list that names them
    expect(listMarkdown(VAULT, [], ['**'])).not.toContain('secrets/a.md');
    expect(listMarkdown(VAULT, [], ['**'])).not.toContain('02 - Areas/Health/b.md');
    // CONTEXT_EXCLUDE can only add
    expect(listMarkdown(VAULT, ['Daily/**'])).not.toContain('Daily/2026-08-01.md');
    expect(DEFAULT_EXCLUDES).toContain('**/Health/**');
    expect(DEFAULT_EXCLUDES).toContain('**/.log/**');
  });

  it('never lists a note whose name starts with the lock glyph, in NFC or NFD, and normalises other NFD names to NFC', () => {
    // the fixture vault holds an NFC lock note (readdir sees it, the store never does)
    expect(fs.readdirSync(path.join(VAULT, '02 - Areas')).some((n) => n.startsWith(LOCK))).toBe(true);
    expect(listMarkdown(VAULT, []).some((f) => f.includes(LOCK))).toBe(false);
    expect(listMarkdown(VAULT, [], ['**']).some((f) => f.includes(LOCK))).toBe(false);
    const nfdCyrillic = 'й'; // the letter short i written as i + combining breve
    // the check is on the NFC basename, not a regex over UTF-16 units: an NFD name after the glyph is still locked
    expect(isExcluded(`02 - Areas/${LOCK} secret ${nfdCyrillic}.md`, [])).toBe(true);
    expect(isExcluded(`02 - Areas/${LOCK}${nfdCyrillic}/x.md`, [])).toBe(true);
    expect(isExcluded(`02 - Areas/a${LOCK}.md`, [])).toBe(false);
    const root = makeVault({ [`02 - Areas/dom ${nfdCyrillic}.md`]: '- матрас 180x200 plain NFD name\n' });
    // Node on this platform may refuse to create a lock-glyph name at all (ENOENT); when it can, the note must stay unlisted
    let lockCreated = false;
    try {
      fs.writeFileSync(path.join(root, '02 - Areas', `${LOCK} secret ${nfdCyrillic}.md`), '- матрас 180x200 locked NFD\n', 'utf8');
      lockCreated = true;
    } catch {
      lockCreated = false;
    }
    const files = listMarkdown(root, []);
    expect(files).toEqual([`02 - Areas/dom й.md`]);
    expect(files[0]).toBe(files[0].normalize('NFC'));
    if (lockCreated) expect(fs.readdirSync(path.join(root, '02 - Areas'))).toHaveLength(2);
    const r = new ObsidianVaultStore(root).retrieve(q('x', ['матрас']));
    expect(r.map((s) => s.text)).toEqual(['матрас 180x200 plain NFD name']);
  });

  it('glob and exclude helpers: `**`, `*`, `?`, case-insensitive, parent directories, lock and dot segments', () => {
    expect(globToRegExp('04 - Archive/**').test('04 - Archive/deep/old.md')).toBe(true);
    expect(globToRegExp('**/*.jsonl').test('a/b/c.jsonl')).toBe(true);
    expect(globToRegExp('**/*Банковск*').test('02 - Areas/Банковские счета.md')).toBe(true);
    expect(globToRegExp('**/Health/**').test('02 - Areas/health/x.md')).toBe(true);
    expect(globToRegExp('**/*INDEX*').test('AGENT_INDEX.md')).toBe(true);
    expect(isExcluded('Indexes/CHANGELOG.md', compileGlobs(['**/*INDEX*']))).toBe(true);
    expect(isExcluded('02 - Areas/x/.log/2026-09-01.jsonl', compileGlobs(DEFAULT_EXCLUDES))).toBe(true);
    expect(globToRegExp('Daily/????-??-??.md').test('Daily/2026-08-01.md')).toBe(true);
    const ex = compileGlobs(['**/Health/**', 'secrets/**']);
    expect(isExcluded('02 - Areas/Health/b.md', ex)).toBe(true);
    expect(isExcluded('02 - Areas/Health/', ex)).toBe(true);
    expect(isExcluded('secrets/a.md', ex)).toBe(true);
    expect(isExcluded('a/.git/x.md', [])).toBe(true);
    expect(isExcluded(`02 - Areas/${LOCK}dir/x.md`, [])).toBe(true);
    expect(isExcluded('02 - Areas/x.md', [])).toBe(false);
    const inc = compileIncludes(['02 - Areas/**', 'Daily/**']);
    expect(dirMayBeIncluded('02 - Areas', inc)).toBe(true);
    expect(dirMayBeIncluded('02 - Areas/Sub/Deeper', inc)).toBe(true);
    expect(dirMayBeIncluded('tmp', inc)).toBe(false);
    expect(dirMayBeIncluded('anything', compileIncludes(['**']))).toBe(true);
    expect(dirMayBeIncluded('anything', undefined)).toBe(true);
  });

  it('never follows a junction or symlink, survives unreadable entries, and skips files over 512 KB', () => {
    const tmp = tmpDir('asa-junction-');
    fs.mkdirSync(path.join(tmp, 'outside'));
    fs.writeFileSync(path.join(tmp, 'outside', 'r.md'), '- матрас 180x200 outside the root\n', 'utf8');
    const root = path.join(tmp, 'root', '02 - Areas');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'a.md'), '- матрас 180x200 inside\n', 'utf8');
    fs.writeFileSync(path.join(root, 'big.md'), '- матрас 180x200 big\n' + 'x'.repeat(MAX_FILE_BYTES + 10), 'utf8');
    fs.symlinkSync(path.join(tmp, 'outside'), path.join(root, 'junc'), 'junction');
    const files = walkFiles(path.join(tmp, 'root'), { exts: ['.md'], excludes: [] }).map((f) => f.rel);
    expect(files).toEqual(['02 - Areas/a.md', '02 - Areas/big.md']);
    expect(readTextCapped(path.join(root, 'big.md'))).toBeUndefined();
    const r = new ObsidianVaultStore(path.join(tmp, 'root')).retrieve(q('x', ['матрас']));
    expect(r.map((s) => s.file)).toEqual(['02 - Areas/a.md']);
    // a root that is not a directory lists nothing instead of throwing
    expect(walkFiles(path.join(tmp, 'nowhere'), { exts: ['.md'], excludes: [] })).toEqual([]);
  });

  it('frontmatter opt-out: asa_context: no, a sensitive / private / health / family tag and status archived / done are never read; shopping tags boost', () => {
    const p = parseFrontmatter('\uFEFF---\r\ntype: area\r\ntags:\r\n  - shopping\r\n  - home\r\nstatus: active\r\n---\r\n# Title\r\nbody');
    expect(p.fm).toEqual({ type: 'area', tags: 'shopping, home', status: 'active' });
    expect(p.bodyOffset).toBe(7);
    expect(parseFrontmatter('no frontmatter\n---\nnot a block').bodyOffset).toBe(0);
    expect(parseFrontmatter('---\nunterminated').bodyOffset).toBe(0);
    expect(optedOut({ asa_context: 'no' })).toBe(true);
    expect(optedOut({ asa_context: 'false' })).toBe(true);
    expect(optedOut({ asa_context: 'yes' })).toBe(false);
    expect(fileWeight({ asa_context: 'no', type: 'area' }, 'x.md')).toBe(0);
    expect(fileWeight({ tags: 'home, family' }, 'x.md')).toBe(0);
    expect(fileWeight({ tags: '[private]' }, 'x.md')).toBe(0);
    expect(fileWeight({ tags: 'health' }, 'x.md')).toBe(0);
    expect(fileWeight({ tags: 'healthy-food' }, 'x.md')).toBe(1);
    expect(fileWeight({ status: 'archived' }, 'x.md')).toBe(0);
    expect(fileWeight({ status: 'done', type: 'area' }, 'x.md')).toBe(0);
    expect(fileWeight({}, 'x.md')).toBe(1);
    expect(fileWeight({ type: 'area' }, 'x.md')).toBe(1.2);
    expect(fileWeight({ type: 'project' }, 'x.md')).toBe(1.2);
    expect(fileWeight({ type: 'area', tags: '[home, shopping]' }, 'x.md')).toBe(1.3);
    expect(fileWeight({ tags: 'equipment' }, 'x.md')).toBe(1.3);
    expect(fileWeight({ tags: 'asa' }, 'x.md')).toBe(1.3);
    expect(fileWeight({ tags: 'покупки' }, 'x.md')).toBe(1.3);
    expect(fileWeight({}, 'Daily/2026-08-01.md')).toBe(0.8);
    expect(fileWeight({ type: 'map' }, 'Maps/Home.md')).toBe(0.7);
    // index-like notes that slip past the name excludes are still demoted
    expect(fileWeight({}, 'AGENT_INDEX.md')).toBe(0.6);
    expect(fileWeight({}, 'sub/README.md')).toBe(0.6);
    const files = listMarkdown(VAULT, []);
    expect(files).toContain('02 - Areas/Optout.md');
    expect(files).toContain('02 - Areas/Family.md');
    const r = new ObsidianVaultStore(VAULT).retrieve(q('x', ['матрас']));
    expect(r.some((s) => s.file === '02 - Areas/Optout.md')).toBe(false);
    expect(r.some((s) => s.file === '02 - Areas/Family.md')).toBe(false);
    expect(r.some((s) => s.file === '01 - Projects/old-project.md')).toBe(false);
  });

  it('store specs: the kind is before the first colon, `|` lists fallback paths (first existing wins), quoted paths with blanks and `;` are kept', () => {
    expect(parseSpec('obsidian:C:\\vault x')).toMatchObject({ kind: 'obsidian', root: path.resolve('C:\\vault x') });
    expect(parseSpec(`obsidian:${path.join(VAULT, 'nowhere')}|${VAULT}`).root).toBe(path.resolve(VAULT));
    expect(parseSpec(`obsidian:${VAULT}|${path.join(VAULT, 'nowhere')}`).root).toBe(path.resolve(VAULT));
    expect(parseSpec('obsidian:C:\\a|C:\\b').root).toBe(path.resolve('C:\\a'));
    expect(parseSpec('obsidian:C:\\a|C:\\b').candidates).toHaveLength(2);
    expect(parseSpec('obsidian:"C:\\My Vault"').root).toBe(path.resolve('C:\\My Vault'));
    expect(parseSpec('"obsidian:C:\\My Vault"').root).toBe(path.resolve('C:\\My Vault'));
    expect(splitSpecs('obsidian:"C:\\a;b";jsonl:D:\\c')).toEqual(['obsidian:"C:\\a;b"', 'jsonl:D:\\c']);
    expect(parseStoreSpecs('obsidian:C:\\a;jsonl:D:\\b; folder:E:\\c ;').map((s) => s.kind)).toEqual(['obsidian', 'jsonl', 'folder']);
    expect(parseStoreSpecs('obsidian:C:\\a')[0].id).toBe('obsidian:a');
    expect(() => parseSpec('notion:x')).toThrow(/unknown store kind/);
    expect(() => parseSpec('C:\\no-kind')).toThrow(/unknown store kind/);
    expect(() => parseSpec('obsidian:')).toThrow(/no path/);
  });
});

describe('matcher', () => {
  it('folds ×, Latin x and Cyrillic х between digits, blanks inside dimensions, см/cm/мм/mm suffixes, ł, ё and other diacritics', () => {
    expect(fold('Матрасы 90×200 и 180 × 200, 1,5 кг')).toBe('матрасы 90x200 и 180x200, 1.5 кг');
    expect(fold('180х200')).toBe('180x200');
    expect(fold('180 x 200 см')).toBe('180x200');
    expect(fold('50 mm i 70 cm, 5мм')).toBe('50 i 70, 5');
    expect(fold('5 cmd')).toBe('5 cmd');
    expect(fold('Prześcieradła Łódź ёж')).toBe('przescieradla lodz еж');
  });

  it('matches inflections by stem prefix (простыни ↔ простыня, prześcieradła ↔ prześcieradło) and every notation of 180x200, without false stems', () => {
    expect(scoreLine('простыни', ['простыня'])).toBe(1);
    expect(scoreLine('простынь и простынями', ['простыня'])).toBe(2);
    expect(scoreLine('prześcieradła z gumką', ['prześcieradło'])).toBe(1);
    expect(scoreLine('prześcieradeł', ['prześcieradło'])).toBe(1);
    expect(scoreLine('Prześcieradło z gumką', ['przescieradlo'])).toBe(1);
    expect(scoreLine('180х200', ['180x200'])).toBe(2);
    expect(scoreLine('180 x 200 см', ['180x200'])).toBe(2);
    expect(scoreLine('180×200', ['180x200'])).toBe(2);
    expect(scoreLine('180 × 200', ['180x200'])).toBe(2);
    expect(scoreLine('купил наволочки 50×70', ['наволочка'])).toBe(1);
    expect(scoreLine('poszewki na poduszki', ['poszewka'])).toBe(1);
    expect(scoreLine('кровати Merax, кроватью', ['кровать'])).toBe(2);
    expect(scoreLine('Pościel i pościeli', ['pościel'])).toBe(2);
    expect(scoreLine('bed sheets, charcoal', ['bed sheet'])).toBe(1);
    expect(scoreLine('sheep and sheer', ['sheet'])).toBe(0);
    expect(scoreLine('наматрасник', ['матрас'])).toBe(0);
    expect(scoreLine('матрица', ['матрас'])).toBe(0);
    // bonuses: +2 per extra distinct term, +1 when a dimension / code term hits; hits per term capped at 3
    expect(scoreLine('Матрасы 90×200 и 180×200', ['матрас', '180x200'])).toBe(5);
    expect(scoreLine('M5 M5 M5 M5 M5', ['m5'])).toBe(4);
    expect(termMatchers(['a', '', 'матрас', 'Матрас'])).toHaveLength(1);
    expect(splitTerms('простыня, 180x200;матрас ; ')).toEqual(['простыня', '180x200', 'матрас']);
  });

  it('uses Unicode lookaround boundaries, never ASCII \\b (the Cyrillic boundary regression)', () => {
    const src = fs.readFileSync(path.join(RUNTIME, 'src', 'context', 'match.ts'), 'utf8');
    expect(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toMatch(/\\b/);
    const re = termMatchers(['простыня'])[0].re;
    expect(re.source).toContain('(?<![\\p{L}\\p{N}])');
    expect(re.flags).toContain('u');
    expect(scoreLine('простыня.', ['простыня'])).toBe(1);
    expect(scoreLine('«простыня»', ['простыня'])).toBe(1);
    expect(scoreLine('xпростыня', ['простыня'])).toBe(0);
    // what ASCII \b would have done
    expect(new RegExp('\\bпростыня\\b').test('простыня.')).toBe(false);
    expect(scriptShare('привет hello')).toEqual({ cyrillic: 0.55, latin: 0.45 });
    expect(scriptShare('123')).toEqual({ cyrillic: 0, latin: 0 });
  });
});

describe('retrieval', () => {
  it('returns the Дом.md table row with its heading, header columns and frontmatter date, and folds sizes', () => {
    const store = new ObsidianVaultStore(VAULT);
    expect(store.id).toBe('obsidian:vault');
    const found = store.retrieve(q('простыня', TERMS));
    expect(found.length).toBeGreaterThan(0);
    const row = found.find((s) => s.file === '02 - Areas/Дом.md');
    expect(row).toMatchObject({ line: 12, text: 'Кровать · матрасы 90×200 и 180×200 · Merax', heading: 'Спальня', columns: ['Предмет', 'Размер', 'Бренд'], date_basis: 'frontmatter', stale: false, status: 'active' });
    expect(row?.modified.slice(0, 10)).toBe('2026-06-01');
    expect(found.find((s) => s.file === '01 - Projects/Bedroom.md')).toMatchObject({ date_basis: 'mtime', stale: false, status: 'in-progress' });
    expect(found.find((s) => s.file === '02 - Areas/Zakupy.md')?.columns).toBeUndefined();
    const files = found.map((s) => s.file);
    expect(files.some((f) => f.includes(LOCK))).toBe(false);
    expect(files.some((f) => f.startsWith('04 - Archive/'))).toBe(false);
    expect(files).not.toContain('02 - Areas/INDEX-home.md');
    expect(files).not.toContain('01 - Projects/old-project.md');
    expect(splitTableRow('| a | b |')).toEqual(['a', 'b']);
    expect(splitTableRow('|---|:-:|')).toBeNull();
    expect(splitTableRow('plain')).toBeUndefined();
    const info = store.describe();
    expect(info.files).toBe(11);
    expect(info.script.cyrillic + info.script.latin).toBeCloseTo(1, 1);
    expect(JSON.stringify(info)).not.toContain(VAULT);
  });

  it('caps snippets per file (default 5, CONTEXT_MAX_PER_FILE) and keeps a header row out of the snippets', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `- матрас line ${i + 1}`).join('\n');
    const root = makeVault({ '02 - Areas/long.md': `# Long\n${lines}\n\n| Предмет | Размер |\n|---|---|\n| матрас | 180x200 |\n` });
    const all = new ObsidianVaultStore(root).retrieve(q('x', ['матрас']));
    expect(all).toHaveLength(5);
    expect(all.map((s) => s.line)).not.toContain(11); // the header row
    expect(new ObsidianVaultStore(root).retrieve(q('x', ['матрас'], { maxPerFile: 2 }))).toHaveLength(2);
    const nine = new ObsidianVaultStore(root).retrieve(q('x', ['матрас'], { maxPerFile: 20 }));
    expect(nine).toHaveLength(9);
    expect(nine.map((s) => s.line)).not.toContain(11);
    const row = new ObsidianVaultStore(root).retrieve(q('x', ['180x200'], { maxPerFile: 20 }))[0];
    expect(row).toMatchObject({ line: 13, columns: ['Предмет', 'Размер'], text: 'матрас · 180x200' });
  });

  it('frontmatter updated / modified / created beats the mtime, a note older than CONTEXT_STALE_DAYS is stale, equal scores rank the newer first', () => {
    expect(noteDate({ updated: '2024-01-15' }, NOW.getTime())).toEqual({ date: '2024-01-15T00:00:00.000Z', basis: 'frontmatter' });
    expect(noteDate({ created: '2026-06-01 10:30' }, NOW.getTime()).basis).toBe('frontmatter');
    expect(noteDate({ modified: 'yesterday' }, NOW.getTime()).basis).toBe('mtime');
    expect(noteDate({}, Number.NaN)).toEqual({ date: '', basis: 'unknown' });
    const root = makeVault(
      {
        '02 - Areas/dated-old.md': '---\nupdated: 2024-01-15\n---\n- матрас 180x200 dated 2024\n',
        '02 - Areas/fresh.md': '- матрас 180x200 fresh\n',
        '02 - Areas/mtime-old.md': '- матрас 180x200 old mtime\n',
        '02 - Areas/edge.md': `---\nupdated: ${daysAgo(181).toISOString()}\n---\n- матрас 180x200 edge\n`,
        '02 - Areas/inside.md': `---\nupdated: ${daysAgo(179).toISOString()}\n---\n- матрас 180x200 inside\n`,
      },
      { '02 - Areas/mtime-old.md': daysAgo(400) },
    );
    const r = new ObsidianVaultStore(root).retrieve(q('x', ['матрас', '180x200']));
    const by = (f: string) => r.find((s) => s.file === `02 - Areas/${f}`);
    expect(by('dated-old.md')).toMatchObject({ date_basis: 'frontmatter', stale: true });
    expect(by('dated-old.md')?.modified.slice(0, 10)).toBe('2024-01-15');
    expect(by('fresh.md')).toMatchObject({ date_basis: 'mtime', stale: false });
    expect(by('mtime-old.md')).toMatchObject({ date_basis: 'mtime', stale: true });
    expect(by('edge.md')?.stale).toBe(true);
    expect(by('inside.md')?.stale).toBe(false);
    expect(by('fresh.md')!.score).toBeGreaterThan(by('dated-old.md')!.score);
    expect(r[0].file).toBe('02 - Areas/fresh.md');
    expect(new ObsidianVaultStore(root).retrieve(q('x', ['матрас'], { staleDays: 1000 })).every((s) => !s.stale)).toBe(true);
    expect(recencyBoost('2026-09-01T00:00:00Z', NOW)).toBe(1);
    expect(recencyBoost(daysAgo(365).toISOString(), NOW)).toBe(0.5);
    expect(recencyBoost('not a date', NOW)).toBe(0.75);
    expect(ageDays('not a date', NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('index cache: an unchanged file is not parsed again, a changed one is, the file is written to the state dir and paths never appear in it', () => {
    const root = makeVault({ '02 - Areas/a.md': '---\ntype: area\n---\n- матрас a\n', '02 - Areas/b.md': '- матрас b\n' });
    const file = path.join(tmpDir('asa-cache-'), 'context-index.json');
    const cache = new IndexCache(file);
    const key = storeCacheKey('obsidian', root);
    const s1 = new ObsidianVaultStore(root, { cache });
    expect(s1.retrieve(q('x', ['матрас']))).toHaveLength(2);
    expect(cache.size(key)).toBe(2);
    expect(cache.get(key, '02 - Areas/a.md')).toMatchObject({ weight: 1.2, body_offset: 3, date_basis: 'mtime' });
    expect(cache.save()).toBe(true);
    expect(cache.save()).toBe(false);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain(root.replace(/\\/g, '/'));
    expect(text).not.toContain(path.basename(root));
    // a second store over the same cache reuses the entries; a changed file gets a new entry
    const cache2 = new IndexCache(file);
    const before = cache2.get(key, '02 - Areas/a.md');
    fs.writeFileSync(path.join(root, '02 - Areas', 'a.md'), '---\ntype: project\nstatus: done\n---\n- матрас a changed\n', 'utf8');
    const s2 = new ObsidianVaultStore(root, { cache: cache2 });
    expect(s2.retrieve(q('x', ['матрас'])).map((s) => s.file)).toEqual(['02 - Areas/b.md']);
    expect(cache2.get(key, '02 - Areas/a.md')).toMatchObject({ weight: 0 });
    expect(cache2.get(key, '02 - Areas/a.md')?.size).not.toBe(before?.size);
    // a deleted file is pruned
    fs.unlinkSync(path.join(root, '02 - Areas', 'b.md'));
    new ObsidianVaultStore(root, { cache: cache2 }).index();
    expect(cache2.size(key)).toBe(1);
    // a torn cache file is ignored
    fs.writeFileSync(file, '{not json', 'utf8');
    expect(new IndexCache(file).get(key, '02 - Areas/a.md')).toBeUndefined();
  });

  it('JsonlStore turns the profile into snippets and FolderStore reads .txt / .json with the same excludes', () => {
    const dir = tmpDir('asa-jsonl-');
    fs.writeFileSync(path.join(dir, 'wishlist.jsonl'), '{"label":"przescieradlo-180","query_pl":"prześcieradło z gumką 180x200","category":"Dom","qty":1,"priority":1,"source":"[[Zakupy]]"}\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'purchase-history.jsonl'), '{"date":"2026-07-01","seller":"sklep_posciel","title":"Poszewka 50x70 bawełna","qty":2,"price_pln":19.9,"category":"Dom","source":"test"}\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'sellers.json'), '{"trusted":["sklep_posciel"],"avoid":["zly_sklep"]}\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'do-not-buy.txt'), 'poszewka jedwabna\n', 'utf8');
    const js = new JsonlStore(dir);
    expect(js.describe().files).toBe(4);
    expect(js.fingerprint()).toMatch(/^[0-9a-f]{64}$/);
    const r = js.retrieve(q('', ['prześcieradło', 'poszewka', 'sklep_posciel']));
    expect(r.map((s) => s.file)).toEqual(expect.arrayContaining(['wishlist.jsonl', 'purchase-history.jsonl', 'sellers.json', 'do-not-buy.txt']));
    expect(r.find((s) => s.file === 'wishlist.jsonl')?.text).toBe('wishlist: przescieradlo-180 | prześcieradło z gumką 180x200 | qty 1 | Dom | [[Zakupy]]');
    expect(r.find((s) => s.file === 'purchase-history.jsonl')?.text).toContain('bought 2026-07-01 sklep_posciel: Poszewka 50x70 bawełna ×2 19.9 PLN');
    expect(r.every((s) => s.modified.length > 0 && s.stale === false)).toBe(true);

    const folder = tmpDir('asa-folder-');
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'Bed: mattress 180x200, sheets charcoal\n', 'utf8');
    fs.writeFileSync(path.join(folder, 'data.json'), '{"bed":{"mattress":"180x200"}}', 'utf8');
    fs.writeFileSync(path.join(folder, 'note.md'), '---\ntitle: 180x200 in frontmatter only\n---\nnothing here\n', 'utf8');
    fs.writeFileSync(path.join(folder, 'opt.md'), '---\nasa_context: no\n---\n- 180x200 opted out\n', 'utf8');
    fs.mkdirSync(path.join(folder, 'Health'));
    fs.writeFileSync(path.join(folder, 'Health', 'h.txt'), '180x200 in a health folder\n', 'utf8');
    fs.mkdirSync(path.join(folder, '.git'));
    fs.writeFileSync(path.join(folder, '.git', 'x.txt'), '180x200 in a dot folder\n', 'utf8');
    const fsStore = new FolderStore(folder);
    const f = fsStore.retrieve(q('', ['180x200']));
    expect(f.map((s) => s.file).sort()).toEqual(['data.json', 'notes.txt']);
    expect(f.find((s) => s.file === 'data.json')?.text).toBe('"mattress": "180x200"');
    expect(fsStore.describe().files).toBe(4);
  });
});

describe('privacy', () => {
  it('contextPiiKinds finds e-mails, card numbers, valid PESEL numbers, passport-like ids, secret words and dates of birth — and not offer ids or standards', () => {
    expect(isPeselLike('90010112349')).toBe(true);
    expect(isPeselLike('90010112340')).toBe(false);
    expect(isPeselLike('90130112349')).toBe(false);
    expect(contextPiiKinds('PESEL 90010112349')).toEqual(['pii_pesel']);
    expect(contextPiiKinds('karta 1234 5678 9012 3456')).toEqual(['pii_card']);
    expect(contextPiiKinds('karta 1234567890123456')).toEqual(['pii_card']);
    expect(contextPiiKinds('mail jan@example.com')).toEqual(['pii_email']);
    expect(contextPiiKinds('пароль: qwerty')).toEqual(['secret_word']);
    expect(contextPiiKinds('hasło do routera')).toEqual(['secret_word']);
    expect(contextPiiKinds('API key: abc')).toEqual(['secret_word']);
    expect(contextPiiKinds('PIN 1234')).toEqual(['secret_word']);
    expect(contextPiiKinds('pin header 2.54 mm')).toEqual([]);
    expect(contextPiiKinds('paszport AB 1234567')).toEqual(['pii_passport']);
    expect(contextPiiKinds('дата рождения 01.01.1990')).toEqual(['pii_dob']);
    expect(contextPiiKinds('date of birth')).toEqual(['pii_dob']);
    expect(contextPiiKinds('tel 600 100 200')).toEqual(['pii_phone']);
    expect(contextPiiKinds('https://allegro.pl/oferta/90010112349')).toEqual([]);
    expect(contextPiiKinds('DIN 912 M5 A2, ISO 4762, 180x200, order 12345678901')).toEqual([]);
    expect(contextPiiKinds('Кровать · матрасы 90×200 и 180×200 · Merax')).toEqual([]);
    expect(sanitizeSnippet('bed Merax 180x200', ['Merax'])).toBe('bed [REDACTED] 180x200');
    expect(sanitizeSnippet('bed Merax jan@example.com', ['Merax'])).toBeNull();
    expect(() => assertNoteClean('call +48 600 100 200')).toThrow(/pii_phone/);
    expect(() => assertNoteClean('mattress 180×200 → sheet 180×200')).not.toThrow();
  });

  it('buildNeedBrief drops the PII lines (PESEL, card, e-mail, password, passport, locker / postal / phone), redacts REF values, numbers the snippets and hides the root', () => {
    const store = new ObsidianVaultStore(VAULT);
    const b = buildNeedBrief([store], q('простыня', [...TERMS, 'наволочка'], { maxPerFile: 10 }), ['Merax']);
    expect(b.need.dropped).toBe(6);
    expect(b.need.by_store).toEqual([{ id: 'obsidian:vault', hits: b.need.hits, dropped: 6 }]);
    expect(b.stores[0]).toMatchObject({ id: 'obsidian:vault', kind: 'obsidian', files: 11 });
    const texts = b.need.snippets.map((s) => s.text).join('\n');
    expect(texts).not.toMatch(/WAW123A|00-001|600 100 200|90010112349|9012 3456|example\.com|qwerty|AB 1234567/);
    expect(texts).toContain('Notatka bez PII');
    expect(texts).toContain('clean line');
    expect(JSON.stringify(b)).not.toContain('Merax');
    expect(JSON.stringify(b)).not.toContain(VAULT);
    expect(b.need.snippets.find((s) => s.file === '02 - Areas/Дом.md')?.text).toBe('Кровать · матрасы 90×200 и 180×200 · [REDACTED]');
    expect(b.need.snippets.map((s) => s.id)).toEqual(b.need.snippets.map((_, i) => `#${i + 1}`));
    expect(b.need.snippets.some((s) => s.file === 'Daily/2026-08-01.md')).toBe(true);
    // a missing root contributes nothing instead of throwing
    const missing = buildNeedBrief([new ObsidianVaultStore(path.join(VAULT, 'nowhere'))], q('x', TERMS), []);
    expect(missing.stores[0]).toMatchObject({ files: 0 });
    expect(missing.need.snippets).toEqual([]);
  });
});

describe('brief and gate', () => {
  const stores = [new ObsidianVaultStore(VAULT)];
  const build = (need: string, terms: string[], now = NOW) => buildNeedBrief(stores, q(need, terms, { now }), ['Merax']).need;
  const meta = (now = NOW) => ({ run_id: 'run-1', stores: buildNeedBrief(stores, q('x', ['матрас']), []).stores, store_fingerprint: storesFingerprint(stores), now });

  it('upsertBrief adds needs without wiping the notes of the others, keeps notes when a need is briefed again, discards a brief of another run and sums dropped_pii', () => {
    const b1 = upsertBrief(undefined, build('prześcieradło', TERMS), meta());
    expect(Object.keys(b1.needs)).toEqual(['prześcieradło']);
    b1.needs['prześcieradło'].facts.push({ text: 'f1', from_ids: ['#1'], file: 'a.md', line: 1, ts: '' });
    const b2 = upsertBrief(b1, build('poszewka', ['наволочка', 'poszewka']), meta(new Date(NOW.getTime() + 60_000)));
    expect(Object.keys(b2.needs).sort()).toEqual(['poszewka', 'prześcieradło']);
    expect(b2.needs['prześcieradło'].facts).toHaveLength(1);
    expect(b2.built).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    expect(b2.brief_hash).not.toBe(b1.brief_hash);
    expect(b2.dropped_pii).toBe(b2.needs['prześcieradło'].dropped + b2.needs['poszewka'].dropped);
    // the same need again: new snippets, notes kept
    const b3 = upsertBrief(b2, build('prześcieradło', ['простыня']), meta());
    expect(b3.needs['prześcieradło'].facts).toHaveLength(1);
    expect(b3.needs['prześcieradło'].terms).toEqual(['простыня']);
    expect(b3.needs['poszewka']).toBe(b2.needs['poszewka']);
    // another run: start over
    const b4 = upsertBrief(b3, build('x', ['матрас']), { ...meta(), run_id: 'run-2' });
    expect(Object.keys(b4.needs)).toEqual(['x']);
    // hashes are deterministic and cover the snippets
    expect(upsertBrief(undefined, build('prześcieradło', TERMS), meta()).brief_hash).toBe(b1.brief_hash);
    expect(upsertBrief(undefined, build('prześcieradło', TERMS.slice(0, 1)), meta()).brief_hash).not.toBe(b1.brief_hash);
    expect(b1.brief_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('store_fingerprint is stat-only and changes when a note is touched', () => {
    const copy = tmpDir('asa-copy-');
    copyTree(VAULT, copy);
    const s1 = [new ObsidianVaultStore(copy)];
    const fp1 = storesFingerprint(s1);
    expect(storesFingerprint([new ObsidianVaultStore(copy)])).toBe(fp1);
    const brief = upsertBrief(undefined, buildNeedBrief(s1, q('x', ['матрас']), []).need, { run_id: 'r', stores: [], store_fingerprint: fp1, now: NOW });
    expect(storeChanged(brief, [new ObsidianVaultStore(copy)])).toBe(false);
    const target = path.join(copy, '02 - Areas', 'Дом.md');
    const later = new Date(Date.now() + 120_000);
    fs.utimesSync(target, later, later);
    expect(storesFingerprint([new ObsidianVaultStore(copy)])).not.toBe(fp1);
    expect(storeChanged(brief, [new ObsidianVaultStore(copy)])).toBe(true);
    // a change outside the allow-list is invisible
    fs.utimesSync(path.join(copy, 'root-note.md'), later, later);
    const fp2 = storesFingerprint([new ObsidianVaultStore(copy)]);
    fs.writeFileSync(path.join(copy, 'tmp', 'y.md'), 'x', 'utf8');
    expect(storesFingerprint([new ObsidianVaultStore(copy)])).toBe(fp2);
  });

  it('notes on disk: --from copies file:line mechanically, a fact without --from becomes an unsourced assumption, unknown ids and ambiguous needs are refused, built is not refreshed', () => {
    const b = upsertBrief(undefined, build('prześcieradło', TERMS), meta());
    writeBrief(b);
    const fact = addNote({ kind: 'fact', text: 'mattress 180×200 → sheet 180×200', from: '#2', now: new Date(NOW.getTime() + 3_600_000) });
    const s2 = b.needs['prześcieradło'].snippets[1];
    expect(fact).toMatchObject({ kind: 'fact', downgraded: false, from_ids: ['#2'], file: s2.file, line: s2.line });
    expect(fact.need.facts[0]).toMatchObject({ text: 'mattress 180×200 → sheet 180×200', from_ids: ['#2'], file: s2.file, line: s2.line, modified: s2.modified });
    const down = addNote({ kind: 'fact', text: 'colour black' });
    expect(down).toMatchObject({ kind: 'assumption', downgraded: true });
    expect(down.need.assumptions[0]).toMatchObject({ text: 'colour black', reason: 'unsourced' });
    expect(addNote({ kind: 'question', text: 'pillowcase size', critical: true }).need.open_questions[0]).toMatchObject({ critical: true });
    expect(addNote({ kind: 'query', text: 'prześcieradło z gumką 180x200', from: '#2' }).need.queries[0]).toMatchObject({ query: 'prześcieradło z gumką 180x200', from_ids: ['#2'] });
    expect(() => addNote({ kind: 'fact', text: 'x', from: '#999' })).toThrow(/unknown snippet id #999/);
    expect(() => addNote({ kind: 'fact', text: '   ', from: '#1' })).toThrow(/empty/);
    expect(() => addNote({ need: 'poszewka', kind: 'assumption', text: 'x' })).toThrow(/no brief for need "poszewka"/);
    const disk = readBrief() as ContextBrief;
    expect(disk.built).toBe(b.built);
    expect(disk.brief_hash).toBe(b.brief_hash);
    expect(disk.needs['prześcieradło']).toMatchObject({ facts: [expect.any(Object)], assumptions: [expect.any(Object)], open_questions: [expect.any(Object)], queries: [expect.any(Object)] });
    // two needs: --need becomes mandatory
    writeBrief(upsertBrief(disk, build('poszewka', ['наволочка']), meta()));
    expect(() => addNote({ kind: 'assumption', text: 'x' })).toThrow(/--need is required/);
    expect(addNote({ need: 'POSZEWKA', kind: 'assumption', text: 'x', reason: 'r' }).need.need).toBe('poszewka');
    expect((readBrief() as ContextBrief).needs['prześcieradło'].facts).toHaveLength(1);
  });

  it('the digest shows ids, dates, the !stale marker, headings, columns, script shares and hints — never the vault path', () => {
    const b = upsertBrief(undefined, build('prześcieradło', TERMS), meta());
    const nb = b.needs['prześcieradło'];
    nb.facts.push({ text: 'f', from_ids: ['#1'], file: 'a.md', line: 2, ts: '' });
    nb.open_questions.push({ text: 'q', critical: true, ts: '' });
    const digest = formatBriefDigest(b, 'prześcieradło');
    expect(digest).toContain('context brief for "prześcieradło"');
    expect(digest).toContain('obsidian:vault — 11 file(s)');
    expect(digest).toContain('dropped (PII)');
    expect(digest).toMatch(/script cyrillic \d+% \/ latin \d+%/);
    expect(digest).toContain('#1  ');
    expect(digest).toContain('2026-06-01  02 - Areas/Дом.md:12  §Спальня  [Предмет · Размер · Бренд]  Кровать');
    expect(digest).toContain('2024-01-15!stale  02 - Areas/Old-bed.md:7');
    expect(digest).toContain('fact: f [#1] (a.md:2)');
    expect(digest).toContain('open question: q [critical');
    expect(digest).toContain('next: asa context:note --need "prześcieradło"');
    expect(digest).not.toContain(VAULT);
    expect(formatBriefDigest(b, 'prześcieradło', 2)).toContain('more in .state/context-brief.json');
    expect(formatBriefDigest(b, 'other')).toContain('no need "other"');
    // 0 hits against a Cyrillic store with Latin-only terms
    const nothing: NeedBrief = { ...build('sheet', ['zzzz-no-such-term']), terms: ['sheet'] };
    const b0 = upsertBrief(undefined, nothing, { ...meta(), stores: [{ id: 'obsidian:vault', kind: 'obsidian', files: 100, script: { cyrillic: 0.9, latin: 0.1 } }] });
    expect(formatBriefDigest(b0, 'sheet')).toContain('mostly Cyrillic');
    expect(formatBriefDigest(upsertBrief(undefined, nothing, meta()), 'sheet')).toContain('hint: no line of the stores');
  });
});

describe('CLI (spawned asa)', () => {
  const privateDir = tmpDir('asa-priv-');
  const stateDir = tmpDir('asa-state-');
  const h = computeMandateHash(MANDATE_LF);
  if ('error' in h) throw new Error(h.error);
  const baseConfig = { MANDATE_SHA256: h.hash, REF_FULL_NAME: 'Jan Testowy' };
  writePrivateRepo(privateDir, withSignedHash(MANDATE_LF, h.hash), baseConfig);
  const tsx = path.join(RUNTIME, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  // async spawn: the vitest worker keeps serving its RPC while the CLI runs (spawnSync blocks it for the whole test)
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
  const auditText = () => {
    const raw = path.join(privateDir, 'measurements', 'raw');
    return fs.existsSync(raw) ? fs.readdirSync(raw).map((f) => fs.readFileSync(path.join(raw, f), 'utf8')).join('') : '';
  };
  const events = () => auditText().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { event: string; data?: Record<string, unknown> });
  const state = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8')) as T;
  type Brief = { run_id: string; built: string; brief_hash: string; store_fingerprint: string; dropped_pii: number; needs: Record<string, { hits: number; snippets: { id: string; file: string; line: number }[]; facts: { file: string; line: number; from_ids: string[] }[]; assumptions: { reason: string }[]; open_questions: { critical: boolean }[]; queries: { query: string }[] }> };
  const offer = (id: string, need: string, title: string, price: number) => ({ id, need, title, url: `https://allegro.pl/oferta/${id}`, price_pln: price, shipping_pln: 0, smart: true, free_delivery: true, seller: 'sklep_posciel', seller_rating: 99.5, super_seller: false, sales_count: 500, condition: 'new', format: 'BUY_NOW', seller_type: 'firma' });

  it('no run → no_run; search without a brief → exit 2 and context_gate_stop; --no-context passes only with CONTEXT_OPTIONAL=1 and a known code', async () => {
    // 29.90 + the assumed 10.95 Smart! delivery stays under the 50 PLN order limit of the test mandate
    fs.writeFileSync(path.join(stateDir, 'offers.session.json'), JSON.stringify({ offers: [offer('o1', 'prześcieradło', 'Prześcieradło z gumką 180x200 czarne', 29.9)] }), 'utf8');
    const noRun = await asa(['context:brief', '--need', 'prześcieradło', '--terms', 'простыня']);
    expect(noRun.code).toBe(2);
    expect(noRun.err).toContain('STOP: context_missing');
    expect(noRun.err).toContain('no_run');
    expect((await asa(['search', '--source', 'state', '--need', 'prześcieradło', '--query', 'prześcieradło 180x200'])).code).toBe(2);
    expect(events().filter((e) => e.event === 'context_gate_stop' && e.data?.reason === 'no_run')).toHaveLength(2);

    expect((await asa(['run:start', '--command', 'sheet and pillowcase test'])).code).toBe(0);
    const s1 = await asa(['search', '--source', 'state', '--need', 'prześcieradło', '--query', 'prześcieradło 180x200', '--category', 'Dom']);
    expect(s1.code).toBe(2);
    expect(s1.err).toContain('STOP: context_missing');
    expect(s1.err).toContain('asa context:brief --need "prześcieradło"');
    expect(events().some((e) => e.event === 'stop' && e.data?.reason === 'context_missing' && e.data?.gate === 'no_brief')).toBe(true);
    expect(events().some((e) => e.event === 'context_gate_stop' && e.data?.reason === 'no_brief')).toBe(true);
    expect(state<{ status: string; note: string }>('step-result.json')).toMatchObject({ status: 'stop', note: 'STOP: context_missing' });

    // --no-context without CONTEXT_OPTIONAL: still exit 2, no context_skipped
    const s2 = await asa(['search', '--source', 'state', '--need', 'prześcieradło', '--query', 'prześcieradło 180x200', '--category', 'Dom', '--no-context', 'repeat_purchase']);
    expect(s2.code).toBe(2);
    expect(s2.err).toContain('CONTEXT_OPTIONAL=1 is not set');
    expect(events().some((e) => e.event === 'context_skipped')).toBe(false);
    // with CONTEXT_OPTIONAL=1 in config.env: a known code passes and is audited, an unknown one does not
    writePrivateRepo(privateDir, withSignedHash(MANDATE_LF, h.hash), { ...baseConfig, CONTEXT_OPTIONAL: '1' });
    expect((await asa(['search', '--source', 'state', '--need', 'prześcieradło', '--query', 'prześcieradło 180x200', '--category', 'Dom', '--no-context', 'because'])).code).toBe(2);
    const s3 = await asa(['search', '--source', 'state', '--need', 'prześcieradło', '--query', 'prześcieradło 180x200', '--category', 'Dom', '--no-context', 'repeat_purchase']);
    expect(s3.code).toBe(0);
    expect(events().filter((e) => e.event === 'context_skipped')).toHaveLength(1);
    expect(events().find((e) => e.event === 'context_skipped')?.data).toMatchObject({ reason_code: 'repeat_purchase', gate: 'no_brief', need: 'prześcieradło' });
    writePrivateRepo(privateDir, withSignedHash(MANDATE_LF, h.hash), baseConfig);
    fs.unlinkSync(path.join(stateDir, 'offers.json'));
  }, 180_000);

  it('brief → notes with --from → query binding → search passes; exact need labels; audit carries ids and counts, no texts or paths', async () => {
    const b = await asa(['context:brief', '--need', 'prześcieradło', '--terms', 'простыня,наволочка;матрас,180x200,poszewka,pillowcase']);
    expect(b.code).toBe(0);
    expect(b.out).toContain('context brief for "prześcieradło"');
    expect(b.out).toContain('obsidian:vault');
    expect(b.out).toContain('02 - Areas/Дом.md:12');
    expect(b.out).toMatch(/\n\s+#1 {2}/);
    expect(b.out).not.toContain(VAULT);
    expect(b.out).not.toMatch(/WAW123A|00-001|90010112349|example\.com/);
    const brief = state<Brief>('context-brief.json');
    const run = state<{ run_id: string; context?: { brief_hash: string; needs: string[]; built: string } }>('run.json');
    expect(run.context).toEqual({ brief_hash: brief.brief_hash, needs: ['prześcieradło'], built: brief.built });
    expect(brief.run_id).toBe(run.run_id);
    expect(brief.dropped_pii).toBeGreaterThan(0);
    expect(brief.store_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(path.join(stateDir, 'context-index.json'))).toBe(true);
    const cb = events().find((e) => e.event === 'context_brief');
    expect(cb?.data).toMatchObject({ need: 'prześcieradło', brief_hash: brief.brief_hash, store_fingerprint: brief.store_fingerprint, hits: brief.needs['prześcieradło'].hits, stores: [{ id: 'obsidian:vault', files: 11 }] });
    expect(typeof cb?.data?.dropped_pii).toBe('number');
    expect(typeof cb?.data?.elapsed_ms).toBe('number');
    expect(JSON.stringify(cb)).not.toContain('Кровать');
    expect(JSON.stringify(cb)).not.toContain(VAULT);

    // a foreign / substring need does not pass
    const foreign = await asa(['search', '--source', 'state', '--need', 'prześcieradło z gumką', '--query', 'x', '--category', 'Dom']);
    expect(foreign.code).toBe(2);
    expect(events().some((e) => e.event === 'context_gate_stop' && e.data?.reason === 'need_missing')).toBe(true);

    // notes: a fact needs --from; the file:line is copied from the snippet; PII is refused
    const dom = brief.needs['prześcieradło'].snippets.find((s) => s.file === '02 - Areas/Дом.md') as { id: string; line: number };
    const f = await asa(['context:note', '--need', 'prześcieradło', '--fact', 'mattress 180×200 → sheet 180×200', '--from', dom.id]);
    expect(f.code).toBe(0);
    expect(f.out).toContain(`(02 - Areas/Дом.md:${dom.line})`);
    const nf = await asa(['context:note', '--need', 'prześcieradło', '--fact', 'colour: black']);
    expect(nf.code).toBe(0);
    expect(nf.err).toContain('recorded as an assumption');
    expect((await asa(['context:note', '--need', 'prześcieradło', '--assumption', 'two pieces', '--reason', 'the home note says two sets'])).code).toBe(0);
    expect((await asa(['context:note', '--need', 'prześcieradło', '--question', 'pillowcase size unknown'])).code).toBe(0);
    expect((await asa(['context:note', '--need', 'prześcieradło', '--fact', 'call 600 100 200', '--from', dom.id])).code).toBe(1);
    expect((await asa(['context:note', '--need', 'prześcieradło', '--assumption', 'password is qwerty'])).code).toBe(1);
    expect((await asa(['context:note', '--need', 'prześcieradło', '--fact', 'a', '--question', 'b'])).code).toBe(1);
    expect((await asa(['context:note', '--need', 'nothing', '--assumption', 'x'])).code).toBe(1);
    expect((await asa(['context:note', '--need', 'prześcieradło', '--fact', 'x', '--from', '#999'])).code).toBe(1);
    const withNotes = state<Brief>('context-brief.json');
    const nb = withNotes.needs['prześcieradło'];
    expect(nb.facts).toEqual([expect.objectContaining({ file: '02 - Areas/Дом.md', line: dom.line, from_ids: [dom.id] })]);
    expect(nb.assumptions.map((a) => a.reason)).toEqual(['unsourced', 'the home note says two sets']);
    expect(nb.open_questions).toHaveLength(1);
    expect(withNotes.built).toBe(brief.built);
    expect(withNotes.brief_hash).toBe(brief.brief_hash);
    const notes = events().filter((e) => e.event === 'context_note');
    expect(notes).toHaveLength(4);
    expect(notes[0].data).toMatchObject({ need: 'prześcieradło', kind: 'fact', from_ids: [dom.id], file: '02 - Areas/Дом.md', line: dom.line });
    expect(notes[1].data).toMatchObject({ kind: 'assumption', downgraded: true });
    expect(JSON.stringify(notes)).not.toContain('mattress 180');
    expect(JSON.stringify(notes)).not.toContain('colour: black');

    // query binding: the search string must have been recorded for this need
    const nq = await asa(['search', '--source', 'state', '--need', 'prześcieradło', '--query', 'prześcieradło z gumką 180x200', '--category', 'Dom']);
    expect(nq.code).toBe(2);
    expect(nq.err).toContain('query_not_derived');
    expect((await asa(['context:note', '--need', 'prześcieradło', '--query', 'prześcieradło z gumką 180x200', '--from', dom.id])).code).toBe(0);
    expect(events().find((e) => e.event === 'context_query')?.data).toMatchObject({ need: 'prześcieradło', query: 'prześcieradło z gumką 180x200', from_ids: [dom.id] });
    const ok = await asa(['search', '--source', 'state', '--need', 'prześcieradło', '--query', 'Prześcieradło z gumką 180x200', '--category', 'Dom']);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('1 within the mandate');
  }, 180_000);

  it('basket:plan prints the facts with file:line and the assumptions, leaves a need with a critical question out, report and metrics count the context', async () => {
    // a second need: briefed, queried, searched, then a critical question is recorded
    fs.writeFileSync(path.join(stateDir, 'offers.session.json'), JSON.stringify({ offers: [offer('o2', 'poszewka', 'Poszewka 50x70 czarna', 15)] }), 'utf8');
    const b2 = await asa(['context:brief', '--need', 'poszewka', '--terms', 'наволочка,poszewka,50x70']);
    expect(b2.code).toBe(0);
    expect(b2.out).toContain('needs in brief: 2');
    const brief = state<Brief>('context-brief.json');
    expect(Object.keys(brief.needs).sort()).toEqual(['poszewka', 'prześcieradło']);
    expect(brief.needs['prześcieradło'].facts).toHaveLength(1);
    expect((await asa(['context:note', '--need', 'poszewka', '--query', 'poszewka 50x70 czarna'])).code).toBe(0);
    expect((await asa(['search', '--source', 'state', '--need', 'poszewka', '--query', 'poszewka 50x70 czarna', '--category', 'Dom', '--append'])).code).toBe(0);
    expect((await asa(['context:note', '--need', 'poszewka', '--question', 'pillow size 50x70 or 70x80', '--critical'])).code).toBe(0);
    expect(events().some((e) => e.event === 'context_note' && e.data?.kind === 'question' && e.data?.critical === true)).toBe(true);
    // a critical question closes the search gate for that need
    expect((await asa(['search', '--source', 'state', '--need', 'poszewka', '--query', 'poszewka 50x70 czarna', '--category', 'Dom', '--append'])).code).toBe(2);
    expect(events().some((e) => e.event === 'context_gate_stop' && e.data?.reason === 'critical_open')).toBe(true);

    const plan = await asa(['basket:plan']);
    expect(plan.code).toBe(0);
    expect(plan.out).toContain('🛒 Proposal #');
    expect(plan.out).toContain('Facts from your notes: mattress 180×200 → sheet 180×200 (02 - Areas/Дом.md:12).');
    expect(plan.out).toContain('Assumptions from your notes: colour: black, two pieces.');
    expect(plan.out).toContain('not derived: pillowcase size unknown');
    expect(plan.out).toContain('not taken (critical parameter unknown): poszewka — pillow size 50x70 or 70x80');
    expect(plan.out).not.toContain('Poszewka 50x70 czarna');
    expect(plan.out).toContain('Reply: "ok" (=A)');
    expect(state<{ context_brief_hash: string; primary: string[] }>('basket-plan.json')).toMatchObject({ context_brief_hash: brief.brief_hash, primary: ['prześcieradło'] });
    const planRu = await asa(['basket:plan'], { ASA_LANG: 'ru' });
    expect(planRu.code).toBe(0);
    expect(planRu.out).toContain('Факты из vault: mattress 180×200 → sheet 180×200 (02 - Areas/Дом.md:12).');
    expect(planRu.out).toContain('не вывел (критичный параметр неизвестен): poszewka');

    const report = await asa(['report']);
    expect(report.code).toBe(0);
    expect(report.out).toContain('## Context');
    expect(report.out).toContain('- fact: mattress 180×200 → sheet 180×200 (02 - Areas/Дом.md:12)');
    expect(report.out).toContain('- open question: pillow size 50x70 or 70x80 [critical]');
    expect(report.out).toMatch(/Context: 2 brief\(s\), 1 fact\(s\), 2 assumption\(s\), 1 critical question\(s\), 1 gate skip\(s\), \d+ snippet\(s\) dropped \(PII\)/);
    const metrics = JSON.parse((await asa(['metrics'])).out) as { context: Record<string, number> };
    expect(metrics.context).toMatchObject({ briefs: 2, facts: 1, assumptions: 2, critical_questions: 1, queries: 2, skips: 1 });
    expect(metrics.context.pii_dropped).toBeGreaterThan(0);

    // a new run deletes the brief: the gate closes again; without stores the reason is no_stores
    expect((await asa(['run:start', '--command', 'again'])).code).toBe(0);
    expect(fs.existsSync(path.join(stateDir, 'context-brief.json'))).toBe(false);
    expect(fs.existsSync(path.join(stateDir, 'context-index.json'))).toBe(true);
    expect((await asa(['search', '--source', 'state', '--need', 'prześcieradło', '--query', 'x', '--category', 'Dom'])).code).toBe(2);
    const noStores = await asa(['context:brief', '--need', 'x'], { ASA_CONTEXT_STORES: '' });
    expect(noStores.code).toBe(2);
    expect(noStores.err).toContain('no_stores');
    // 0 hits: exit 3, the gate stays closed until an assumption or question exists
    const zero = await asa(['context:brief', '--need', 'zzz nothing', '--terms', 'qqq-no-such-term']);
    expect(zero.code).toBe(3);
    expect(zero.out).toContain('hint:');
    const ew = await asa(['search', '--source', 'state', '--need', 'zzz nothing', '--query', 'q', '--category', 'Dom']);
    expect(ew.code).toBe(2);
    expect(events().some((e) => e.event === 'context_gate_stop' && e.data?.reason === 'empty_without_notes')).toBe(true);
  }, 180_000);
});
