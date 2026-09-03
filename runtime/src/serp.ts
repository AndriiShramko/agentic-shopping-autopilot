/**
 * SERP fallback (channel B): the listing page in the dedicated, logged-in Chrome profile, read at
 * human pace, one page per query, only for this user's single purchase decision. Nothing is stored
 * beyond .state/offers.json and the audit line. A block page is a STOP.
 *
 * Extraction is heuristic on purpose (offer cards = elements containing a link to /oferta/ and a
 * price in zł) until the first recorded flow fills `listing_item` / `price_on_card` in selectors.yaml.
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
}

export function listingUrl(q: SerpQuery): string {
  const u = new URL('https://allegro.pl/listing');
  u.searchParams.set('string', q.phrase);
  if (q.priceTo !== undefined) u.searchParams.set('price_to', String(q.priceTo));
  u.searchParams.set('order', q.order ?? 'p');
  u.searchParams.set('offerTypeBuyNow', '1');
  return u.toString();
}

export interface RawCard {
  id: string;
  url: string;
  title: string;
  price_pln: number | null;
  shipping_pln: number | null;
  free_delivery: boolean;
  smart: boolean;
  seller: string;
  seller_rating: number | null;
  condition: string;
  format: string;
  delivery_options: string[];
}

/** Runs inside the page. Keep it dependency-free; it is serialised by Playwright. */
function extractCardsInPage(): RawCard[] {
  const seen = new Set<string>();
  const out: RawCard[] = [];
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/oferta/"]'));
  const parsePrice = (s: string): number | null => {
    const m = /(\d{1,3}(?:[  ]\d{3})*|\d+)(?:[.,](\d{1,2}))?\s*z[łl]/i.exec(s);
    if (!m) return null;
    return Number(m[1].replace(/[  ]/g, '') + '.' + (m[2] ? m[2].padEnd(2, '0') : '00'));
  };
  for (const a of links) {
    const href = a.href.split('?')[0];
    const idMatch = /\/oferta\/(?:[^/]*-)?(\d{6,})/.exec(href);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (seen.has(id)) continue;
    let card: HTMLElement | null = a;
    for (let i = 0; i < 8 && card; i++) {
      const t = (card.innerText || '').trim();
      if (/z[łl]/i.test(t) && t.length > 20) break;
      card = card.parentElement;
    }
    if (!card) continue;
    const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
    if (!/z[łl]/i.test(text)) continue;
    seen.add(id);
    const title = (a.innerText || a.getAttribute('title') || '').trim();
    const price = parsePrice(text);
    const free = /darmowa dostawa|dostawa gratis|smart!/i.test(text);
    const smart = /smart!/i.test(text);
    const shipMatch = /(?:\+|dostawa)\s*(\d+(?:[.,]\d{1,2})?)\s*z[łl]/i.exec(text);
    const shipping = free ? 0 : shipMatch ? Number(shipMatch[1].replace(',', '.')) : null;
    const sellerMatch = /od\s+(?:firmy|osoby prywatnej|sprzedawcy)?\s*([^\s|]{3,40})/i.exec(text);
    const ratingMatch = /(\d{2,3}(?:[.,]\d)?)\s*%\s*(?:poleca|pozytywnych)?/i.exec(text);
    const condition = /\bstan:?\s*nowy\b/i.test(text) ? 'new' : /\bstan:?\s*u[żz]ywan/i.test(text) ? 'used' : 'unknown';
    const format = /licytacja|aukcja/i.test(text) ? 'AUCTION' : 'BUY_NOW';
    const delivery: string[] = [];
    if (/paczkomat/i.test(text)) delivery.push('Paczkomat InPost');
    if (/kurier/i.test(text)) delivery.push('Kurier');
    out.push({
      id,
      url: `https://allegro.pl/oferta/${id}`,
      title,
      price_pln: price,
      shipping_pln: shipping,
      free_delivery: free,
      smart,
      seller: sellerMatch ? sellerMatch[1] : '',
      seller_rating: ratingMatch ? Number(ratingMatch[1].replace(',', '.')) : null,
      condition,
      format,
      delivery_options: delivery,
    });
  }
  return out;
}

export async function searchSerp(page: Page, q: SerpQuery): Promise<Offer[]> {
  const url = listingUrl(q);
  if (!urlAllowed(url)) throw new StopError('domain_not_allowlisted', { host: new URL(url).hostname });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2500);
  const block = await detectBlock(page);
  if (block.blocked) throw new StopError('captcha_or_antibot', { marker: block.marker, where: 'serp' });
  const cards = await page.evaluate(extractCardsInPage);
  const offers: Offer[] = [];
  for (const c of cards) {
    const o = coerceOffer(c as unknown as Record<string, unknown>, 'serp');
    if (o) offers.push(o);
  }
  return offers;
}
