import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  appendPurchase,
  boughtBefore,
  checkProfileFiles,
  formatProfileCheck,
  isBlocked,
  isConsumableCategory,
  jaccard,
  loadProfile,
  piiKindsIn,
  purchasesFromSeller,
  recentlyBought,
  titleTokens,
  wishlistMatch,
  type PurchaseRecord,
} from '../src/profile.js';
import { tmpDir } from './helpers.js';

const EXAMPLES = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'examples', 'shopping-profile');

/** Copy the synthetic examples under their real names. */
function exampleProfile(): string {
  const dir = tmpDir('asa-profile-');
  for (const [from, to] of [
    ['wishlist.example.jsonl', 'wishlist.jsonl'],
    ['purchase-history.example.jsonl', 'purchase-history.jsonl'],
    ['sellers.example.json', 'sellers.json'],
    ['do-not-buy.example.txt', 'do-not-buy.txt'],
  ]) fs.copyFileSync(path.join(EXAMPLES, from), path.join(dir, to));
  return dir;
}

const NOW = new Date('2026-09-04T10:00:00Z');

describe('loadProfile', () => {
  it('tolerates a missing directory and missing files (empty profile)', () => {
    const p = loadProfile(path.join(tmpDir(), 'nowhere'));
    expect(p).toMatchObject({ wishlist: [], history: [], sellers: { trusted: [], avoid: [] }, doNotBuy: [], present: [], errors: [] });
  });

  it('reads the four example files, skipping comments and reporting bad lines', () => {
    const dir = exampleProfile();
    fs.appendFileSync(path.join(dir, 'wishlist.jsonl'), '{"label":"broken"\n{"query_pl":"no label"}\n', 'utf8');
    const p = loadProfile(dir);
    expect(p.present).toEqual(['wishlist.jsonl', 'purchase-history.jsonl', 'sellers.json', 'do-not-buy.txt']);
    expect(p.wishlist.map((l) => l.label)).toEqual(['nakretka-niska-m5', 'nakretka-wbijana-m5', 'klej-sztyft', 'rzep-dwustronny']);
    expect(p.wishlist[0]).toMatchObject({ query_pl: 'nakrętka niska M5 DIN 439 A2 20 szt', category: 'Крепёж и метизы', qty: 1, max_item_pln: 25, priority: 1, spec: { thread: 'M5', material: 'A2', pack: 20 }, source: '[[Example note — M5 threads]]' });
    expect(p.wishlist[2].consumable).toBe(true);
    expect(p.history).toHaveLength(4);
    expect(p.history[1]).toMatchObject({ date: '2026-08-05', seller: 'example_fasteners_pl', title: 'Rym-bolt DIN 580 M5 A4 4 szt', qty: 1, price_pln: 23.7, category: 'Крепёж и метизы', offer_id: '100000000002', source: 'example' });
    expect(p.sellers).toEqual({ trusted: ['example_fasteners_pl', 'example_filament_pl', 'example_seals_pl'], avoid: ['example_slow_shipper', 'example_dispute_2026'] });
    expect(p.doNotBuy).toHaveLength(4);
    expect(p.doNotBuy[3]).toBeInstanceOf(RegExp);
    expect(p.errors).toHaveLength(2);
    expect(p.errors[0]).toMatch(/^wishlist\.jsonl:8 — /);
    expect(p.errors[1]).toContain('without label/query_pl');
  });
});

describe('boughtBefore (same offer_id, or same seller + Jaccard >= 0.5 on title tokens)', () => {
  const history: PurchaseRecord[] = loadProfile(exampleProfile()).history;

  it('tokenises titles without one-character noise and computes Jaccard', () => {
    expect(Array.from(titleTokens('Rym-bolt DIN 580 M5 A4 4 szt'))).toEqual(['rym', 'bolt', 'din', '580', 'm5', 'a4', 'szt']);
    expect(jaccard(titleTokens('Rym-bolt DIN 580 M5 A4 ×4'), titleTokens('Rym-bolt DIN 580 M5 A4 4 szt'))).toBeCloseTo(6 / 7, 5);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it('matches by offer id regardless of seller or title', () => {
    expect(boughtBefore(history, { id: '100000000002', seller: 'someone_else', title: 'Completely different' })?.date).toBe('2026-08-05');
    expect(boughtBefore(history, { id: 'x', offer_id: '100000000001', seller: '', title: '' })?.title).toBe('Śruba DIN 912 M5x16 A2 50 szt');
    expect(boughtBefore(history, { id: 'rym-bolt-din-580-m5-a4-100000000002', seller: '', title: '' })?.date).toBe('2026-08-05');
  });

  it('matches by seller + title overlap, not by title alone, not by seller alone', () => {
    const offer = { id: '999', seller: 'EXAMPLE_FASTENERS_PL', title: 'Rym-bolt DIN 580 M5 A4 ×4' };
    expect(boughtBefore(history, offer)?.date).toBe('2026-08-05');
    expect(boughtBefore(history, { ...offer, seller: 'other_shop' })).toBeUndefined();
    expect(boughtBefore(history, { ...offer, title: 'Nakrętka DIN 985 M5 A2 50 szt' })).toBeUndefined();
    expect(boughtBefore([], offer)).toBeUndefined();
  });

  it('returns the most recent match and lists a seller\'s purchases newest first', () => {
    const twice = [...history, { date: '2026-08-30', seller: 'example_fasteners_pl', title: 'Rym-bolt DIN 580 M5 A4 4 szt', qty: 1, price_pln: 23.7, category: 'x', source: 'test' }];
    expect(boughtBefore(twice, { id: '1', seller: 'example_fasteners_pl', title: 'Rym-bolt DIN 580 M5 A4' })?.date).toBe('2026-08-30');
    expect(purchasesFromSeller(history, 'example_fasteners_pl').map((r) => r.date)).toEqual(['2026-08-05', '2026-07-21']);
  });

  it('recentlyBought honours the cooldown and ignores consumables', () => {
    const oring = { id: '1', seller: 'example_seals_pl', title: 'O-ring 62x2 NBR 10 szt' };
    expect(recentlyBought(history, oring, 30, NOW)?.date).toBe('2026-08-24');
    expect(recentlyBought(history, oring, 10, NOW)).toBeUndefined();
    expect(recentlyBought(history, { id: '1', seller: 'example_fasteners_pl', title: 'Rym-bolt DIN 580 M5 A4' }, 30, NOW)).toBeUndefined();
    expect(recentlyBought(history, { id: '1', seller: 'example_fasteners_pl', title: 'Rym-bolt DIN 580 M5 A4' }, 60, NOW)?.date).toBe('2026-08-05');
    expect(recentlyBought(history, { id: '100000000003', seller: 'example_filament_pl', title: 'Filament PETG 1,75 mm 1 kg czarny' }, 365, NOW)).toBeUndefined();
  });
});

describe('isBlocked / wishlistMatch / consumables', () => {
  const profile = loadProfile(exampleProfile());
  it('blocks do-not-buy titles (substring or all words), regex patterns and avoided sellers', () => {
    expect(isBlocked(profile, { id: '1', seller: 'x', title: 'Śruba DIN 7991 M3x10 A2 100 szt' })).toEqual({ blocked: true, reason: 'do_not_buy', pattern: 'din 7991 m3' });
    expect(isBlocked(profile, { id: '1', seller: 'x', title: 'Śruba M5 DIN 7991 A2 stożkowa' })).toMatchObject({ blocked: true, reason: 'do_not_buy', pattern: 'din 7991 m5' });
    expect(isBlocked(profile, { id: '1', seller: 'x', title: 'Adapter 1/4 na 3/8 statyw' })).toMatchObject({ blocked: true, reason: 'do_not_buy' });
    expect(isBlocked(profile, { id: '1', seller: 'x', title: 'Śruba DIN 912 M5x16 A2' })).toEqual({ blocked: false });
    expect(isBlocked(profile, { id: '1', seller: 'Example_Slow_Shipper', title: 'Śruba DIN 912 M5x16 A2' })).toEqual({ blocked: true, reason: 'seller_avoided', pattern: 'Example_Slow_Shipper' });
  });
  it('finds the wishlist line by need label or by query overlap', () => {
    expect(wishlistMatch(profile.wishlist, { id: '1', title: 'whatever', need: 'klej-sztyft' })?.label).toBe('klej-sztyft');
    expect(wishlistMatch(profile.wishlist, { id: '1', title: 'Nakrętka niska M5 DIN 439 A2 20 szt nierdzewna' })?.label).toBe('nakretka-niska-m5');
    expect(wishlistMatch(profile.wishlist, { id: '1', title: 'Filament PLA 1 kg' })).toBeUndefined();
  });
  it('recognises consumable categories', () => {
    expect(isConsumableCategory('Расходники 3D-печати')).toBe(true);
    expect(isConsumableCategory('Крепёж и метизы')).toBe(false);
    expect(isConsumableCategory(undefined)).toBe(false);
  });
});

describe('appendPurchase', () => {
  it('appends one JSON line per confirmed order and reads it back (round trip), repairing a missing trailing newline', () => {
    const dir = path.join(tmpDir(), 'shopping-profile');
    const rec: PurchaseRecord = { date: '2026-09-04', seller: 'example_fasteners_pl', title: 'Nakrętka niska M5 DIN 439 A2 20 szt', qty: 1, price_pln: 12.5, category: 'Крепёж и метизы', offer_id: '100000000009', source: 'asa order ORD-1', order_id: 'ORD-1' };
    const file = appendPurchase(dir, rec);
    expect(file).toBe(path.join(dir, 'purchase-history.jsonl'));
    fs.appendFileSync(file, '{"date":"2026-09-04","seller":"s","title":"torn","qty":1,"price_pln":1,"category":"c","source":"x"}', 'utf8');
    appendPurchase(dir, { ...rec, title: 'Second', offer_id: undefined, order_id: undefined });
    const text = fs.readFileSync(file, 'utf8');
    expect(text.split('\n').filter(Boolean)).toHaveLength(3);
    expect(text.endsWith('\n')).toBe(true);
    const back = loadProfile(dir).history;
    expect(back).toHaveLength(3);
    expect(back[0]).toEqual(rec);
    expect(back[2]).toMatchObject({ title: 'Second', price_pln: 12.5 });
    expect(back[2].offer_id).toBeUndefined();
    expect(() => appendPurchase(dir, { ...rec, date: 'yesterday' })).toThrow(/YYYY-MM-DD/);
  });
});

describe('checkProfileFiles (asa profile:check)', () => {
  it('flags a postal code and an InPost locker code without echoing the values; standards like DIN580 pass', () => {
    const dir = exampleProfile();
    fs.appendFileSync(path.join(dir, 'wishlist.jsonl'), '{"label":"leak","query_pl":"odbiór 00-001 Warszawa","category":"Крепёж и метизы","qty":1,"priority":9}\n{"label":"leak2","query_pl":"paczkomat WAW123A","category":"Крепёж и метизы","qty":1,"priority":9}\n{"label":"ok","query_pl":"rym-bolt DIN580 ISO4762 AWG12","category":"Крепёж и метизы","qty":1,"priority":9}\n', 'utf8');
    const c = checkProfileFiles(dir, { now: NOW });
    expect(c.pii).toBe(true);
    expect(c.ok).toBe(false);
    expect(c.findings.filter((f) => f.kind.startsWith('pii_')).map((f) => [f.file, f.line, f.kind])).toEqual([
      ['wishlist.jsonl', 8, 'pii_postal_code'],
      ['wishlist.jsonl', 9, 'pii_locker_code'],
    ]);
    const text = formatProfileCheck(c);
    expect(text).toContain('PII  wishlist.jsonl:8  postal_code-like value on line 8');
    expect(text).not.toContain('00-001');
    expect(text).not.toContain('WAW123A');
    expect(text).toContain('PROFILE: PII FOUND');
  });

  it('detects phones, NIP and IBAN shapes but not bare offer ids or dates', () => {
    expect(piiKindsIn('tel. +48 601 234 567')).toEqual(['pii_phone']);
    expect(piiKindsIn('kontakt 601-234-567')).toEqual(['pii_phone']);
    expect(piiKindsIn('NIP 123-456-32-18')).toEqual(['pii_nip']);
    expect(piiKindsIn('PL61 1090 1014 0000 0712 1981 2874')).toEqual(['pii_iban']);
    expect(piiKindsIn('{"offer_id":"123456789","date":"2026-09-04","price_pln":12.5}')).toEqual([]);
    expect(piiKindsIn('Śruba DIN 912 M5x16 A2 50 szt, KRA01M')).toEqual(['pii_locker_code']);
  });

  it('reports files older than 14 days, missing files and categories outside the mandate', () => {
    const dir = exampleProfile();
    const old = new Date(NOW.getTime() - 20 * 86_400_000);
    fs.utimesSync(path.join(dir, 'purchase-history.jsonl'), old, old);
    fs.unlinkSync(path.join(dir, 'sellers.json'));
    const c = checkProfileFiles(dir, { now: NOW, categories: ['Крепёж и метизы', 'Уплотнители, клеи и герметики'] });
    expect(c.pii).toBe(false);
    expect(c.stale).toBe(true);
    expect(c.ok).toBe(false);
    expect(c.findings.map((f) => [f.file, f.kind])).toEqual([
      ['purchase-history.jsonl', 'stale'],
      ['sellers.json', 'missing'],
      ['wishlist.jsonl', 'category_unknown'],
    ]);
    expect(c.findings[2].detail).toContain('rzep-dwustronny');
    expect(formatProfileCheck(c)).toContain('PROFILE: STALE');
    const fresh = checkProfileFiles(exampleProfile(), { now: NOW });
    expect(fresh).toMatchObject({ pii: false, stale: false, ok: true, findings: [] });
    expect(formatProfileCheck(fresh)).toBe('PROFILE: OK');
  });
});

describe('config: Smart! basket keys', () => {
  it('has typed defaults and reads the new keys; rejects a bad rail', () => {
    const dir = tmpDir();
    const d = loadConfig({ privateDir: dir });
    expect(d).toMatchObject({ smartThresholdPln: 49.9, smartSlackPln: 25, maxComplements: 1, reorderCooldownDays: 30, defaultRail: 'oneclick_card', shoppingProfileDir: path.join(dir, 'shopping-profile') });
    expect(d.allegroLogin).toBeUndefined();
    expect(d.unknownKeys).toEqual([]);
    fs.writeFileSync(path.join(dir, 'config.env'), 'SMART_THRESHOLD_PLN=45\nSMART_SLACK_PLN=20,5\nMAX_COMPLEMENTS=2\nREORDER_COOLDOWN_DAYS=14\nSHOPPING_PROFILE_DIR=C:\\profiles\\me\nDEFAULT_RAIL=allegro_pay\nALLEGRO_LOGIN=some_login\n', 'utf8');
    const c = loadConfig({ privateDir: dir });
    expect(c).toMatchObject({ smartThresholdPln: 45, smartSlackPln: 20.5, maxComplements: 2, reorderCooldownDays: 14, shoppingProfileDir: 'C:\\profiles\\me', defaultRail: 'allegro_pay', allegroLogin: 'some_login', unknownKeys: [] });
    fs.writeFileSync(path.join(dir, 'config.env'), 'DEFAULT_RAIL=blik\n', 'utf8');
    expect(() => loadConfig({ privateDir: dir })).toThrow(/DEFAULT_RAIL/);
    fs.writeFileSync(path.join(dir, 'config.env'), 'SMART_THRESHOLD_PLN=free\n', 'utf8');
    expect(() => loadConfig({ privateDir: dir })).toThrow(/SMART_THRESHOLD_PLN/);
  });
});
