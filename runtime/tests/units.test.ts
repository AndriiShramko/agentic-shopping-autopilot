import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hostAllowed, urlAllowed, DEFAULT_ALLOWLIST } from '../src/allowlist.js';
import { loadConfig, parseEnvText, refValues, writeConfigValues } from '../src/config.js';
import { coerceOffer, normalizeApiOffer, parsePln } from '../src/offers.js';
import { filterAndRank, rejectReason } from '../src/rank.js';
import { redactDeep, redactString } from '../src/redact.js';
import { listingUrl } from '../src/serp.js';
import { tmpDir } from './helpers.js';

describe('redaction', () => {
  it('replaces REF values case-insensitively and whitespace-tolerantly', () => {
    const s = redactString('Odbiorca: JAN  Testowy, ul. Przykładowa 12/3', ['Jan Testowy', 'ul. Przykładowa 12/3']);
    expect(s).toBe('Odbiorca: [REDACTED], [REDACTED]');
    expect(redactString('nothing here', [''])).toBe('nothing here');
  });
  it('drops address-like keys deeply and keeps order/amount/url/seller', () => {
    const r = redactDeep({ order_id: 'A', amount_pln: 1, nested: { Address: 'x', city: 'y', seller: 'sklep', offer_url: 'https://allegro.pl/oferta/1' }, list: [{ phone: '1' }] }, []);
    expect(r).toEqual({ order_id: 'A', amount_pln: 1, nested: { seller: 'sklep', offer_url: 'https://allegro.pl/oferta/1' }, list: [{}] });
  });
});

describe('allowlist', () => {
  it('allows allegro.pl / payu.com and their subdomains over https only', () => {
    expect(hostAllowed('allegro.pl')).toBe(true);
    expect(hostAllowed('www.allegro.pl')).toBe(true);
    expect(hostAllowed('secure.payu.com')).toBe(true);
    expect(hostAllowed('allegro.pl.evil.com')).toBe(false);
    expect(hostAllowed('acs.bank.example')).toBe(false);
    expect(urlAllowed('https://allegro.pl/oferta/1')).toBe(true);
    expect(urlAllowed('http://allegro.pl/oferta/1')).toBe(false);
    expect(urlAllowed('https://olx.pl/x', DEFAULT_ALLOWLIST)).toBe(false);
    expect(urlAllowed('https://pay.allegro-pay.example/x', [...DEFAULT_ALLOWLIST, 'pay.allegro-pay.example'])).toBe(true);
  });
});

describe('config.env', () => {
  it('parses quotes, comments and export prefixes; ignores unknown keys but reports them', () => {
    const v = parseEnvText('# c\nMANDATE_SHA256=ABC # trailing\nexport CDP_URL="http://127.0.0.1:9222"\nREF_FULL_NAME=\'Jan Testowy\'\nFOO=bar\n');
    expect(v).toEqual({ MANDATE_SHA256: 'ABC', CDP_URL: 'http://127.0.0.1:9222', REF_FULL_NAME: 'Jan Testowy', FOO: 'bar' });
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'config.env'), 'HUMAN_CONFIRM=1\nMANDATE_SHA256=ABCDEF\nFOO=1\n', 'utf8');
    const cfg = loadConfig({ privateDir: dir });
    expect(cfg.humanConfirm).toBe(true);
    expect(cfg.mandateSha256).toBe('abcdef');
    expect(cfg.unknownKeys).toEqual(['FOO']);
    expect(cfg.mandatePath).toBe(path.join(dir, 'PURCHASE_MANDATE.md'));
    expect(cfg.allegroTokenFile).toBe(path.join(dir, 'secrets', 'allegro-token.json'));
    expect(refValues(cfg)).toEqual([]);
  });
  it('resolves --private-dir and ASA_PRIVATE_DIR', () => {
    const dir = tmpDir();
    expect(loadConfig({ argv: ['search', '--private-dir', dir] }).privateDir).toBe(dir);
    expect(loadConfig({ argv: [], env: { ASA_PRIVATE_DIR: dir } }).privateDir).toBe(dir);
  });
  it('writeConfigValues updates in place and appends missing keys, keeping comments', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'config.env');
    fs.writeFileSync(p, '# keep me\nREF_FULL_NAME=\nCDP_URL=http://127.0.0.1:9222\n', 'utf8');
    writeConfigValues(p, { REF_FULL_NAME: 'Jan Testowy', REF_PICKUP_POINT: 'WAW123A' });
    expect(fs.readFileSync(p, 'utf8')).toBe('# keep me\nREF_FULL_NAME="Jan Testowy"\nCDP_URL=http://127.0.0.1:9222\nREF_PICKUP_POINT=WAW123A\n');
    expect(refValues(loadConfig({ privateDir: dir }))).toEqual(['Jan Testowy', 'WAW123A']);
  });
});

describe('offers', () => {
  it('parses Polish prices', () => {
    expect(parsePln('24,99 zł')).toBe(24.99);
    expect(parsePln('1 299,00')).toBe(1299);
    expect(parsePln('12.5')).toBe(12.5);
    expect(parsePln('7 zł')).toBe(7);
    expect(parsePln('brak')).toBeNull();
  });
  it('normalises an /offers/listing item', () => {
    const o = normalizeApiOffer({
      id: '123456789',
      name: 'Wkręty do drewna 4x40 100 szt',
      sellingMode: { format: 'BUY_NOW', price: { amount: '12.99', currency: 'PLN' } },
      delivery: { availableForFree: false, lowestPrice: { amount: '8.99', currency: 'PLN' } },
      seller: { id: 's1', login: 'sklep_x', superSeller: true },
      parameters: [{ name: 'Stan', values: ['Nowy'] }],
    });
    expect(o).toMatchObject({ id: '123456789', price_pln: 12.99, shipping_pln: 8.99, smart: false, seller: 'sklep_x', super_seller: true, condition: 'new', format: 'BUY_NOW', source: 'api', url: 'https://allegro.pl/oferta/123456789' });
  });
  it('coerces a session-written offer and rejects unusable ones', () => {
    expect(coerceOffer({ id: '1', price_pln: '19,99', smart: true, condition: 'new' })).toMatchObject({ id: '1', price_pln: 19.99, shipping_pln: 0, free_delivery: true, format: 'BUY_NOW', source: 'session' });
    expect(coerceOffer({ id: '', price_pln: 1 })).toBeNull();
    expect(coerceOffer({ id: '2' })).toBeNull();
  });
  it('builds the SERP url with the price ceiling and buy-now filter', () => {
    const u = new URL(listingUrl({ phrase: 'wkręty do drewna', priceTo: 30 }));
    expect(u.hostname).toBe('allegro.pl');
    expect(u.searchParams.get('string')).toBe('wkręty do drewna');
    expect(u.searchParams.get('price_to')).toBe('30');
    expect(u.searchParams.get('order')).toBe('p');
  });
});

describe('rank', () => {
  const base = { title: 't', seller: 's', seller_rating: null, super_seller: false, sales_count: null, condition: 'new' as const, format: 'BUY_NOW' as const, source: 'api' as const, free_delivery: false, smart: false };
  const opts = { perPurchaseLimitPln: 30, remainingPln: 100 };
  it('filters mechanically and sorts by total with Smart preferred on ties', () => {
    const offers = [
      { ...base, id: 'a', url: 'https://allegro.pl/oferta/a', price_pln: 20, shipping_pln: 9.99, seller_rating: 99 },
      { ...base, id: 'b', url: 'https://allegro.pl/oferta/b', price_pln: 25, shipping_pln: null, smart: true, free_delivery: true },
      { ...base, id: 'c', url: 'https://allegro.pl/oferta/c', price_pln: 25, shipping_pln: 0, free_delivery: true, seller_rating: 98 },
      { ...base, id: 'd', url: 'https://allegro.pl/oferta/d', price_pln: 22, shipping_pln: 9, seller_rating: 99 },
      { ...base, id: 'e', url: 'https://allegro.pl/oferta/e', price_pln: 10, shipping_pln: null, seller_rating: 99 },
      { ...base, id: 'f', url: 'https://allegro.pl/oferta/f', price_pln: 10, shipping_pln: 5, seller_rating: 90 },
      { ...base, id: 'g', url: 'https://allegro.pl/oferta/g', price_pln: 10, shipping_pln: 5, condition: 'used' as const, seller_rating: 99 },
      { ...base, id: 'h', url: 'https://allegro.pl/oferta/h', price_pln: 10, shipping_pln: 5, format: 'AUCTION' as const, seller_rating: 99 },
      { ...base, id: 'i', url: 'https://olx.pl/oferta/i', price_pln: 10, shipping_pln: 5, seller_rating: 99 },
      { ...base, id: 'j', url: 'https://allegro.pl/oferta/j', price_pln: 10, shipping_pln: 5, seller_rating: null },
    ];
    const r = filterAndRank(offers, opts);
    expect(r.accepted.map((o) => o.id)).toEqual(['b', 'c', 'a']);
    expect(r.accepted.map((o) => o.total_pln)).toEqual([25, 25, 29.99]);
    expect(r.accepted.map((o) => o.rank)).toEqual([1, 2, 3]);
    expect(Object.fromEntries(r.rejected.map((x) => [x.offer.id, x.reason]))).toEqual({
      d: 'over_purchase_limit',
      e: 'shipping_unknown',
      f: 'seller_rating_low',
      g: 'condition_used',
      h: 'format_auction',
      i: 'host_not_allowlisted',
      j: 'seller_rating_unknown',
    });
  });
  it('respects the remaining aggregate limit', () => {
    const o = { ...base, id: 'a', url: 'https://allegro.pl/oferta/a', price_pln: 20, shipping_pln: 0, free_delivery: true, seller_rating: 99 };
    expect(rejectReason(o, { perPurchaseLimitPln: 30, remainingPln: 19.99 })).toBe('over_remaining_aggregate');
    expect(rejectReason(o, { perPurchaseLimitPln: 30, remainingPln: 20 })).toBeNull();
  });
});
