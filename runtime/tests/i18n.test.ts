import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { amendMandateLimits, signMandate } from '../src/amend.js';
import { formatPlan, parseReply, planBaskets, proposeComplements, railLabel, type BasketOffer } from '../src/basket.js';
import { DEFAULT_PRIVATE_DIR, loadConfig } from '../src/config.js';
import { getLang, money, setLang, t } from '../src/i18n.js';
import { checkMandate, parseMandate } from '../src/mandate.js';
import { MANDATE_LF, tmpDir, writePrivateRepo } from './helpers.js';

function offer(id: string, over: Partial<BasketOffer> & { price_pln: number; seller: string }): BasketOffer {
  return { id, url: `https://allegro.pl/oferta/${id}`, title: `Item ${id}`, shipping_pln: 0, free_delivery: true, smart: true, seller_rating: 99, super_seller: false, sales_count: 120, condition: 'new', format: 'BUY_NOW', source: 'session', seller_type: 'firma', total_with_delivery_pln: over.price_pln + 10.95, ...over };
}

const NEEDS = [
  { label: 'n1', category: 'Fasteners' },
  { label: 'n2', category: 'Fasteners' },
];
const LIMITS = { perItemLimit: 60, perOrderLimit: 100, maxItems: 4, remainingAggregate: 600 };

describe('i18n: English by default, Russian with ASA_LANG=ru, parsers bilingual', () => {
  afterEach(() => setLang('en'));

  it('setLang falls back to English for unknown values; t() and money() follow the language', () => {
    expect(getLang()).toBe('en');
    expect(setLang('xx')).toBe('en');
    expect(t('plan.none')).toBe('none');
    expect(money(12.5)).toBe('12.50');
    expect(setLang('RU')).toBe('ru');
    expect(t('plan.none')).toBe('нет');
    expect(money(12.5)).toBe('12,50');
    expect(t('plan.none', undefined, 'en')).toBe('none');
    expect(t('no.such.key')).toBe('no.such.key');
    expect(railLabel('oneclick_card')).toBe('карта one-click');
    expect(railLabel('oneclick_card', 'en')).toBe('one-click card');
  });

  it('formatPlan writes the proposal in English by default and in Russian on request', () => {
    const plan = planBaskets(NEEDS, [offer('a1', { price_pln: 12.5, seller: 'SHOP', need: 'n1', title: 'Nut M5' }), offer('a2', { price_pln: 17, seller: 'SHOP', need: 'n2', title: 'Insert M5' })], { threshold: 49.9, ...LIMITS, boughtBeforeFn: () => ({ date: '2026-08-05' }) });
    const proposal = proposeComplements(plan, [offer('c1', { price_pln: 23.7, seller: 'SHOP', title: 'Eye bolt M5' })], { threshold: 49.9, slack: 25, boughtBeforeFn: () => ({ date: '2026-08-05' }) });
    const en = formatPlan(plan, proposal, { runId: 'r1', remainingPln: 600, limits: { perItem: 60, perOrder: 100, maxItems: 4 }, purchaseDates: ['2026-08-05', '2026-07-21'], assumptions: ['stainless A2'], facts: ['mattress 180×200'], notTaken: ['not derived: colour'] });
    expect(en).toBe(
      [
        '🛒 Proposal #r1 · SHOP (Smart!, bought 21.07 and 05.08) · Paczkomat InPost · one-click card',
        '1. Nut M5 — 12.50   [need: n1]',
        '2. Insert M5 — 17.00   [need: n2]',
        'Items 29.50 → 20.40 short of the 49.90 threshold.',
        '3. (+) Eye bolt M5 — 23.70  [bought from this seller on 05.08; tier 1]',
        'A: with #3 = 53.20 + delivery 0 = 53.20 zł  ← default     B: without #3 = 29.50 + 10.95 = 40.45 zł',
        'Facts from your notes: mattress 180×200.',
        'Assumptions from your notes: stainless A2.',
        'Limits: item ≤60 ✔ · order ≤100 ✔ · lines ≤4 ✔ · remaining mandate 600.00.',
        'Reply: "ok" (=A) · "ok B" · "ok A/B" (A; if Smart! does not apply — B) · "ok without 3" · "no" · "item limit 120"',
        'not derived: colour',
      ].join('\n'),
    );
    const skipped = formatPlan(plan, proposal, { runId: 'r1', contextSkipped: 'test reason' });
    expect(skipped.split('\n')[1]).toBe('⚠ context not consulted: test reason');
    const over = planBaskets([NEEDS[0]], [offer('q1', { price_pln: 84.9, seller: 'Q', need: 'n1', title: 'Pricey' })], { threshold: 49.9, ...LIMITS });
    const overText = formatPlan(over, proposeComplements(over, [], { threshold: 49.9, slack: 25 }), { runId: 'r2', limits: { perItem: 60, perOrder: 100, maxItems: 4 } });
    expect(overText).toContain('⚠️ #1 84.90 > item limit 60 → reply "ok 84.90" (one-time) or "item limit 120" (permanent)');
    expect(overText).toContain('Reply: "ok 84.90" (one-time) · "item limit 120" (permanent) · "ok without N" · "no" — a bare "ok" is not accepted');
    const ru = formatPlan(plan, proposal, { runId: 'r1', lang: 'ru', purchaseDates: ['2026-08-05'] });
    expect(ru.split('\n')[0]).toBe('🛒 Предложение #r1 · SHOP (Smart!, покупал 05.08) · Paczkomat InPost · карта one-click');
    expect(ru).toContain('Допущения из vault: нет.');
    // the complement reason is worded when the complement is proposed, in the language configured at that moment
    setLang('ru');
    const proposalRu = proposeComplements(plan, [offer('c1', { price_pln: 23.7, seller: 'SHOP', title: 'Eye bolt M5' })], { threshold: 49.9, slack: 25, boughtBeforeFn: () => ({ date: '2026-08-05' }) });
    expect(formatPlan(plan, proposalRu, { runId: 'r1' })).toContain('3. (+) Eye bolt M5 — 23,70  [покупал у него 05.08; ярус 1]');
  });

  it('parseReply accepts the English proposal phrases as well as the Russian ones', () => {
    expect(parseReply('item limit 120')).toMatchObject({ kind: 'limit_item', amount: 120 });
    expect(parseReply('ok order limit 150')).toMatchObject({ kind: 'limit_order', amount: 150 });
    expect(parseReply('limit item 120')).toMatchObject({ kind: 'limit_item', amount: 120 });
    expect(parseReply('лимит позиции 120')).toMatchObject({ kind: 'limit_item', amount: 120 });
    expect(parseReply('ok without 3')).toMatchObject({ kind: 'without', n: 3 });
    expect(parseReply('ok + 4')).toMatchObject({ kind: 'plus', n: 4 });
    expect(parseReply('ok 84.90')).toMatchObject({ kind: 'amount', amount: 84.9 });
    expect(parseReply('ok A/B').kind).toBe('A/B');
    expect(parseReply('no').kind).toBe('no');
    expect(parseReply('ок без 3')).toMatchObject({ kind: 'without', n: 3 });
  });

  it('amend / sign write English labels by default; the parser reads them back and an old Russian mandate still parses', () => {
    const dir = tmpDir();
    const { mandatePath, configPath } = writePrivateRepo(dir, MANDATE_LF.replace('status: signed', 'status: draft'));
    const r = amendMandateLimits(mandatePath, { perItemPln: 60, perPurchasePln: 100, maxItems: 4, aggregatePln: 600, overrideMaxPln: 300, validFrom: '2026-09-04', validTo: '2026-10-04', categories: ['Fasteners', 'Filament'] });
    expect(r.changed).toEqual([
      '- Single-item limit: ≤ 60 PLN',
      '- Single-order limit: ≤ 100 PLN',
      '- Lines per order: ≤ 4 lines',
      '- Aggregate mandate limit: ≤ 600 PLN',
      '- One-time approvals over the limit: allowed up to ≤ 300 PLN',
      '- Validity period: from 2026-09-04 to 2026-10-04',
      '- Categories: Fasteners; Filament',
    ]);
    const parsed = parseMandate(fs.readFileSync(mandatePath, 'utf8'));
    expect(parsed.limits).toEqual({ perItemPln: 60, perPurchasePln: 100, maxItems: 4, aggregatePln: 600, overrideMaxPln: 300, validFrom: '2026-09-04', validTo: '2026-10-04', categories: ['Fasteners', 'Filament'], marketplaces: ['allegro.pl'] });
    const h = signMandate(mandatePath, { signer: 'Test Person (chat)', when: '2026-09-05 12:00 Europe/Warsaw', expectedHash: r.hash.hash, configPath });
    const signed = fs.readFileSync(mandatePath, 'utf8');
    expect(signed).toContain('Signed: Test Person (chat), 2026-09-05 12:00 Europe/Warsaw');
    expect(signed).toContain(`SHA-256 of sections 1–6: ${h.hash}`);
    const green = checkMandate({ config: loadConfig({ privateDir: dir }), now: new Date('2026-10-01T10:00:00Z'), amountPln: 95, itemPln: 55, itemsCount: 3, category: 'Fasteners', domain: 'allegro.pl' });
    expect(green.ok).toBe(true);
    // the untouched Russian mandate of the helpers still parses without errors
    expect(parseMandate(MANDATE_LF).parseErrors).toEqual([]);
  });

  it('loadConfig: ASA_LANG and ASA_CONTEXT_STORES from the environment win over config.env; the private-dir default is platform neutral', () => {
    const dir = tmpDir();
    writePrivateRepo(dir, MANDATE_LF, { ASA_LANG: 'ru', CONTEXT_STORES: 'obsidian:C:\\vault one;jsonl:D:\\profile', CONTEXT_MAX_SNIPPETS: '12', CONTEXT_EXCLUDE: 'Daily/**;Private/**', CONTEXT_BRIEF_MAX_AGE_MIN: '30' });
    const fromFile = loadConfig({ privateDir: dir, env: {} });
    expect(fromFile.lang).toBe('ru');
    expect(fromFile.contextStores).toEqual(['obsidian:C:\\vault one', 'jsonl:D:\\profile']);
    expect(fromFile.contextMaxSnippets).toBe(12);
    expect(fromFile.contextBriefMaxAgeMin).toBe(30);
    expect(fromFile.contextExclude).toEqual(expect.arrayContaining(['04 - Archive/**', '**/\u{1F512}*', 'Daily/**', 'Private/**']));
    expect(fromFile.unknownKeys).toEqual([]);
    const fromEnv = loadConfig({ privateDir: dir, env: { ASA_LANG: 'en', ASA_CONTEXT_STORES: 'folder:E:\\notes' } });
    expect(fromEnv.lang).toBe('en');
    expect(fromEnv.contextStores).toEqual(['folder:E:\\notes']);
    expect(loadConfig({ privateDir: dir, env: { ASA_LANG: 'klingon' } }).lang).toBe('ru');
    const empty = loadConfig({ privateDir: tmpDir(), env: {} });
    expect(empty).toMatchObject({ lang: 'en', contextStores: [], contextMaxSnippets: 40, contextBriefMaxAgeMin: 240 });
    expect(DEFAULT_PRIVATE_DIR.replace(/\\/g, '/')).toMatch(/\/\.asa\/private$/);
    expect(path.isAbsolute(DEFAULT_PRIVATE_DIR)).toBe(true);
  });
});
