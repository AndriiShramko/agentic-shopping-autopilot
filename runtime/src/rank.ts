/**
 * Mechanical filter + ranking against the mandate (operational spec, section 5).
 *   filter: price + delivery <= per-purchase limit (and <= remaining aggregate), item new,
 *           seller rating >= 98 % or Smart! / Super Seller, Buy-Now only, host allegro.pl
 *   sort:   total cost (price + cheapest delivery) ascending, Smart / Paczkomat preferred on ties
 * Whether an offer matches the item on Andrii's list is NOT decided here: the session decides
 * and writes its rationale into the audit log (offer_selected.data.rationale).
 */
import { hostAllowed } from './allowlist.js';
import type { Offer } from './offers.js';

export interface RankOptions {
  perPurchaseLimitPln: number;
  remainingPln: number;
  allowedHosts?: readonly string[];
  minSellerRating?: number;
}

export interface RankedOffer extends Offer {
  total_pln: number;
  rank: number;
}

export interface Rejected {
  offer: Offer;
  reason: string;
}

export interface RankResult {
  accepted: RankedOffer[];
  rejected: Rejected[];
}

export function totalPln(o: Offer): number | null {
  if (!Number.isFinite(o.price_pln)) return null;
  if (o.free_delivery || o.smart) return round2(o.price_pln);
  if (o.shipping_pln === null) return null;
  return round2(o.price_pln + o.shipping_pln);
}

export function rejectReason(o: Offer, opts: RankOptions): string | null {
  const hosts = opts.allowedHosts ?? ['allegro.pl', '*.allegro.pl'];
  let host = '';
  try {
    host = new URL(o.url).hostname;
  } catch {
    return 'bad_url';
  }
  if (!hostAllowed(host, hosts)) return 'host_not_allowlisted';
  if (o.format !== 'BUY_NOW') return `format_${o.format.toLowerCase()}`;
  if (o.condition === 'used') return 'condition_used';
  if (o.condition === 'unknown') return 'condition_unknown';
  const total = totalPln(o);
  if (total === null) return 'shipping_unknown';
  if (total > opts.perPurchaseLimitPln) return 'over_purchase_limit';
  if (total > opts.remainingPln) return 'over_remaining_aggregate';
  const minRating = opts.minSellerRating ?? 98;
  const sellerOk = o.smart || o.super_seller || (o.seller_rating !== null && o.seller_rating >= minRating);
  if (!sellerOk) return o.seller_rating === null ? 'seller_rating_unknown' : 'seller_rating_low';
  return null;
}

export function filterAndRank(offers: readonly Offer[], opts: RankOptions): RankResult {
  const accepted: RankedOffer[] = [];
  const rejected: Rejected[] = [];
  for (const o of offers) {
    const reason = rejectReason(o, opts);
    if (reason) rejected.push({ offer: o, reason });
    else accepted.push({ ...o, total_pln: totalPln(o) as number, rank: 0 });
  }
  accepted.sort((a, b) => {
    if (a.total_pln !== b.total_pln) return a.total_pln - b.total_pln;
    const pa = prefScore(a);
    const pb = prefScore(b);
    if (pa !== pb) return pb - pa;
    return a.id.localeCompare(b.id);
  });
  accepted.forEach((o, i) => (o.rank = i + 1));
  return { accepted, rejected };
}

function prefScore(o: Offer): number {
  let s = 0;
  if (o.smart) s += 2;
  if (o.delivery_options?.some((d) => /paczkomat/i.test(d))) s += 1;
  if (o.super_seller) s += 1;
  return s;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
