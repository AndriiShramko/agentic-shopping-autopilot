import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { filterAndRank } from '../src/rank.js';
import { cardsToOffers, extractCardsInPage, listingUrl } from '../src/serp.js';
import { fixtureUrl } from './helpers.js';

describe('SERP extractor on the synthetic listing fixture (offline)', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto(fixtureUrl('listing.html'));
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('extracts sponsored (/events/clicks redirect), product and offer cards, de-duplicated, header excluded', async () => {
    const cards = await page.evaluate(extractCardsInPage);
    expect(cards.map((c) => c.id)).toEqual(['18274795456', 'product:4ee1a3a1-ad1f-4edb-965a-78b98aa9b079', '12345678901']);
    const [sp, prod, offer] = cards;
    expect(sp).toMatchObject({
      kind: 'offer',
      url: 'https://allegro.pl/oferta/18274795456',
      title: 'WKRĘTY CIESIELSKIE DO DREWNA 4x40 STOŻKOWE TORX 500szt 40040 Pan Łącznik',
      price_pln: 19.87,
      total_with_delivery_pln: 30.36,
      shipping_pln: 10.49,
      smart: true,
      super_seller: true,
      seller: 'Pan_Lacznik',
      seller_type: 'firma',
      sponsored: true,
      bought_recently: 425,
    });
    expect(prod).toMatchObject({
      kind: 'product',
      url: 'https://allegro.pl/produkt/wkrety-do-drewna-4-x-40-mm-10-szt-4ee1a3a1-ad1f-4edb-965a-78b98aa9b079',
      price_pln: 1,
      total_with_delivery_pln: 11.49,
      shipping_pln: 10.49,
      smart: true,
      super_seller: true,
      sponsored: false,
      bought_recently: 10,
    });
    expect(offer).toMatchObject({ kind: 'offer', price_pln: 9.99, total_with_delivery_pln: null, shipping_pln: 0, free_delivery: true, smart: false, super_seller: false, seller_type: 'osoba' });
    expect(JSON.stringify(cards)).not.toContain('Andrii');
  });

  it('maps cards to offers (condition from the listing filter) and ranks them by the "z dostawą" ceiling', async () => {
    const cards = await page.evaluate(extractCardsInPage);
    const offers = cardsToOffers(cards, 'new');
    expect(offers.every((o) => o.condition === 'new' && o.format === 'BUY_NOW' && o.source === 'serp')).toBe(true);
    const r = filterAndRank(offers, { perPurchaseLimitPln: 30, remainingPln: 300 });
    // 9.99 free delivery but unverified private seller -> rejected; product 11.49 (Smart) first; sponsored 30.36 over the limit
    expect(r.accepted.map((o) => [o.id, o.total_pln])).toEqual([['product:4ee1a3a1-ad1f-4edb-965a-78b98aa9b079', 11.49]]);
    expect(Object.fromEntries(r.rejected.map((x) => [x.offer.id, x.reason]))).toEqual({ '18274795456': 'over_purchase_limit', '12345678901': 'seller_rating_unknown' });
  });

  it('builds the listing URL with buy-now, new-condition and price ceiling filters', () => {
    const u = new URL(listingUrl({ phrase: 'wkręty do drewna 4x40', priceTo: 30 }));
    expect(u.hostname).toBe('allegro.pl');
    expect(u.pathname).toBe('/listing');
    expect(u.searchParams.get('string')).toBe('wkręty do drewna 4x40');
    expect(u.searchParams.get('price_to')).toBe('30');
    expect(u.searchParams.get('order')).toBe('p');
    expect(u.searchParams.get('offerTypeBuyNow')).toBe('1');
    expect(u.searchParams.get('stan')).toBe('nowe');
  });
});
