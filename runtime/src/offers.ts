/**
 * Normalised offer record (flows/search.md, step 3) shared by the API channel, the SERP fallback
 * and the MCP-mode hand-off (.state/offers.json written by the session).
 */
export type OfferFormat = 'BUY_NOW' | 'AUCTION' | 'ADVERTISEMENT' | 'unknown';
export type OfferCondition = 'new' | 'used' | 'unknown';
export type OfferSource = 'api' | 'serp' | 'session';

export interface Offer {
  id: string;
  title: string;
  url: string;
  price_pln: number;
  /** Cheapest delivery in PLN; null when unknown; 0 when free (Smart / darmowa dostawa). */
  shipping_pln: number | null;
  smart: boolean;
  free_delivery: boolean;
  seller: string;
  /** Percent, e.g. 99.2; null when unknown. */
  seller_rating: number | null;
  super_seller: boolean;
  sales_count: number | null;
  condition: OfferCondition;
  format: OfferFormat;
  source: OfferSource;
  /** Delivery option names seen (e.g. "Paczkomat InPost"), when known. */
  delivery_options?: string[];
  /** 'offer' = /oferta/<id>; 'product' = /produkt/<uuid> card that groups several offers (default offer bought). */
  kind?: 'offer' | 'product';
  /** Price incl. the cheapest delivery as shown on the card ("<total> zł z dostawą"), when known. */
  total_with_delivery_pln?: number | null;
  sponsored?: boolean;
  seller_type?: 'firma' | 'osoba' | 'unknown';
  /** Basket mode: the wishlist label this offer was searched for (`asa search --need <label>`). */
  need?: string;
  /** Mandate category of the need (exact string from section 2), when known. */
  category?: string;
}

export function offerUrl(id: string): string {
  return `https://allegro.pl/oferta/${encodeURIComponent(id)}`;
}

export function parsePln(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const m = /(\d{1,3}(?:[  ]\d{3})*|\d+)(?:[.,](\d{1,2}))?/.exec(text.replace(/\s+/g, ' '));
  if (!m) return null;
  const whole = m[1].replace(/[  ]/g, '');
  const frac = m[2] ? m[2].padEnd(2, '0') : '00';
  return Number(`${whole}.${frac}`);
}

/** Map one item of GET /offers/listing (application/vnd.allegro.public.v1+json) to Offer. */
export function normalizeApiOffer(item: Record<string, unknown>): Offer {
  const sellingMode = (item.sellingMode ?? {}) as Record<string, unknown>;
  const price = (sellingMode.price ?? {}) as Record<string, unknown>;
  const delivery = (item.delivery ?? {}) as Record<string, unknown>;
  const lowest = (delivery.lowestPrice ?? {}) as Record<string, unknown>;
  const seller = (item.seller ?? {}) as Record<string, unknown>;
  const params = Array.isArray(item.parameters) ? (item.parameters as Record<string, unknown>[]) : [];
  const stan = params.find((p) => typeof p.name === 'string' && /^stan$/i.test(p.name));
  const stanValues = stan && Array.isArray(stan.values) ? (stan.values as unknown[]).map(String) : [];
  const condition: OfferCondition = stanValues.some((v) => /^now/i.test(v))
    ? 'new'
    : stanValues.some((v) => /u[żz]yw/i.test(v))
      ? 'used'
      : 'unknown';
  const formatRaw = String(sellingMode.format ?? 'unknown').toUpperCase();
  const format: OfferFormat = formatRaw === 'BUY_NOW' || formatRaw === 'AUCTION' || formatRaw === 'ADVERTISEMENT' ? formatRaw : 'unknown';
  const freeDelivery = delivery.availableForFree === true;
  const shipping = freeDelivery ? 0 : parsePln(lowest.amount as string | undefined);
  const id = String(item.id ?? '');
  return {
    id,
    title: String(item.name ?? ''),
    url: offerUrl(id),
    price_pln: parsePln(price.amount as string | undefined) ?? Number.NaN,
    shipping_pln: shipping,
    smart: freeDelivery,
    free_delivery: freeDelivery,
    seller: String(seller.login ?? seller.id ?? ''),
    seller_rating: null,
    super_seller: seller.superSeller === true,
    sales_count: null,
    condition,
    format,
    source: 'api',
  };
}

/** Validate an offer written by the session (MCP mode) into .state/offers.json. */
export function coerceOffer(raw: Record<string, unknown>, source: OfferSource = 'session'): Offer | null {
  const id = String(raw.id ?? '').trim();
  const url = String(raw.url ?? (id ? offerUrl(id) : '')).trim();
  const price = parsePln(raw.price_pln as string | number | undefined);
  if (!id || !url || price === null) return null;
  const shipping = raw.shipping_pln === null || raw.shipping_pln === undefined ? null : parsePln(raw.shipping_pln as string | number);
  const free = raw.free_delivery === true || raw.smart === true || shipping === 0;
  const cond = String(raw.condition ?? 'unknown').toLowerCase();
  const fmt = String(raw.format ?? 'BUY_NOW').toUpperCase();
  return {
    id,
    title: String(raw.title ?? ''),
    url,
    price_pln: price,
    shipping_pln: free ? 0 : shipping,
    smart: raw.smart === true,
    free_delivery: free,
    seller: String(raw.seller ?? ''),
    seller_rating: raw.seller_rating === null || raw.seller_rating === undefined ? null : Number(raw.seller_rating),
    super_seller: raw.super_seller === true,
    sales_count: raw.sales_count === null || raw.sales_count === undefined ? null : Number(raw.sales_count),
    condition: cond === 'new' || cond === 'used' ? cond : 'unknown',
    format: fmt === 'BUY_NOW' || fmt === 'AUCTION' || fmt === 'ADVERTISEMENT' ? fmt : 'unknown',
    source,
    delivery_options: Array.isArray(raw.delivery_options) ? (raw.delivery_options as unknown[]).map(String) : undefined,
    kind: raw.kind === 'product' ? 'product' : raw.kind === 'offer' ? 'offer' : undefined,
    total_with_delivery_pln:
      raw.total_with_delivery_pln === null || raw.total_with_delivery_pln === undefined
        ? undefined
        : parsePln(raw.total_with_delivery_pln as string | number),
    sponsored: raw.sponsored === true ? true : undefined,
    seller_type: raw.seller_type === 'firma' || raw.seller_type === 'osoba' ? raw.seller_type : undefined,
    need: typeof raw.need === 'string' && raw.need.trim() ? raw.need.trim() : undefined,
    category: typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : undefined,
  };
}
