/**
 * Smart! basket planner — pure functions, no I/O (design synthesis 2026-09-04, section 1).
 *
 * Allegro Smart! facts (regulations of 2026-03-02, verified 2026-09-04):
 *   - delivery is free when the sum of item prices from ONE seller in ONE order is >= 49.90 PLN
 *     (grandfathered subscriptions: 45 PLN lockers/points, 65 PLN courier) — per seller, never per basket;
 *   - the offer AND the chosen delivery method must be Smart!-marked;
 *   - the "z dostawą" figure on a listing card is price + the seller's cheapest delivery WITHOUT Smart!.
 * Two 30 PLN items at two sellers pay delivery twice; two 25 PLN items at one seller ship free.
 *
 * Per seller: coverage of needs, subtotal, smart_all, free = smart_all && subtotal >= threshold,
 * expected = subtotal + (free ? 0 : cheapest delivery), ceiling = subtotal + Σ cheapest delivery per line,
 * delta = max(0, threshold - subtotal). The plan with the lowest expected total that covers every need wins;
 * ties: one seller > split, then bought before, then Smart!, then seller type "firma", then rating.
 * A plan that breaks the per-item / per-order / lines-per-order limits is returned with needs_override
 * and the offending numbers — never trimmed silently.
 */
import { getLang, money, t, type Lang } from './i18n.js';
import type { Offer } from './offers.js';

/** Cheapest Smart!-marked method (InPost Paczkomat cap) assumed when a card gives no delivery figure. */
export const DEFAULT_SMART_DELIVERY_PLN = 10.95;

export interface Need {
  label: string;
  category?: string;
  priority?: number;
  qty?: number;
  max_item_pln?: number;
  /** Vault note the need came from, shown as "[нужно: …]". */
  source?: string;
}

export type BasketOffer = Offer & { total_pln?: number; rank?: number };

export interface PlanLine {
  /** 1-based position in the proposal message. */
  n: number;
  need: string;
  id: string;
  offer_id?: string;
  url: string;
  title: string;
  seller: string;
  price_pln: number;
  /** Cheapest delivery for this line without Smart! (what the ceiling protects against). */
  delivery_pln: number;
  smart: boolean;
  category?: string;
  bought_before: boolean;
  complement?: boolean;
  tier?: ComplementTier;
}

export interface SellerOrder {
  seller: string;
  seller_type?: 'firma' | 'osoba' | 'unknown';
  seller_rating: number | null;
  super_seller: boolean;
  lines: PlanLine[];
  needs: string[];
  subtotal_pln: number;
  smart_all: boolean;
  free_delivery: boolean;
  /** One parcel from this seller: the dearest of the lines' cheapest rates. */
  cheapest_delivery_pln: number;
  expected_pln: number;
  ceiling_pln: number;
  delta_pln: number;
  bought_before: boolean;
}

export type LimitId = 'per_item' | 'per_order' | 'max_items' | 'aggregate';

export interface LimitCheck {
  id: LimitId;
  ok: boolean;
  value: number;
  limit: number;
  line?: number;
  seller?: string;
}

export interface BasketPlan {
  threshold_pln: number;
  needs: string[];
  covered: string[];
  uncovered: string[];
  orders: SellerOrder[];
  subtotal_pln: number;
  expected_pln: number;
  ceiling_pln: number;
  limits: LimitCheck[];
  /** Per-item / per-order / lines limits broken: only «ок <сумма>» (or a dropped line) can approve it. */
  needs_override: boolean;
  /** The remaining aggregate limit cannot be overridden at all. */
  aggregate_exceeded: boolean;
  plans_considered: number;
}

export type BoughtBefore = boolean | { date?: string };

export interface PlanOptions {
  threshold: number;
  perItemLimit?: number;
  perOrderLimit?: number;
  maxItems?: number;
  remainingAggregate?: number;
  boughtBeforeFn?: (o: Offer) => BoughtBefore;
  avoidSellers?: readonly string[];
  /** Candidate sellers per need in the split enumeration (default 8; sellers covering >= 2 needs are always kept). */
  maxSellersPerNeed?: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function norm(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/** Offers without a seller login can never be combined: each gets its own key. */
export function sellerKey(o: Offer): string {
  return norm(o.seller) || `?:${o.id}`;
}

export function groupBySeller<T extends Offer>(offers: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const o of offers) {
    const k = sellerKey(o);
    const list = out.get(k);
    if (list) list.push(o);
    else out.set(k, [o]);
  }
  return out;
}

/**
 * Cheapest delivery for one line when Smart! does not apply. The card's "z dostawą" figure is
 * price + cheapest delivery without Smart!; a Smart! offer with no figure is assumed to ship at the
 * InPost cap (never at 0 — that is exactly the mistake the threshold rule guards against).
 */
export function lineDeliveryPln(o: Offer): number {
  const p = o.price_pln;
  if (typeof o.total_with_delivery_pln === 'number' && Number.isFinite(o.total_with_delivery_pln) && o.total_with_delivery_pln >= p) {
    return round2(o.total_with_delivery_pln - p);
  }
  if (typeof o.shipping_pln === 'number' && Number.isFinite(o.shipping_pln) && o.shipping_pln > 0) return round2(o.shipping_pln);
  if (o.free_delivery && !o.smart) return 0;
  return DEFAULT_SMART_DELIVERY_PLN;
}

function betterOffer(a: Offer, b: Offer): boolean {
  if (a.price_pln !== b.price_pln) return a.price_pln < b.price_pln;
  if (a.smart !== b.smart) return a.smart;
  const ra = a.seller_rating ?? -1;
  const rb = b.seller_rating ?? -1;
  if (ra !== rb) return ra > rb;
  return a.id < b.id;
}

function toLine(need: string, o: BasketOffer, n: number, bb?: (o: Offer) => BoughtBefore): PlanLine {
  const line: PlanLine = {
    n,
    need,
    id: o.id,
    url: o.url,
    title: o.title,
    seller: o.seller,
    price_pln: round2(o.price_pln),
    delivery_pln: lineDeliveryPln(o),
    smart: o.smart,
    bought_before: !!(bb ? bb(o) : false),
  };
  if (o.category) line.category = o.category;
  const numeric = /(\d{6,})$/.exec(o.id);
  if (numeric && o.kind !== 'product') line.offer_id = numeric[1];
  return line;
}

export function buildOrder(picks: readonly { need: string; offer: BasketOffer }[], threshold: number, bb?: (o: Offer) => BoughtBefore, firstN = 1): SellerOrder {
  const lines = picks.map((p, i) => toLine(p.need, p.offer, firstN + i, bb));
  return recomputeOrder({ seller: picks[0]?.offer.seller ?? '', seller_type: picks[0]?.offer.seller_type, seller_rating: picks[0]?.offer.seller_rating ?? null, super_seller: picks[0]?.offer.super_seller ?? false, lines }, threshold);
}

/** Recompute every derived figure of an order from its lines (used after a reply changes the lines). */
export function recomputeOrder(base: Pick<SellerOrder, 'seller' | 'seller_type' | 'seller_rating' | 'super_seller' | 'lines'>, threshold: number): SellerOrder {
  const lines = base.lines.map((l, i) => ({ ...l, n: i + 1 }));
  const subtotal = round2(lines.reduce((s, l) => s + l.price_pln, 0));
  const smartAll = lines.length > 0 && lines.every((l) => l.smart);
  const deliveries = lines.map((l) => l.delivery_pln);
  const cheapest = deliveries.length ? round2(Math.max(...deliveries)) : 0;
  const free = smartAll && subtotal + 0.001 >= threshold;
  return {
    seller: base.seller,
    seller_type: base.seller_type,
    seller_rating: base.seller_rating,
    super_seller: base.super_seller,
    lines,
    needs: Array.from(new Set(lines.filter((l) => !l.complement).map((l) => l.need))),
    subtotal_pln: subtotal,
    smart_all: smartAll,
    free_delivery: free,
    cheapest_delivery_pln: cheapest,
    expected_pln: round2(subtotal + (free ? 0 : cheapest)),
    ceiling_pln: round2(subtotal + deliveries.reduce((s, d) => s + d, 0)),
    delta_pln: round2(Math.max(0, threshold - subtotal)),
    bought_before: lines.some((l) => l.bought_before),
  };
}

export function checkLimits(orders: readonly SellerOrder[], opts: Pick<PlanOptions, 'perItemLimit' | 'perOrderLimit' | 'maxItems' | 'remainingAggregate'>): LimitCheck[] {
  const out: LimitCheck[] = [];
  if (opts.perItemLimit !== undefined) {
    let worst: PlanLine | undefined;
    for (const o of orders) for (const l of o.lines) if (!worst || l.price_pln > worst.price_pln) worst = l;
    if (worst) out.push({ id: 'per_item', ok: worst.price_pln <= opts.perItemLimit + 0.001, value: worst.price_pln, limit: opts.perItemLimit, line: worst.n, seller: worst.seller });
  }
  if (opts.perOrderLimit !== undefined && orders.length) {
    const worst = orders.reduce((a, b) => (b.expected_pln > a.expected_pln ? b : a));
    out.push({ id: 'per_order', ok: worst.expected_pln <= opts.perOrderLimit + 0.001, value: worst.expected_pln, limit: opts.perOrderLimit, seller: worst.seller });
  }
  if (opts.maxItems !== undefined && orders.length) {
    const worst = orders.reduce((a, b) => (b.lines.length > a.lines.length ? b : a));
    out.push({ id: 'max_items', ok: worst.lines.length <= opts.maxItems, value: worst.lines.length, limit: opts.maxItems, seller: worst.seller });
  }
  if (opts.remainingAggregate !== undefined && orders.length) {
    const total = round2(orders.reduce((s, o) => s + o.expected_pln, 0));
    out.push({ id: 'aggregate', ok: total <= opts.remainingAggregate + 0.001, value: total, limit: opts.remainingAggregate });
  }
  return out;
}

interface Candidate {
  orders: SellerOrder[];
  expected: number;
}

function betterPlan(a: Candidate, b: Candidate): boolean {
  if (Math.abs(a.expected - b.expected) > 0.005) return a.expected < b.expected;
  if (a.orders.length !== b.orders.length) return a.orders.length < b.orders.length;
  const bb = (c: Candidate) => c.orders.reduce((s, o) => s + o.lines.filter((l) => l.bought_before).length, 0);
  if (bb(a) !== bb(b)) return bb(a) > bb(b);
  const smart = (c: Candidate) => c.orders.filter((o) => o.smart_all).length;
  if (smart(a) !== smart(b)) return smart(a) > smart(b);
  const firma = (c: Candidate) => c.orders.filter((o) => o.seller_type === 'firma').length;
  if (firma(a) !== firma(b)) return firma(a) > firma(b);
  const rating = (c: Candidate) => c.orders.reduce((s, o) => s + (o.seller_rating ?? 0), 0) / c.orders.length;
  if (rating(a) !== rating(b)) return rating(a) > rating(b);
  return a.orders.map((o) => o.seller).join('|') < b.orders.map((o) => o.seller).join('|');
}

export function planBaskets(needs: readonly Need[], offers: readonly BasketOffer[], opts: PlanOptions): BasketPlan {
  const labels = needs.map((n) => n.label);
  const avoid = new Set((opts.avoidSellers ?? []).map(norm).filter(Boolean));
  const usable = offers.filter((o) => Number.isFinite(o.price_pln) && !avoid.has(norm(o.seller)));
  const single = needs.length === 1;
  const perNeed = new Map<string, BasketOffer[]>();
  for (const n of needs) perNeed.set(n.label, usable.filter((o) => o.need === n.label || (o.need === undefined && single)));

  // best offer per (seller, need)
  const bySeller = new Map<string, Map<string, BasketOffer>>();
  for (const [label, list] of perNeed) {
    for (const o of list) {
      const k = sellerKey(o);
      let m = bySeller.get(k);
      if (!m) bySeller.set(k, (m = new Map()));
      const cur = m.get(label);
      if (!cur || betterOffer(o, cur)) m.set(label, o);
    }
  }
  const covered = labels.filter((l) => (perNeed.get(l) ?? []).length > 0);
  const uncovered = labels.filter((l) => !covered.includes(l));
  const empty: BasketPlan = { threshold_pln: opts.threshold, needs: labels, covered, uncovered, orders: [], subtotal_pln: 0, expected_pln: 0, ceiling_pln: 0, limits: [], needs_override: false, aggregate_exceeded: false, plans_considered: 0 };
  if (covered.length === 0) return empty;

  // candidate sellers per need: the K cheapest plus every seller that covers two or more needs
  const K = Math.max(1, opts.maxSellersPerNeed ?? 8);
  const multi = new Set(Array.from(bySeller).filter(([, m]) => m.size >= 2).map(([k]) => k));
  const choices = covered.map((label) => {
    const sellers = Array.from(bySeller)
      .filter(([, m]) => m.has(label))
      .sort((a, b) => (betterOffer(a[1].get(label) as BasketOffer, b[1].get(label) as BasketOffer) ? -1 : 1))
      .map(([k]) => k);
    const top = sellers.slice(0, K);
    for (const k of sellers) if (multi.has(k) && !top.includes(k)) top.push(k);
    return top;
  });

  let best: Candidate | undefined;
  let considered = 0;
  const assign: string[] = new Array(covered.length);
  const evaluate = () => {
    considered++;
    const groups = new Map<string, { need: string; offer: BasketOffer }[]>();
    covered.forEach((label, i) => {
      const k = assign[i];
      const offer = bySeller.get(k)?.get(label) as BasketOffer;
      const g = groups.get(k);
      if (g) g.push({ need: label, offer });
      else groups.set(k, [{ need: label, offer }]);
    });
    const orders = Array.from(groups.values()).map((picks) => buildOrder(picks, opts.threshold, opts.boughtBeforeFn));
    orders.sort((a, b) => b.subtotal_pln - a.subtotal_pln);
    const cand: Candidate = { orders, expected: round2(orders.reduce((s, o) => s + o.expected_pln, 0)) };
    if (!best || betterPlan(cand, best)) best = cand;
  };
  const rec = (i: number) => {
    if (i === covered.length) {
      evaluate();
      return;
    }
    for (const k of choices[i]) {
      assign[i] = k;
      rec(i + 1);
    }
  };
  rec(0);
  const chosen = best as Candidate;
  // renumber lines across orders so the message can refer to them by one number
  let n = 1;
  for (const o of chosen.orders) for (const l of o.lines) l.n = n++;
  return finishPlan(chosen.orders, labels, covered, uncovered, opts, considered);
}

function finishPlan(orders: SellerOrder[], labels: string[], covered: string[], uncovered: string[], opts: PlanOptions, considered: number): BasketPlan {
  const limits = checkLimits(orders, opts);
  return {
    threshold_pln: opts.threshold,
    needs: labels,
    covered,
    uncovered,
    orders,
    subtotal_pln: round2(orders.reduce((s, o) => s + o.subtotal_pln, 0)),
    expected_pln: round2(orders.reduce((s, o) => s + o.expected_pln, 0)),
    ceiling_pln: round2(orders.reduce((s, o) => s + o.ceiling_pln, 0)),
    limits,
    needs_override: limits.some((l) => !l.ok && l.id !== 'aggregate'),
    aggregate_exceeded: limits.some((l) => !l.ok && l.id === 'aggregate'),
    plans_considered: considered,
  };
}

// ---------------------------------------------------------------------------------------------
// Complements (gap-fillers)

export type ComplementTier = 1 | 2 | 3;

export interface ComplementOptions {
  threshold: number;
  /** delta <= price <= delta + slack */
  slack: number;
  perItemLimit?: number;
  perOrderLimit?: number;
  maxItems?: number;
  /** Mandate categories (section 2). A candidate outside them is never shown. */
  categories?: readonly string[];
  /** Category of the primary need (tier 3 = same category). */
  primaryCategory?: string;
  /** Tier 1: bought before from this seller. */
  boughtBeforeFn?: (o: Offer) => BoughtBefore;
  /** Tier 2: a lower-priority wishlist line. */
  wishlistFn?: (o: Offer) => boolean;
  isBlockedFn?: (o: Offer) => boolean;
  /** Bought within the reorder cooldown (consumables excepted by the caller or by consumableFn). */
  recentlyBoughtFn?: (o: Offer) => boolean;
  consumableFn?: (o: Offer) => boolean;
  /** Default 3. */
  maxShow?: number;
}

export interface Complement {
  n: number;
  tier: ComplementTier;
  score: number;
  offer: BasketOffer;
  price_pln: number;
  reason: string;
  bought_before: boolean;
  wishlist: boolean;
  same_category: boolean;
  new_subtotal_pln: number;
}

export type ComplementSkipReason = 'already_free' | 'not_smart_order' | 'delta_over_slack' | 'no_order' | 'no_candidates';

export interface ComplementProposal {
  applicable: boolean;
  reason?: ComplementSkipReason;
  order_index: number;
  delta_pln: number;
  window: [number, number];
  shown: Complement[];
  considered: number;
  skipped: Record<string, number>;
}

function dateOf(bb: BoughtBefore): string | undefined {
  return typeof bb === 'object' && bb.date ? bb.date : undefined;
}

/** "2026-08-05" → "05.08" (day.month, the form the proposal uses in every language). */
export function fmtDate(iso: string | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}` : '';
}

/** Complements are proposed for the primary (first) seller order only. */
export function proposeComplements(plan: BasketPlan, candidates: readonly BasketOffer[], opts: ComplementOptions): ComplementProposal {
  const order = plan.orders[0];
  const base: ComplementProposal = { applicable: false, order_index: 0, delta_pln: order?.delta_pln ?? 0, window: [0, 0], shown: [], considered: 0, skipped: {} };
  if (!order) return { ...base, reason: 'no_order' };
  const delta = order.delta_pln;
  base.window = [delta, round2(delta + opts.slack)];
  if (order.free_delivery || delta <= 0) return { ...base, reason: 'already_free' };
  if (!order.smart_all) return { ...base, reason: 'not_smart_order' };
  if (delta > opts.slack + 0.001) return { ...base, reason: 'delta_over_slack' };

  const skip = (why: string) => {
    base.skipped[why] = (base.skipped[why] ?? 0) + 1;
  };
  const allowed = opts.categories ? new Set(opts.categories.map(norm)) : undefined;
  const inPlan = new Set(order.lines.map((l) => l.id));
  const sellerK = sellerKey({ seller: order.seller, id: '' } as Offer);
  const found: Complement[] = [];
  for (const c of candidates) {
    base.considered++;
    if (inPlan.has(c.id)) {
      skip('already_in_plan');
      continue;
    }
    if (sellerKey(c) !== sellerK) {
      skip('other_seller');
      continue;
    }
    if (!Number.isFinite(c.price_pln)) {
      skip('price_unknown');
      continue;
    }
    if (!c.smart) {
      skip('not_smart');
      continue;
    }
    if (c.price_pln < delta - 0.001 || c.price_pln > delta + opts.slack + 0.001) {
      skip('outside_window');
      continue;
    }
    if (opts.perItemLimit !== undefined && c.price_pln > opts.perItemLimit + 0.001) {
      skip('over_item_limit');
      continue;
    }
    if (opts.perOrderLimit !== undefined && order.subtotal_pln + c.price_pln > opts.perOrderLimit + 0.001) {
      skip('over_order_limit');
      continue;
    }
    if (opts.maxItems !== undefined && order.lines.length + 1 > opts.maxItems) {
      skip('over_max_items');
      continue;
    }
    if (allowed && (!c.category || !allowed.has(norm(c.category)))) {
      skip('outside_mandate_categories');
      continue;
    }
    if (opts.isBlockedFn?.(c)) {
      skip('blocked');
      continue;
    }
    const consumable = opts.consumableFn?.(c) ?? false;
    if (!consumable && opts.recentlyBoughtFn?.(c)) {
      skip('cooldown');
      continue;
    }
    const bb = opts.boughtBeforeFn?.(c) ?? false;
    const boughtBefore = !!bb;
    const wishlist = opts.wishlistFn?.(c) ?? false;
    const sameCategory = !!opts.primaryCategory && !!c.category && norm(c.category) === norm(opts.primaryCategory);
    let tier: ComplementTier | undefined = boughtBefore ? 1 : wishlist ? 2 : sameCategory ? 3 : undefined;
    if (tier === undefined) {
      skip('no_tier');
      continue;
    }
    if (tier === 3) {
      // a same-category filler only pays off when it costs no more than the gap plus the delivery it saves
      if (c.price_pln > delta + order.cheapest_delivery_pln + 0.001) {
        skip('tier3_over_gap_plus_delivery');
        continue;
      }
      if (c.sales_count !== null && c.sales_count !== undefined && c.sales_count < 50) {
        skip('tier3_few_sales');
        continue;
      }
      tier = 3;
    }
    const score = 3 * Number(boughtBefore) + 2 * Number(wishlist) + Number(sameCategory);
    const date = fmtDate(dateOf(bb));
    const reason = boughtBefore ? t('reason.bought_before', { date: date ? t('reason.bought_on', { date }) : '' }) : wishlist ? t('reason.wishlist') : t('reason.same_category');
    found.push({ n: 0, tier, score, offer: c, price_pln: round2(c.price_pln), reason, bought_before: boughtBefore, wishlist, same_category: sameCategory, new_subtotal_pln: round2(order.subtotal_pln + c.price_pln) });
  }
  found.sort((a, b) => b.score - a.score || a.price_pln - b.price_pln || a.offer.id.localeCompare(b.offer.id));
  const maxShow = opts.maxShow ?? 3;
  const lastN = plan.orders.reduce((m, o) => Math.max(m, ...o.lines.map((l) => l.n)), 0);
  const shown = found.slice(0, maxShow).map((c, i) => ({ ...c, n: lastN + 1 + i }));
  return { ...base, applicable: true, reason: shown.length ? undefined : 'no_candidates', shown };
}

// ---------------------------------------------------------------------------------------------
// The one-message proposal (English by default, Russian with ASA_LANG=ru — src/i18n.ts)

/** Money with the decimal separator of the configured language ("12.50" / "12,50"). */
export function pln(n: number, lang?: Lang): string {
  return money(n, lang);
}

function fmtLimit(n: number, lang?: Lang): string {
  return Number.isInteger(n) ? String(n) : pln(n, lang);
}

/** A permanent limit worth suggesting instead of repeated one-time approvals. */
export function suggestLimit(value: number, limit: number): number {
  return Math.max(Math.ceil(value / 10) * 10, limit * 2);
}

export function railLabel(rail: 'oneclick_card' | 'allegro_pay', lang?: Lang): string {
  return t(rail === 'allegro_pay' ? 'rail.allegro_pay' : 'rail.oneclick_card', undefined, lang);
}

export interface FormatOptions {
  runId: string;
  remainingPln?: number;
  limits?: { perItem?: number; perOrder?: number; maxItems?: number };
  rail?: 'oneclick_card' | 'allegro_pay';
  /** Default "Paczkomat InPost". */
  deliveryMethod?: string;
  /** ISO dates of earlier purchases from the primary seller, newest first. */
  purchaseDates?: readonly string[];
  /** "Facts from your notes" — confirmed by the context brief (facts_confirmed). */
  facts?: readonly string[];
  /** "Assumptions from your notes" — attributes filled in from the stores, not asked. */
  assumptions?: readonly string[];
  /** need label -> source note ("[[…]]") for "[need: …]". */
  needSources?: Readonly<Record<string, string>>;
  /** Tail lines: "not derived: X — …" (open questions of the brief) and --not-taken lines. */
  notTaken?: readonly string[];
  /** How many complements may be added (MAX_COMPLEMENTS); shown ones beyond this are alternatives. */
  maxComplements?: number;
  /** Reason given with --no-context: the header gets a warning line, the proposal says so. */
  contextSkipped?: string;
  /** Override the configured language for this message. */
  lang?: Lang;
}

export function formatPlan(plan: BasketPlan, proposal: ComplementProposal, opts: FormatOptions): string {
  const L = opts.lang ?? getLang();
  const tr = (key: string, params?: Record<string, string | number>) => t(key, params, L);
  const m = (n: number) => pln(n, L);
  const out: string[] = [];
  const primary = plan.orders[0];
  const delivery = opts.deliveryMethod ?? 'Paczkomat InPost';
  const rail = railLabel(opts.rail ?? 'oneclick_card', L);
  if (!primary) {
    out.push(tr('plan.no_offer', { runId: opts.runId, needs: plan.needs.join(', ') || '—' }));
    if (opts.contextSkipped) out.push(tr('plan.context_skipped', { reason: opts.contextSkipped }));
    if (opts.facts && opts.facts.length) out.push(tr('plan.facts', { list: opts.facts.join(', ') }));
    out.push(tr('plan.no_offer_reply'));
    for (const x of opts.notTaken ?? []) out.push(x);
    return out.join('\n');
  }
  // the two most recent purchases from this seller, oldest first ("bought 21.07 and 05.08")
  const dates = Array.from(opts.purchaseDates ?? [])
    .filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d))
    .sort()
    .slice(-2)
    .map(fmtDate);
  const smart = (all: boolean) => tr(all ? 'plan.smart' : 'plan.no_smart');
  const sellerNote = `${smart(primary.smart_all)}, ${dates.length ? tr('plan.bought_dates', { dates: dates.join(tr('plan.and')) }) : tr('plan.new_seller')}`;
  out.push(tr('plan.header', { runId: opts.runId, seller: primary.seller || tr('plan.seller_unknown'), sellerNote, delivery, rail }));
  if (opts.contextSkipped) out.push(tr('plan.context_skipped', { reason: opts.contextSkipped }));

  const source = (need: string) => opts.needSources?.[need] ?? need;
  const lineText = (l: PlanLine) => tr('plan.line', { n: l.n, title: l.title, price: m(l.price_pln), source: source(l.need) });
  for (const l of primary.lines) out.push(lineText(l));
  plan.orders.slice(1).forEach((o, i) => {
    out.push(tr('plan.other_order', { n: i + 2, seller: o.seller, smart: smart(o.smart_all) }));
    for (const l of o.lines) out.push(lineText(l));
  });

  const T = plan.threshold_pln;
  if (primary.free_delivery) out.push(tr('plan.free', { subtotal: m(primary.subtotal_pln), threshold: m(T) }));
  else if (primary.smart_all) out.push(tr('plan.gap', { subtotal: m(primary.subtotal_pln), threshold: m(T), delta: m(primary.delta_pln) }));
  else out.push(tr('plan.not_all_smart', { subtotal: m(primary.subtotal_pln), delivery: m(primary.cheapest_delivery_pln) }));

  const [main, ...alts] = proposal.shown;
  if (main) {
    out.push(tr('plan.complement', { n: main.n, title: main.offer.title, price: m(main.price_pln), reason: main.reason, tier: main.tier }));
    out.push(tr('plan.ab', { n: main.n, newSubtotal: m(main.new_subtotal_pln), subtotal: m(primary.subtotal_pln), delivery: m(primary.cheapest_delivery_pln), expected: m(primary.expected_pln) }));
    if (alts.length) out.push(tr('plan.alts', { n: main.n, alts: alts.map((a) => tr('plan.alt', { n: a.n, title: a.offer.title, price: m(a.price_pln), tier: a.tier })).join(' · ') }));
  } else if (primary.free_delivery) {
    out.push(tr('plan.free_a', { subtotal: m(primary.subtotal_pln) }));
  } else {
    const why = proposal.reason === 'delta_over_slack' ? tr('plan.why_over_slack', { amount: m(proposal.window[1] - proposal.delta_pln) }) : proposal.reason === 'not_smart_order' ? tr('plan.why_not_smart') : tr('plan.why_none');
    out.push(tr('plan.a_no_complement', { subtotal: m(primary.subtotal_pln), delivery: m(primary.cheapest_delivery_pln), expected: m(primary.expected_pln), why }));
  }
  if (plan.orders.length > 1) out.push(tr('plan.total_all', { expected: m(plan.expected_pln), ceiling: m(plan.ceiling_pln) }));

  if (opts.facts && opts.facts.length) out.push(tr('plan.facts', { list: opts.facts.join(', ') }));
  out.push(tr('plan.assumptions', { list: opts.assumptions && opts.assumptions.length ? opts.assumptions.join(', ') : tr('plan.none') }));

  const lim = (id: LimitId) => plan.limits.find((l) => l.id === id);
  // one "ok <amount>" must cover every broken money limit: ask for the largest of the offending amounts
  const required = Math.max(...plan.limits.filter((l) => !l.ok && (l.id === 'per_item' || l.id === 'per_order')).map((l) => l.value), 0);
  for (const l of plan.limits.filter((x) => !x.ok)) {
    if (l.id === 'per_item') out.push(tr('plan.over_item', { line: l.line ?? '', value: m(l.value), limit: fmtLimit(l.limit, L), required: m(required), suggest: suggestLimit(l.value, l.limit) }));
    else if (l.id === 'per_order') out.push(tr('plan.over_order', { value: m(l.value), limit: fmtLimit(l.limit, L), required: m(required), suggest: suggestLimit(l.value, l.limit) }));
    else if (l.id === 'max_items') out.push(tr('plan.over_items', { value: l.value, limit: l.limit }));
    else out.push(tr('plan.over_aggregate', { limit: m(l.limit), value: m(l.value) }));
  }

  const mark = (id: LimitId) => {
    const l = lim(id);
    return l ? (l.ok ? '✔' : '✖') : '—';
  };
  const Lm = opts.limits ?? {};
  out.push(
    tr('plan.limits', {
      item: Lm.perItem !== undefined ? `≤${fmtLimit(Lm.perItem, L)} ${mark('per_item')}` : tr('plan.no_limit'),
      order: Lm.perOrder !== undefined ? `≤${fmtLimit(Lm.perOrder, L)} ${mark('per_order')}` : tr('plan.no_limit'),
      lines: Lm.maxItems !== undefined ? `≤${Lm.maxItems} ${mark('max_items')}` : tr('plan.no_limit'),
      remaining: opts.remainingPln !== undefined ? m(opts.remainingPln) : '—',
    }),
  );

  if (plan.aggregate_exceeded) {
    out.push(tr('plan.reply_aggregate'));
  } else if (plan.needs_override) {
    const broken = plan.limits.filter((l) => !l.ok && l.id !== 'aggregate');
    const amount = Math.max(...broken.filter((l) => l.id !== 'max_items').map((l) => l.value), 0);
    const item = broken.find((l) => l.id === 'per_item');
    const order = broken.find((l) => l.id === 'per_order');
    const parts: string[] = [];
    if (amount > 0) parts.push(tr('plan.r_amount', { amount: m(amount) }));
    if (item) parts.push(tr('plan.r_item_limit_perm', { n: suggestLimit(item.value, item.limit) }));
    if (order) parts.push(tr('plan.r_order_limit_perm', { n: suggestLimit(order.value, order.limit) }));
    parts.push(tr('plan.r_without_n'), tr('plan.r_no'));
    out.push(tr('plan.reply_override', { parts: parts.join(' · ') }));
  } else {
    const parts = [tr('plan.r_ok_a')];
    if (main) parts.push(tr('plan.r_ok_b'), tr('plan.r_ok_ab'), tr('plan.r_without', { n: main.n }));
    else if (primary.lines.length > 1) parts.push(tr('plan.r_without_n'));
    if (alts.length) parts.push(tr('plan.r_plus', { n: alts[0].n }));
    parts.push(tr('plan.r_no'));
    if (Lm.perItem !== undefined) parts.push(tr('plan.r_item_limit', { n: suggestLimit(Lm.perItem, Lm.perItem) }));
    out.push(tr('plan.reply', { parts: parts.join(' · ') }));
  }
  for (const x of opts.notTaken ?? []) out.push(x);
  return out.join('\n');
}

/** @deprecated name kept for readers of the 2026-09-04 design; use formatPlan (language from ASA_LANG). */
export const formatPlanRu = formatPlan;


// ---------------------------------------------------------------------------------------------
// The one reply

export type ReplyKind = 'A' | 'B' | 'A/B' | 'without' | 'plus' | 'amount' | 'no' | 'limit_item' | 'limit_order' | 'unknown';

export interface ParsedReply {
  kind: ReplyKind;
  n?: number;
  amount?: number;
  raw: string;
}

const OK = '(?:ок|ok|okay|окей|окей)';
const A = '(?:a|а)';
const B = '(?:b|б|в)';

function toNum(s: string): number {
  return Number(s.replace(',', '.'));
}

/**
 * «ок» / «ok» / «A» → A · «ок B» → B · «ок A/B» → A with fallback B · «ок без 3» · «ок + 4» ·
 * «ок 84,90» → one-time approval amount · «нет» · «лимит позиции 120» · «лимит заказа 150».
 * A bare «ок» while the proposal needs an override is `unknown` (the same message is shown again).
 */
export function parseReply(text: string, ctx: { needsOverride?: boolean } = {}): ParsedReply {
  const raw = text;
  const s = text
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[«»"'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!…]+$/, '')
    .trim();
  const r = (kind: ReplyKind, extra: Partial<ParsedReply> = {}): ParsedReply => ({ kind, raw, ...extra });
  if (!s) return r('unknown');
  if (/^(?:нет|no|nie|отмена|стоп|stop|cancel)$/.test(s)) return r('no');
  // «лимит позиции 120» / "limit item 120" / "item limit 120" (the English proposal uses the last form)
  let m = new RegExp(`^(?:${OK}\\s*)?(?:(?:лимит|limit)\\s+(?:позици[ия]|item|line)|(?:item|line)\\s+limit)\\s+(\\d+(?:[.,]\\d{1,2})?)(?:\\s*(?:pln|zł|zl))?$`).exec(s);
  if (m) return r('limit_item', { amount: toNum(m[1]) });
  m = new RegExp(`^(?:${OK}\\s*)?(?:(?:лимит|limit)\\s+(?:заказ[а]?|order)|order\\s+limit)\\s+(\\d+(?:[.,]\\d{1,2})?)(?:\\s*(?:pln|zł|zl))?$`).exec(s);
  if (m) return r('limit_order', { amount: toNum(m[1]) });

  m = new RegExp(`^${OK}(?:\\s+(.*))?$`).exec(s);
  let rest: string;
  if (m) rest = (m[1] ?? '').trim();
  else if (new RegExp(`^${A}$`).test(s)) return ctx.needsOverride ? r('unknown') : r('A');
  else if (new RegExp(`^${B}$`).test(s)) return r('B');
  else if (new RegExp(`^${A}\\s*[/\\\\]\\s*${B}$`).test(s)) return r('A/B');
  else return r('unknown');

  if (rest === '') return ctx.needsOverride ? r('unknown') : r('A');
  if (new RegExp(`^(?:вариант\\s+)?${A}$`).test(rest)) return ctx.needsOverride ? r('unknown') : r('A');
  if (new RegExp(`^(?:вариант\\s+)?${B}$`).test(rest)) return r('B');
  if (new RegExp(`^(?:вариант\\s+)?${A}\\s*[/\\\\]\\s*${B}$`).test(rest)) return r('A/B');
  m = /^(?:без|without|минус|-)\s*(?:п\.?\s*|п\s+)?(\d+)$/.exec(rest);
  if (m) return r('without', { n: Number(m[1]) });
  m = /^(?:\+|плюс|plus|с)\s*(?:п\.?\s*|п\s+)?(\d+)$/.exec(rest);
  if (m) return r('plus', { n: Number(m[1]) });
  m = /^(\d+(?:[.,]\d{1,2})?)\s*(?:zł|zl|pln|злот\S*)?$/.exec(rest);
  if (m) return r('amount', { amount: toNum(m[1]) });
  return r('unknown');
}

// ---------------------------------------------------------------------------------------------
// Applying the reply to the plan

export interface ResolveOptions {
  threshold: number;
  perItemLimit?: number;
  perOrderLimit?: number;
  maxItems?: number;
  remainingAggregate?: number;
  /** MAX_COMPLEMENTS: how many complements may be added (default 1). */
  maxComplements?: number;
}

export interface BasketResolution {
  variant: 'A' | 'B';
  fallback_option?: 'B';
  seller: string;
  items: PlanLine[];
  complement?: PlanLine;
  subtotal_pln: number;
  expected_pln: number;
  ceiling_pln: number;
  free_delivery: boolean;
  smart_all: boolean;
  limits: LimitCheck[];
  needs_override: boolean;
  aggregate_exceeded: boolean;
  /** Smallest one-time approval that covers the broken item / order limits. */
  override_required_pln?: number;
  /** Line whose price breaks the per-item limit (the approval is bound to it), else the first line. */
  override_offer_id?: string;
  /** Approved amount from «ок <сумма>», when given. */
  override_pln?: number;
  /** Other seller orders of a split plan (each needs its own run this week). */
  other_orders: SellerOrder[];
}

function complementToLine(c: Complement, need: string): PlanLine {
  const l = toLine(need, c.offer, c.n);
  l.complement = true;
  l.tier = c.tier;
  l.bought_before = c.bought_before;
  return l;
}

/** Turn the parsed reply into the final basket; `error` when the reply refers to a line that does not exist. */
export function applyReply(plan: BasketPlan, proposal: ComplementProposal, reply: ParsedReply, opts: ResolveOptions): BasketResolution | { error: string } {
  const order = plan.orders[0];
  if (!order) return { error: 'the plan has no order to approve' };
  if (reply.kind === 'no' || reply.kind === 'unknown' || reply.kind === 'limit_item' || reply.kind === 'limit_order') {
    return { error: `reply "${reply.raw}" does not approve the basket` };
  }
  const maxComplements = opts.maxComplements ?? 1;
  let lines = order.lines.map((l) => ({ ...l }));
  let variant: 'A' | 'B' = 'A';
  let fallback: 'B' | undefined;
  let complement: Complement | undefined = maxComplements > 0 ? proposal.shown[0] : undefined;
  switch (reply.kind) {
    case 'A':
    case 'amount':
      break;
    case 'B':
      variant = 'B';
      complement = undefined;
      break;
    case 'A/B':
      fallback = 'B';
      break;
    case 'without': {
      const n = reply.n as number;
      if (complement && n === complement.n) {
        variant = 'B';
        complement = undefined;
      } else if (lines.some((l) => l.n === n)) {
        lines = lines.filter((l) => l.n !== n);
        if (!lines.length) return { error: `«без ${n}» would leave the basket empty; reply «нет» to close the run` };
      } else return { error: `there is no line ${n} in the proposal` };
      break;
    }
    case 'plus': {
      const n = reply.n as number;
      const alt = proposal.shown.find((c) => c.n === n);
      if (!alt) return { error: `there is no complement ${n} in the proposal` };
      if (maxComplements < 1) return { error: 'MAX_COMPLEMENTS is 0: complements cannot be added' };
      complement = alt;
      break;
    }
  }
  const items = [...lines];
  let compLine: PlanLine | undefined;
  if (complement) {
    compLine = complementToLine(complement, complement.offer.need ?? 'complement');
    items.push(compLine);
  }
  const resolved = recomputeOrder({ seller: order.seller, seller_type: order.seller_type, seller_rating: order.seller_rating, super_seller: order.super_seller, lines: items }, opts.threshold);
  const limits = checkLimits([resolved], { perItemLimit: opts.perItemLimit, perOrderLimit: opts.perOrderLimit, maxItems: opts.maxItems, remainingAggregate: opts.remainingAggregate });
  const broken = limits.filter((l) => !l.ok);
  const needsOverride = broken.some((l) => l.id !== 'aggregate');
  const overrideRequired = needsOverride ? round2(Math.max(...broken.filter((l) => l.id === 'per_item' || l.id === 'per_order').map((l) => l.value), 0)) : undefined;
  const itemBreak = broken.find((l) => l.id === 'per_item');
  const bindTo = itemBreak ? resolved.lines.find((l) => l.n === itemBreak.line) : resolved.lines[0];
  return {
    variant,
    fallback_option: fallback,
    seller: resolved.seller,
    items: resolved.lines,
    complement: compLine ? resolved.lines.find((l) => l.complement) : undefined,
    subtotal_pln: resolved.subtotal_pln,
    expected_pln: resolved.expected_pln,
    ceiling_pln: resolved.ceiling_pln,
    free_delivery: resolved.free_delivery,
    smart_all: resolved.smart_all,
    limits,
    needs_override: needsOverride,
    aggregate_exceeded: broken.some((l) => l.id === 'aggregate'),
    override_required_pln: overrideRequired && overrideRequired > 0 ? overrideRequired : undefined,
    override_offer_id: bindTo?.id,
    override_pln: reply.kind === 'amount' ? reply.amount : undefined,
    other_orders: plan.orders.slice(1),
  };
}
