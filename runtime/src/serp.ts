/**
 * SERP fallback (channel B): the listing page in the dedicated, logged-in Chrome profile, read at
 * human pace, one page per query, only for this user's single purchase decision. Nothing is stored
 * beyond .state/offers.json and the audit line. A block page is a STOP.
 *
 * Card structure observed on 2026-09-04 in the maintainer's own profile (see
 * tests/fixtures/a11y/listing-card.yaml): `article` > link to /produkt/<slug>-<uuid> (product card that
 * groups offers), /oferta/<slug>-<id> (single offer) or /events/clicks?…redirect=<encoded /oferta/…>
 * (sponsored); heading = title; "<price> zł aktualna cena"; "<total> zł z dostawą"; "Firma" /
 * "Osoba prywatna"; "od Super Sprzedawcy"; "Allegro Smart!" (image alt "Smart!"); "dodaj do koszyka".
 * The listing URL carries the mechanical filters (Buy-Now only, condition new, price ceiling).
 */
import type { Page } from 'playwright';
import { urlAllowed } from './allowlist.js';
import { detectBlock } from './browser.js';
import { coerceOffer, type Offer } from './offers.js';
import { StopError } from './stop.js';

export interface SerpQuery {
  phrase: string;
  priceTo?: number;
  /** 'p' = price ascending (Allegro `order=p`) */
  order?: 'p' | 'd' | 'n';
  /** Condition filter; default 'nowe' (new) — the mandate allows new items only. */
  condition?: 'nowe' | 'uzywane';
}

export function listingUrl(q: SerpQuery): string {
  const u = new URL('https://allegro.pl/listing');
  u.searchParams.set('string', q.phrase);
  if (q.priceTo !== undefined) u.searchParams.set('price_to', String(q.priceTo));
  u.searchParams.set('order', q.order ?? 'p');
  u.searchParams.set('offerTypeBuyNow', '1');
  u.searchParams.set('stan', q.condition ?? 'nowe');
  return u.toString();
}

export interface RawCard {
  id: string;
  kind: 'offer' | 'product';
  url: string;
  title: string;
  price_pln: number | null;
  total_with_delivery_pln: number | null;
  shipping_pln: number | null;
  free_delivery: boolean;
  smart: boolean;
  super_seller: boolean;
  seller: string;
  seller_type: 'firma' | 'osoba' | 'unknown';
  seller_rating: number | null;
  sponsored: boolean;
  bought_recently: number | null;
  delivery_promise: string;
  delivery_options: string[];
}

/** Runs inside the page. Dependency-free; serialised by Playwright's page.evaluate. */
export function extractCardsInPage(): RawCard[] {
  const seen = new Set<string>();
  const out: RawCard[] = [];
  const parsePrice = (s: string | null | undefined): number | null => {
    if (!s) return null;
    const m = /(\d{1,3}(?:[  ]\d{3})*|\d+)[.,](\d{2})/.exec(s);
    if (!m) return null;
    return Number(m[1].replace(/[  ]/g, '') + '.' + m[2]);
  };
  const resolveOffer = (href: string): { id: string; kind: 'offer' | 'product'; url: string } | null => {
    let target = href;
    try {
      const u = new URL(href);
      if (u.pathname.startsWith('/events/clicks')) {
        const r = u.searchParams.get('redirect');
        if (r) target = r;
      }
    } catch {
      return null;
    }
    let path = '';
    try {
      path = new URL(target).pathname;
    } catch {
      return null;
    }
    const offer = /^\/oferta\/(?:.*-)?(\d{6,})$/.exec(path);
    if (offer) return { id: offer[1], kind: 'offer', url: `https://allegro.pl/oferta/${offer[1]}` };
    const product = /^\/produkt\/(?:.*-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(path);
    if (product) return { id: `product:${product[1].toLowerCase()}`, kind: 'product', url: `https://allegro.pl${path}` };
    return null;
  };
  const articles = Array.from(document.querySelectorAll('article'));
  for (const art of articles) {
    const link = art.querySelector<HTMLAnchorElement>('a[href*="/oferta/"], a[href*="/produkt/"], a[href*="/events/clicks"]');
    if (!link) continue;
    const ref = resolveOffer(link.href);
    if (!ref || seen.has(ref.id)) continue;
    seen.add(ref.id);
    const text = (art.innerText || '').replace(/\s+/g, ' ').trim();
    const heading = art.querySelector('h2, h3');
    const title = (heading ? heading.textContent || '' : link.textContent || '').replace(/\s+/g, ' ').trim();
    const priceM = /(\d[\d  ]*,\d{2})\s*zł\s*aktualna cena/i.exec(text) || /(\d[\d  ]*,\d{2})\s*zł(?!\s*z dostaw)/i.exec(text);
    const totalM = /(\d[\d  ]*,\d{2})\s*zł\s*z dostaw/i.exec(text);
    const price = parsePrice(priceM ? priceM[1] : null);
    const total = parsePrice(totalM ? totalM[1] : null);
    const freeText = /darmowa dostawa|dostawa gratis|bezpłatna dostawa/i.test(text);
    const imgAlts = Array.from(art.querySelectorAll('img')).map((i) => (i.getAttribute('alt') || '').trim());
    const smart = imgAlts.some((a) => /^smart!?$/i.test(a)) || /allegro smart!/i.test(text);
    const superSeller = /super sprzedaw/i.test(text) || imgAlts.some((a) => /super sprzedaw/i.test(a));
    const sellerType: RawCard['seller_type'] = /\bfirma\b/i.test(text) ? 'firma' : /osoba prywatna/i.test(text) ? 'osoba' : 'unknown';
    const sellerAlt = imgAlts.find((a) => a && a !== title && !/^smart!?$/i.test(a) && !/super sprzedaw|informacja/i.test(a) && !title.startsWith(a.slice(0, 20)));
    const boughtM = /(\d+)\s*os[oó]b[ay]?\s*kupi/i.exec(text);
    const promiseM = /dostawa (?:w |do )?[^–\-]{2,25}/i.exec(text);
    const shipping = total !== null && price !== null ? Math.round((total - price) * 100) / 100 : freeText ? 0 : null;
    const delivery: string[] = [];
    if (/paczkomat/i.test(text)) delivery.push('Paczkomat InPost');
    if (/kurier/i.test(text)) delivery.push('Kurier');
    out.push({
      id: ref.id,
      kind: ref.kind,
      url: ref.url,
      title,
      price_pln: price,
      total_with_delivery_pln: total,
      shipping_pln: shipping,
      free_delivery: freeText || shipping === 0,
      smart,
      super_seller: superSeller,
      seller: sellerAlt || '',
      seller_type: sellerType,
      seller_rating: null,
      sponsored: /sponsorowane|promowane/i.test(text),
      bought_recently: boughtM ? Number(boughtM[1]) : null,
      delivery_promise: promiseM ? promiseM[0].trim() : '',
      delivery_options: delivery,
    });
  }
  return out;
}

export function cardsToOffers(cards: RawCard[], conditionFromFilter: 'new' | 'unknown' = 'new'): Offer[] {
  const offers: Offer[] = [];
  for (const c of cards) {
    const o = coerceOffer({ ...c, condition: conditionFromFilter, format: 'BUY_NOW' } as unknown as Record<string, unknown>, 'serp');
    if (o) offers.push(o);
  }
  return offers;
}

export async function searchSerp(page: Page, q: SerpQuery): Promise<Offer[]> {
  const url = listingUrl(q);
  if (!urlAllowed(url)) throw new StopError('domain_not_allowlisted', { host: new URL(url).hostname });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(3000);
  const block = await detectBlock(page);
  if (block.blocked) throw new StopError('captcha_or_antibot', { marker: block.marker, where: 'serp' });
  const cards = await page.evaluate(extractCardsInPage);
  return cardsToOffers(cards, (q.condition ?? 'nowe') === 'nowe' ? 'new' : 'unknown');
}
