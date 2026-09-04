import { describe, expect, it } from 'vitest';
import {
  applyReply,
  checkLimits,
  DEFAULT_SMART_DELIVERY_PLN,
  formatPlanRu,
  groupBySeller,
  lineDeliveryPln,
  parseReply,
  planBaskets,
  proposeComplements,
  suggestLimit,
  type BasketOffer,
  type ParsedReply,
} from '../src/basket.js';

/** Smart!-marked, new, Buy-Now offer from a business seller; the card shows price + 10.95 "z dostawą". */
function offer(id: string, over: Partial<BasketOffer> & { price_pln: number; seller: string }): BasketOffer {
  return {
    id,
    url: `https://allegro.pl/oferta/${id}`,
    title: `Item ${id}`,
    shipping_pln: 0,
    free_delivery: true,
    smart: true,
    seller_rating: 99,
    super_seller: false,
    sales_count: 120,
    condition: 'new',
    format: 'BUY_NOW',
    source: 'session',
    seller_type: 'firma',
    total_with_delivery_pln: over.price_pln + DEFAULT_SMART_DELIVERY_PLN,
    ...over,
  };
}

const T = 49.9;
const LIMITS = { perItemLimit: 60, perOrderLimit: 100, maxItems: 4, remainingAggregate: 600 };
const NEEDS = [
  { label: 'n1', category: 'Крепёж и метизы' },
  { label: 'n2', category: 'Крепёж и метизы' },
];

describe('Smart! threshold per seller (regulations 2026-03-02)', () => {
  it('two 30 PLN items at two sellers pay delivery twice; two 25 PLN items at one seller ship free', () => {
    const split = planBaskets(NEEDS, [offer('a1', { price_pln: 30, seller: 'A', need: 'n1' }), offer('b2', { price_pln: 30, seller: 'B', need: 'n2' })], { threshold: T, ...LIMITS });
    expect(split.orders).toHaveLength(2);
    expect(split.orders.every((o) => !o.free_delivery)).toBe(true);
    expect(split.expected_pln).toBe(81.9);
    expect(split.ceiling_pln).toBe(81.9);
    expect(split.orders.map((o) => o.delta_pln)).toEqual([19.9, 19.9]);

    const one = planBaskets(NEEDS, [offer('c1', { price_pln: 25, seller: 'C', need: 'n1' }), offer('c2', { price_pln: 25, seller: 'C', need: 'n2' })], { threshold: T, ...LIMITS });
    expect(one.orders).toHaveLength(1);
    expect(one.orders[0]).toMatchObject({ seller: 'C', subtotal_pln: 50, smart_all: true, free_delivery: true, expected_pln: 50, ceiling_pln: 71.9, delta_pln: 0 });
    expect(one.needs_override).toBe(false);
  });

  it('prefers the single-seller plan when the split plan costs more once delivery is counted', () => {
    const offers = [
      offer('a1', { price_pln: 26, seller: 'A', need: 'n1' }),
      offer('a2', { price_pln: 26, seller: 'A', need: 'n2' }),
      offer('b1', { price_pln: 22, seller: 'B', need: 'n1' }),
      offer('c2', { price_pln: 22, seller: 'C', need: 'n2' }),
    ];
    const plan = planBaskets(NEEDS, offers, { threshold: T, ...LIMITS });
    // A: 52 free = 52.00; B + C: 22 + 10.95 + 22 + 10.95 = 65.90
    expect(plan.orders.map((o) => o.seller)).toEqual(['A']);
    expect(plan.expected_pln).toBe(52);
    expect(plan.plans_considered).toBe(4);
  });

  it('a grandfathered 45 PLN threshold makes 2 x 23 free; the default 49.90 does not', () => {
    const offers = [offer('g1', { price_pln: 23, seller: 'G', need: 'n1' }), offer('g2', { price_pln: 23, seller: 'G', need: 'n2' })];
    expect(planBaskets(NEEDS, offers, { threshold: 45, ...LIMITS }).orders[0]).toMatchObject({ free_delivery: true, expected_pln: 46 });
    expect(planBaskets(NEEDS, offers, { threshold: T, ...LIMITS }).orders[0]).toMatchObject({ free_delivery: false, expected_pln: 56.95, delta_pln: 3.9 });
  });

  it('a non-Smart line never ships free, and the ceiling sums every line\'s delivery', () => {
    const offers = [offer('s1', { price_pln: 30, seller: 'S', need: 'n1' }), offer('s2', { price_pln: 30, seller: 'S', need: 'n2', smart: false, free_delivery: false, shipping_pln: 12.99, total_with_delivery_pln: 42.99 })];
    const o = planBaskets(NEEDS, offers, { threshold: T, ...LIMITS }).orders[0];
    expect(o).toMatchObject({ smart_all: false, free_delivery: false, cheapest_delivery_pln: 12.99, expected_pln: 72.99, ceiling_pln: 83.94 });
  });

  it('lineDeliveryPln reads the "z dostawą" figure, never trusts a Smart! flag as free below the threshold', () => {
    expect(lineDeliveryPln(offer('x', { price_pln: 20, seller: 's', total_with_delivery_pln: 28.99 }))).toBe(8.99);
    expect(lineDeliveryPln(offer('x', { price_pln: 20, seller: 's', total_with_delivery_pln: undefined }))).toBe(DEFAULT_SMART_DELIVERY_PLN);
    expect(lineDeliveryPln(offer('x', { price_pln: 20, seller: 's', total_with_delivery_pln: 20 }))).toBe(0);
    expect(lineDeliveryPln(offer('x', { price_pln: 20, seller: 's', smart: false, free_delivery: true, shipping_pln: 0, total_with_delivery_pln: undefined }))).toBe(0);
    expect(lineDeliveryPln(offer('x', { price_pln: 20, seller: 's', smart: false, free_delivery: false, shipping_pln: 14.99, total_with_delivery_pln: undefined }))).toBe(14.99);
  });

  it('groupBySeller keeps offers without a seller login apart', () => {
    const g = groupBySeller([offer('1', { price_pln: 1, seller: 'A' }), offer('2', { price_pln: 1, seller: 'a' }), offer('3', { price_pln: 1, seller: '' }), offer('4', { price_pln: 1, seller: '' })]);
    expect(Array.from(g.keys())).toEqual(['a', '?:3', '?:4']);
    expect(g.get('a')?.map((o) => o.id)).toEqual(['1', '2']);
  });
});

describe('plan selection: ties, limits, avoided sellers, uncovered needs', () => {
  it('ties on expected go to the seller bought from before, then Smart!, then firma, then rating', () => {
    const offers = [offer('x1', { price_pln: 30, seller: 'X', need: 'n1' }), offer('y1', { price_pln: 30, seller: 'Y', need: 'n1' })];
    const bb = planBaskets([NEEDS[0]], offers, { threshold: T, ...LIMITS, boughtBeforeFn: (o) => (o.seller === 'Y' ? { date: '2026-08-05' } : false) });
    expect(bb.orders[0].seller).toBe('Y');
    expect(bb.orders[0].lines[0].bought_before).toBe(true);
    const smart = planBaskets([NEEDS[0]], [offer('x1', { price_pln: 30, seller: 'X', need: 'n1', smart: false, free_delivery: false, shipping_pln: 10.95 }), offer('y1', { price_pln: 30, seller: 'Y', need: 'n1' })], { threshold: T, ...LIMITS });
    expect(smart.orders[0].seller).toBe('Y');
    const firma = planBaskets([NEEDS[0]], [offer('x1', { price_pln: 30, seller: 'X', need: 'n1', seller_type: 'osoba' }), offer('y1', { price_pln: 30, seller: 'Y', need: 'n1' })], { threshold: T, ...LIMITS });
    expect(firma.orders[0].seller).toBe('Y');
    const rating = planBaskets([NEEDS[0]], [offer('x1', { price_pln: 30, seller: 'X', need: 'n1', seller_rating: 98.5 }), offer('y1', { price_pln: 30, seller: 'Y', need: 'n1', seller_rating: 99.8 })], { threshold: T, ...LIMITS });
    expect(rating.orders[0].seller).toBe('Y');
  });

  it('a plan above the order limit is returned with needs_override and the offending numbers, never trimmed', () => {
    const offers = [offer('p1', { price_pln: 55, seller: 'P', need: 'n1' }), offer('p2', { price_pln: 52, seller: 'P', need: 'n2' })];
    const plan = planBaskets(NEEDS, offers, { threshold: T, ...LIMITS });
    expect(plan.orders[0].lines).toHaveLength(2);
    expect(plan.orders[0]).toMatchObject({ free_delivery: true, expected_pln: 107 });
    expect(plan.needs_override).toBe(true);
    expect(plan.aggregate_exceeded).toBe(false);
    expect(plan.limits).toEqual([
      { id: 'per_item', ok: true, value: 55, limit: 60, line: 1, seller: 'P' },
      { id: 'per_order', ok: false, value: 107, limit: 100, seller: 'P' },
      { id: 'max_items', ok: true, value: 2, limit: 4, seller: 'P' },
      { id: 'aggregate', ok: true, value: 107, limit: 600 },
    ]);
    const item = planBaskets([NEEDS[0]], [offer('q1', { price_pln: 84.9, seller: 'Q', need: 'n1' })], { threshold: T, ...LIMITS });
    expect(item.needs_override).toBe(true);
    expect(item.limits.find((l) => l.id === 'per_item')).toEqual({ id: 'per_item', ok: false, value: 84.9, limit: 60, line: 1, seller: 'Q' });
    const agg = planBaskets([NEEDS[0]], [offer('q1', { price_pln: 50, seller: 'Q', need: 'n1' })], { threshold: T, ...LIMITS, remainingAggregate: 40 });
    expect(agg.needs_override).toBe(false);
    expect(agg.aggregate_exceeded).toBe(true);
    const many = checkLimits(planBaskets([NEEDS[0]], [offer('q1', { price_pln: 5, seller: 'Q', need: 'n1' })], { threshold: T }).orders, { maxItems: 0 });
    expect(many).toEqual([{ id: 'max_items', ok: false, value: 1, limit: 0, seller: 'Q' }]);
  });

  it('skips avoided sellers and reports needs nobody covers', () => {
    const offers = [offer('z1', { price_pln: 10, seller: 'Zly', need: 'n1' }), offer('d1', { price_pln: 12, seller: 'Dobry', need: 'n1' })];
    const plan = planBaskets(NEEDS, offers, { threshold: T, ...LIMITS, avoidSellers: ['zly'] });
    expect(plan.orders.map((o) => o.seller)).toEqual(['Dobry']);
    expect(plan.covered).toEqual(['n1']);
    expect(plan.uncovered).toEqual(['n2']);
    const none = planBaskets(NEEDS, [offer('z1', { price_pln: 10, seller: 'Zly', need: 'n1' })], { threshold: T, avoidSellers: ['Zly'] });
    expect(none.orders).toEqual([]);
    expect(none.uncovered).toEqual(['n1', 'n2']);
  });

  it('offers without a need label serve the only need; the cheapest per seller is taken', () => {
    const plan = planBaskets([NEEDS[0]], [offer('a2', { price_pln: 12, seller: 'A' }), offer('a1', { price_pln: 9, seller: 'A' })], { threshold: T, ...LIMITS });
    expect(plan.orders[0].lines.map((l) => l.id)).toEqual(['a1']);
    expect(plan.orders[0].lines[0].offer_id).toBeUndefined();
    expect(planBaskets([NEEDS[0]], [offer('123456789', { price_pln: 9, seller: 'A' })], { threshold: T }).orders[0].lines[0].offer_id).toBe('123456789');
  });
});

/** The example from the design synthesis, section 1 item 6. */
function specExample() {
  const seller = 'MILWAR_POLSKA';
  const needs = [
    { label: 'nakretka-niska-m5', category: 'Крепёж и метизы', source: '[[Металлическая резьба M5 в PETG]]' },
    { label: 'nakretka-wbijana-m5', category: 'Крепёж и метизы', source: 'MultiBoard/META4' },
  ];
  const lines = [
    offer('101', { price_pln: 12.5, seller, need: 'nakretka-niska-m5', title: 'Nakrętka niska M5 DIN 439 A2, 20 szt', category: 'Крепёж и метизы' }),
    offer('102', { price_pln: 17, seller, need: 'nakretka-wbijana-m5', title: 'Nakrętka wbijana M5 DIN 1624, 100 szt', category: 'Крепёж и метизы' }),
  ];
  const candidates = [
    offer('103', { price_pln: 23.7, seller, title: 'Rym-bolt DIN 580 M5 A4 ×4', category: 'Крепёж и метизы' }),
    offer('104', { price_pln: 21.9, seller, need: 'nakretka-din985', title: 'Nakrętka DIN 985 M5 A2 ×50', category: 'Крепёж и метизы' }),
  ];
  const bb = (o: { id: string }) => (o.id === '103' ? { date: '2026-08-05' } : false);
  const plan = planBaskets(needs, lines, { threshold: T, ...LIMITS, boughtBeforeFn: bb });
  const proposal = proposeComplements(plan, candidates, { threshold: T, slack: 25, ...LIMITS, categories: ['Крепёж и метизы', 'Расходники 3D-печати'], primaryCategory: 'Крепёж и метизы', boughtBeforeFn: bb, wishlistFn: (o) => o.need === 'nakretka-din985' });
  const opts = {
    runId: 'r1',
    remainingPln: 600,
    limits: { perItem: 60, perOrder: 100, maxItems: 4 },
    rail: 'oneclick_card' as const,
    purchaseDates: ['2026-08-05', '2026-07-21'],
    assumptions: ['нержавейка A2/A4', 'упаковки 20/100 шт', 'фактура на NIP — нет'],
    needSources: { 'nakretka-niska-m5': '[[Металлическая резьба M5 в PETG]]', 'nakretka-wbijana-m5': 'MultiBoard/META4' },
  };
  return { plan, proposal, opts, candidates };
}

describe('complements (gap-fillers)', () => {
  it('window [delta, delta + slack]: a candidate outside it is dropped, one inside is shown', () => {
    const plan = planBaskets(NEEDS, [offer('l1', { price_pln: 12.5, seller: 'S', need: 'n1', category: 'Крепёж и метизы' }), offer('l2', { price_pln: 17, seller: 'S', need: 'n2', category: 'Крепёж и метизы' })], { threshold: T, ...LIMITS });
    expect(plan.orders[0].delta_pln).toBe(20.4);
    const candidates = [
      offer('below', { price_pln: 15, seller: 'S', category: 'Крепёж и метизы' }),
      offer('above', { price_pln: 50, seller: 'S', category: 'Крепёж и метизы' }),
      offer('inside', { price_pln: 23.7, seller: 'S', category: 'Крепёж и метизы' }),
      offer('elsewhere', { price_pln: 23.7, seller: 'Other', category: 'Крепёж и метизы' }),
      offer('notsmart', { price_pln: 23.7, seller: 'S', category: 'Крепёж и метизы', smart: false, free_delivery: false, shipping_pln: 9.99 }),
    ];
    const p = proposeComplements(plan, candidates, { threshold: T, slack: 25, ...LIMITS, categories: ['Крепёж и метизы'], primaryCategory: 'Крепёж и метизы' });
    expect(p.applicable).toBe(true);
    expect(p.window).toEqual([20.4, 45.4]);
    expect(p.shown.map((c) => c.offer.id)).toEqual(['inside']);
    expect(p.shown[0]).toMatchObject({ n: 3, tier: 3, score: 1, new_subtotal_pln: 53.2, reason: 'та же категория' });
    expect(p.skipped).toEqual({ outside_window: 2, other_seller: 1, not_smart: 1 });
  });

  it('is not applicable when the order is already free, not Smart!, or the gap exceeds the slack', () => {
    const free = planBaskets(NEEDS, [offer('1', { price_pln: 30, seller: 'S', need: 'n1' }), offer('2', { price_pln: 30, seller: 'S', need: 'n2' })], { threshold: T });
    expect(proposeComplements(free, [offer('c', { price_pln: 5, seller: 'S' })], { threshold: T, slack: 25 })).toMatchObject({ applicable: false, reason: 'already_free', shown: [] });
    const far = planBaskets([NEEDS[0]], [offer('1', { price_pln: 10, seller: 'S', need: 'n1' })], { threshold: T });
    expect(proposeComplements(far, [offer('c', { price_pln: 40, seller: 'S' })], { threshold: T, slack: 25 })).toMatchObject({ applicable: false, reason: 'delta_over_slack', delta_pln: 39.9 });
    const notSmart = planBaskets([NEEDS[0]], [offer('1', { price_pln: 30, seller: 'S', need: 'n1', smart: false, free_delivery: false, shipping_pln: 9 })], { threshold: T });
    expect(proposeComplements(notSmart, [offer('c', { price_pln: 20, seller: 'S' })], { threshold: T, slack: 25 })).toMatchObject({ applicable: false, reason: 'not_smart_order' });
    expect(proposeComplements({ ...free, orders: [] }, [], { threshold: T, slack: 25 })).toMatchObject({ applicable: false, reason: 'no_order' });
  });

  it('a candidate outside the mandate categories is never shown; blocked, cooldown and limit breaches are skipped', () => {
    const plan = planBaskets(NEEDS, [offer('l1', { price_pln: 12.5, seller: 'S', need: 'n1', category: 'Крепёж и метизы' }), offer('l2', { price_pln: 17, seller: 'S', need: 'n2', category: 'Крепёж и метизы' })], { threshold: T, ...LIMITS });
    const candidates = [
      offer('electronics', { price_pln: 22, seller: 'S', category: 'Электроника' }),
      offer('nocategory', { price_pln: 22, seller: 'S' }),
      offer('blocked', { price_pln: 22, seller: 'S', category: 'Крепёж и метизы' }),
      offer('recent', { price_pln: 22, seller: 'S', category: 'Крепёж и метизы' }),
      offer('recent-consumable', { price_pln: 24, seller: 'S', category: 'Расходники 3D-печати' }),
      offer('expensive', { price_pln: 61, seller: 'S', category: 'Крепёж и метизы' }),
    ];
    const p = proposeComplements(plan, candidates, {
      threshold: T,
      slack: 45,
      ...LIMITS,
      categories: ['Крепёж и метизы', 'Расходники 3D-печати'],
      primaryCategory: 'Крепёж и метизы',
      isBlockedFn: (o) => o.id === 'blocked',
      recentlyBoughtFn: (o) => o.id.startsWith('recent'),
      consumableFn: (o) => o.id === 'recent-consumable',
      wishlistFn: (o) => o.id === 'recent-consumable',
    });
    expect(p.shown.map((c) => c.offer.id)).toEqual(['recent-consumable']);
    expect(p.skipped).toEqual({ outside_mandate_categories: 2, blocked: 1, cooldown: 1, over_item_limit: 1 });
    const tight = proposeComplements(plan, [offer('c', { price_pln: 22, seller: 'S', category: 'Крепёж и метизы' })], { threshold: T, slack: 25, perOrderLimit: 50, maxItems: 4, primaryCategory: 'Крепёж и метизы' });
    expect(tight.skipped).toEqual({ over_order_limit: 1 });
    const full = proposeComplements(plan, [offer('c', { price_pln: 22, seller: 'S', category: 'Крепёж и метизы' })], { threshold: T, slack: 25, maxItems: 2, primaryCategory: 'Крепёж и метизы' });
    expect(full.skipped).toEqual({ over_max_items: 1 });
  });

  it('ranks 3·bought_before + 2·wishlist + 1·same_category, cheaper first on ties, shows at most 3', () => {
    const plan = planBaskets(NEEDS, [offer('l1', { price_pln: 12.5, seller: 'S', need: 'n1', category: 'Крепёж и метизы' }), offer('l2', { price_pln: 17, seller: 'S', need: 'n2', category: 'Крепёж и метизы' })], { threshold: T, ...LIMITS });
    const cat = 'Крепёж и метизы';
    const candidates = [
      offer('t3', { price_pln: 21, seller: 'S', category: cat }),
      offer('t2', { price_pln: 22, seller: 'S', category: 'Расходники 3D-печати' }),
      offer('t1b', { price_pln: 24, seller: 'S', category: 'Расходники 3D-печати' }),
      offer('t1a', { price_pln: 23, seller: 'S', category: 'Расходники 3D-печати' }),
      offer('all', { price_pln: 25, seller: 'S', category: cat }),
    ];
    const p = proposeComplements(plan, candidates, {
      threshold: T,
      slack: 25,
      ...LIMITS,
      categories: [cat, 'Расходники 3D-печати'],
      primaryCategory: cat,
      boughtBeforeFn: (o) => o.id.startsWith('t1') || o.id === 'all',
      wishlistFn: (o) => o.id === 't2' || o.id === 'all',
    });
    expect(p.shown.map((c) => [c.offer.id, c.tier, c.score, c.n])).toEqual([
      ['all', 1, 6, 3],
      ['t1a', 1, 3, 4],
      ['t1b', 1, 3, 5],
    ]);
    expect(p.considered).toBe(5);
    const three = proposeComplements(plan, candidates.slice(0, 4), { threshold: T, slack: 25, ...LIMITS, categories: [cat, 'Расходники 3D-печати'], primaryCategory: cat, boughtBeforeFn: (o) => o.id.startsWith('t1'), wishlistFn: (o) => o.id === 't2' });
    expect(three.shown.map((c) => c.offer.id)).toEqual(['t1a', 't1b', 't2']);
  });

  it('tier 3 must not cost more than the gap plus the delivery it saves and needs 50 sales', () => {
    const plan = planBaskets([NEEDS[0]], [offer('l1', { price_pln: 30, seller: 'S', need: 'n1', category: 'X' })], { threshold: T });
    // delta 19.90, delivery 10.95 -> a same-category filler may cost at most 30.85
    const p = proposeComplements(plan, [offer('ok', { price_pln: 30, seller: 'S', category: 'X' }), offer('pricey', { price_pln: 31, seller: 'S', category: 'X' }), offer('new', { price_pln: 25, seller: 'S', category: 'X', sales_count: 3 })], { threshold: T, slack: 25, primaryCategory: 'X' });
    expect(p.shown.map((c) => c.offer.id)).toEqual(['ok']);
    expect(p.skipped).toEqual({ tier3_over_gap_plus_delivery: 1, tier3_few_sales: 1 });
  });
});

describe('formatPlanRu — the one message', () => {
  it('reproduces the example of the design synthesis (section 1, item 6)', () => {
    const { plan, proposal, opts } = specExample();
    expect(formatPlanRu(plan, proposal, opts)).toBe(
      [
        '🛒 Предложение #r1 · MILWAR_POLSKA (Smart!, покупал 21.07 и 05.08) · Paczkomat InPost · карта one-click',
        '1. Nakrętka niska M5 DIN 439 A2, 20 szt — 12,50   [нужно: [[Металлическая резьба M5 в PETG]]]',
        '2. Nakrętka wbijana M5 DIN 1624, 100 szt — 17,00   [нужно: MultiBoard/META4]',
        'Товары 29,50 → до порога 49,90 не хватает 20,40.',
        '3. (+) Rym-bolt DIN 580 M5 A4 ×4 — 23,70  [покупал у него 05.08; ярус 1]',
        'A: с п.3 = 53,20 + доставка 0 = 53,20 zł  ← по умолчанию     B: без п.3 = 29,50 + 10,95 = 40,45 zł',
        'Ещё можно вместо п.3: 4) Nakrętka DIN 985 M5 A2 ×50 — 21,90 [ярус 2]',
        'Допущения из vault: нержавейка A2/A4, упаковки 20/100 шт, фактура на NIP — нет.',
        'Лимиты: позиция ≤60 ✔ · заказ ≤100 ✔ · позиций ≤4 ✔ · остаток мандата 600,00.',
        'Ответь: «ок» (=A) · «ок B» · «ок A/B» (A, если Smart не сработает — B) · «ок без 3» · «ок + 4» · «нет» · «лимит позиции 120»',
      ].join('\n'),
    );
  });

  it('shows the over-limit line with the one-time and permanent replies and refuses a bare «ок»', () => {
    const plan = planBaskets([{ label: 'n1', category: 'X' }], [offer('q1', { price_pln: 84.9, seller: 'Q', need: 'n1', title: 'Drogi element' })], { threshold: T, ...LIMITS });
    const text = formatPlanRu(plan, proposeComplements(plan, [], { threshold: T, slack: 25 }), { runId: 'r2', remainingPln: 600, limits: { perItem: 60, perOrder: 100, maxItems: 4 }, rail: 'allegro_pay', assumptions: [] });
    expect(text).toContain('· Allegro Pay');
    expect(text).toContain('(Smart!, новый продавец)');
    expect(text).toContain('⚠️ п.1 84,90 > лимит позиции 60 → ответь «ок 84,90» (разово) или «лимит позиции 120» (навсегда)');
    expect(text).toContain('Лимиты: позиция ≤60 ✖ · заказ ≤100 ✔ · позиций ≤4 ✔ · остаток мандата 600,00.');
    expect(text).toContain('Ответь: «ок 84,90» (разово) · «лимит позиции 120» (навсегда) · «ок без N» · «нет» — голое «ок» не принимается');
    expect(text).toContain('Допущения из vault: нет.');
    expect(parseReply('ок', { needsOverride: plan.needs_override }).kind).toBe('unknown');
    expect(parseReply('ок 84,90', { needsOverride: plan.needs_override })).toMatchObject({ kind: 'amount', amount: 84.9 });
    expect(suggestLimit(84.9, 60)).toBe(120);
    expect(suggestLimit(250, 100)).toBe(250);
    // an item AND an order breach: one «ок <сумма>» must cover both, so both lines ask for the larger amount
    const both = planBaskets(NEEDS, [offer('q1', { price_pln: 84.9, seller: 'Q', need: 'n1' }), offer('q2', { price_pln: 17, seller: 'Q', need: 'n2' })], { threshold: T, ...LIMITS });
    const t2 = formatPlanRu(both, proposeComplements(both, [], { threshold: T, slack: 25 }), { runId: 'r3', remainingPln: 600, limits: { perItem: 60, perOrder: 100, maxItems: 4 } });
    expect(t2).toContain('⚠️ п.1 84,90 > лимит позиции 60 → ответь «ок 101,90» (разово) или «лимит позиции 120» (навсегда)');
    expect(t2).toContain('⚠️ заказ 101,90 > лимит заказа 100 → ответь «ок 101,90» (разово) или «лимит заказа 200» (навсегда)');
    expect(t2).toContain('Ответь: «ок 101,90» (разово) · «лимит позиции 120» (навсегда) · «лимит заказа 200» (навсегда) · «ок без N» · «нет» — голое «ок» не принимается');
  });

  it('describes an already-free order, a plan with no complement and a split plan', () => {
    const free = planBaskets(NEEDS, [offer('1', { price_pln: 30, seller: 'S', need: 'n1' }), offer('2', { price_pln: 30, seller: 'S', need: 'n2' })], { threshold: T, ...LIMITS });
    const t1 = formatPlanRu(free, proposeComplements(free, [], { threshold: T, slack: 25 }), { runId: 'r', limits: { perItem: 60, perOrder: 100, maxItems: 4 } });
    expect(t1).toContain('Товары 60,00 ≥ порога 49,90 → доставка Smart! 0,00.');
    expect(t1).toContain('A: 60,00 + доставка 0 (Smart!) = 60,00 zł  ← по умолчанию');
    expect(t1).toContain('Ответь: «ок» (=A) · «ок без N» · «нет» · «лимит позиции 120»');
    const gap = planBaskets([NEEDS[0]], [offer('1', { price_pln: 10, seller: 'S', need: 'n1' })], { threshold: T, ...LIMITS });
    const t2 = formatPlanRu(gap, proposeComplements(gap, [], { threshold: T, slack: 25 }), { runId: 'r', limits: {} });
    expect(t2).toContain('Товары 10,00 → до порога 49,90 не хватает 39,90.');
    expect(t2).toContain('A: 10,00 + доставка 10,95 = 20,95 zł  ← по умолчанию (довеска нет: до порога больше 25,00)');
    expect(t2).toContain('Лимиты: позиция без лимита · заказ без лимита · позиций без лимита · остаток мандата —.');
    const split = planBaskets(NEEDS, [offer('a1', { price_pln: 30, seller: 'A', need: 'n1' }), offer('b2', { price_pln: 20, seller: 'B', need: 'n2' })], { threshold: T, ...LIMITS });
    const t3 = formatPlanRu(split, proposeComplements(split, [], { threshold: T, slack: 25 }), { runId: 'r', limits: {} });
    expect(t3).toContain('Заказ 2 · B (Smart!) — отдельная доставка, порог у продавца свой:');
    expect(t3).toContain('Итого по всем заказам: ожидаемо 71,90 zł, потолок 71,90 zł.');
    const none = formatPlanRu(planBaskets(NEEDS, [], { threshold: T }), proposeComplements(planBaskets(NEEDS, [], { threshold: T }), [], { threshold: T, slack: 25 }), { runId: 'r' });
    expect(none).toContain('ни один оффер не покрывает нужное (n1, n2)');
  });
});

describe('parseReply grammar', () => {
  const cases: [string, Partial<ParsedReply>][] = [
    ['ок', { kind: 'A' }],
    ['ok', { kind: 'A' }],
    ['OK.', { kind: 'A' }],
    ['Окей!', { kind: 'A' }],
    ['A', { kind: 'A' }],
    ['а', { kind: 'A' }],
    ['ок A', { kind: 'A' }],
    ['ок B', { kind: 'B' }],
    ['ок б', { kind: 'B' }],
    ['B', { kind: 'B' }],
    ['ок A/B', { kind: 'A/B' }],
    ['ок а/б', { kind: 'A/B' }],
    ['A/B', { kind: 'A/B' }],
    ['ок без 3', { kind: 'without', n: 3 }],
    ['ок без п.2', { kind: 'without', n: 2 }],
    ['ок + 4', { kind: 'plus', n: 4 }],
    ['ок +4', { kind: 'plus', n: 4 }],
    ['ок плюс 4', { kind: 'plus', n: 4 }],
    ['ок 84,90', { kind: 'amount', amount: 84.9 }],
    ['ок 84.90 zł', { kind: 'amount', amount: 84.9 }],
    ['«ок 120»', { kind: 'amount', amount: 120 }],
    ['нет', { kind: 'no' }],
    ['Нет.', { kind: 'no' }],
    ['no', { kind: 'no' }],
    ['лимит позиции 120', { kind: 'limit_item', amount: 120 }],
    ['ок лимит позиции 120', { kind: 'limit_item', amount: 120 }],
    ['лимит заказа 150', { kind: 'limit_order', amount: 150 }],
    ['лимит заказа 150,50 PLN', { kind: 'limit_order', amount: 150.5 }],
    ['да', { kind: 'unknown' }],
    ['ок C', { kind: 'unknown' }],
    ['ок без', { kind: 'unknown' }],
    ['купи что-нибудь', { kind: 'unknown' }],
    ['', { kind: 'unknown' }],
  ];
  it.each(cases)('parses %j', (text, expected) => {
    expect(parseReply(text)).toMatchObject({ ...expected, raw: text });
  });
  it('a bare «ок» (or A) with needs_override is unknown; an amount, B, «без N» and «нет» still parse', () => {
    expect(parseReply('ок', { needsOverride: true }).kind).toBe('unknown');
    expect(parseReply('ok', { needsOverride: true }).kind).toBe('unknown');
    expect(parseReply('A', { needsOverride: true }).kind).toBe('unknown');
    expect(parseReply('ок A', { needsOverride: true }).kind).toBe('unknown');
    expect(parseReply('ок 84,90', { needsOverride: true })).toMatchObject({ kind: 'amount', amount: 84.9 });
    expect(parseReply('ок B', { needsOverride: true }).kind).toBe('B');
    expect(parseReply('ок без 1', { needsOverride: true })).toMatchObject({ kind: 'without', n: 1 });
    expect(parseReply('нет', { needsOverride: true }).kind).toBe('no');
  });
});

describe('applyReply — from the reply to the final basket', () => {
  const resolveOpts = { threshold: T, ...LIMITS, maxComplements: 1 };
  it('A adds the default complement and ships free; B keeps the paid delivery; A/B records the fallback', () => {
    const { plan, proposal } = specExample();
    const a = applyReply(plan, proposal, parseReply('ок'), resolveOpts);
    if ('error' in a) throw new Error(a.error);
    expect(a).toMatchObject({ variant: 'A', seller: 'MILWAR_POLSKA', subtotal_pln: 53.2, expected_pln: 53.2, ceiling_pln: 86.05, free_delivery: true, needs_override: false, aggregate_exceeded: false, other_orders: [] });
    expect(a.items.map((l) => [l.n, l.id, l.complement ?? false])).toEqual([
      [1, '101', false],
      [2, '102', false],
      [3, '103', true],
    ]);
    expect(a.complement).toMatchObject({ id: '103', tier: 1, bought_before: true });
    expect(a.fallback_option).toBeUndefined();
    const b = applyReply(plan, proposal, parseReply('ок B'), resolveOpts);
    if ('error' in b) throw new Error(b.error);
    expect(b).toMatchObject({ variant: 'B', subtotal_pln: 29.5, expected_pln: 40.45, ceiling_pln: 51.4, free_delivery: false });
    expect(b.items).toHaveLength(2);
    const ab = applyReply(plan, proposal, parseReply('ок A/B'), resolveOpts);
    if ('error' in ab) throw new Error(ab.error);
    expect(ab).toMatchObject({ variant: 'A', fallback_option: 'B', expected_pln: 53.2 });
  });

  it('«без N» drops a line or the complement; «+ N» swaps in an alternative; unknown lines are errors', () => {
    const { plan, proposal } = specExample();
    const noComp = applyReply(plan, proposal, parseReply('ок без 3'), resolveOpts);
    if ('error' in noComp) throw new Error(noComp.error);
    expect(noComp).toMatchObject({ variant: 'B', expected_pln: 40.45 });
    const noLine = applyReply(plan, proposal, parseReply('ок без 1'), resolveOpts);
    if ('error' in noLine) throw new Error(noLine.error);
    expect(noLine.items.map((l) => [l.n, l.id])).toEqual([
      [1, '102'],
      [2, '103'],
    ]);
    expect(noLine).toMatchObject({ subtotal_pln: 40.7, free_delivery: false, expected_pln: 51.65 });
    const alt = applyReply(plan, proposal, parseReply('ок + 4'), resolveOpts);
    if ('error' in alt) throw new Error(alt.error);
    expect(alt.items.map((l) => l.id)).toEqual(['101', '102', '104']);
    expect(alt).toMatchObject({ subtotal_pln: 51.4, free_delivery: true, expected_pln: 51.4 });
    expect(applyReply(plan, proposal, parseReply('ок без 9'), resolveOpts)).toEqual({ error: 'there is no line 9 in the proposal' });
    expect(applyReply(plan, proposal, parseReply('ок + 9'), resolveOpts)).toEqual({ error: 'there is no complement 9 in the proposal' });
    expect(applyReply(plan, proposal, parseReply('нет'), resolveOpts)).toMatchObject({ error: expect.stringContaining('does not approve') });
    const none = applyReply(plan, proposal, parseReply('ок'), { ...resolveOpts, maxComplements: 0 });
    if ('error' in none) throw new Error(none.error);
    expect(none.items).toHaveLength(2);
  });

  it('carries the one-time approval amount and binds it to the over-limit line; the aggregate limit is never overridden', () => {
    const plan = planBaskets([{ label: 'n1' }], [offer('q1', { price_pln: 84.9, seller: 'Q', need: 'n1' })], { threshold: T, ...LIMITS });
    const proposal = proposeComplements(plan, [], { threshold: T, slack: 25 });
    const r = applyReply(plan, proposal, parseReply('ок 84,90', { needsOverride: true }), resolveOpts);
    if ('error' in r) throw new Error(r.error);
    expect(r).toMatchObject({ needs_override: true, override_required_pln: 84.9, override_offer_id: 'q1', override_pln: 84.9, expected_pln: 84.9 });
    const agg = applyReply(plan, proposal, parseReply('ок 84,90', { needsOverride: true }), { ...resolveOpts, remainingAggregate: 50 });
    if ('error' in agg) throw new Error(agg.error);
    expect(agg.aggregate_exceeded).toBe(true);
    // removing the offending line clears the override need
    const two = planBaskets(NEEDS, [offer('q1', { price_pln: 84.9, seller: 'Q', need: 'n1' }), offer('q2', { price_pln: 20, seller: 'Q', need: 'n2' })], { threshold: T, ...LIMITS });
    const fixed = applyReply(two, proposeComplements(two, [], { threshold: T, slack: 25 }), parseReply('ок без 1', { needsOverride: true }), resolveOpts);
    if ('error' in fixed) throw new Error(fixed.error);
    expect(fixed).toMatchObject({ needs_override: false, expected_pln: 30.95 });
  });
});
