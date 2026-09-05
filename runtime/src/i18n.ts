/**
 * Tiny i18n helper for the strings the runtime shows to people: the basket proposal, the feedback
 * to a reply, the mandate lines written by `mandate:amend` / `mandate:sign`.
 *
 * English is the default. Russian is selected with `ASA_LANG=ru` (a config.env key or an environment
 * variable, the variable wins). Parsers stay bilingual whatever the configured language: an existing
 * Russian mandate, a Russian reply («ок без 3») or Polish/Russian notes are always accepted on read.
 */
export type Lang = 'en' | 'ru';
export const LANGS: readonly Lang[] = ['en', 'ru'];
export const DEFAULT_LANG: Lang = 'en';

let current: Lang = DEFAULT_LANG;

export function parseLang(raw: string | undefined): Lang | undefined {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'en' || v === 'ru' ? v : undefined;
}

/** Set the language for every following `t()` call; unknown values fall back to English. */
export function setLang(lang: string | undefined): Lang {
  current = parseLang(lang) ?? DEFAULT_LANG;
  return current;
}

export function getLang(): Lang {
  return current;
}

type Dict = Record<string, string>;

const EN: Dict = {
  // basket proposal (basket.ts formatPlan)
  'plan.header': '🛒 Proposal #{runId} · {seller} ({sellerNote}) · {delivery} · {rail}',
  'plan.seller_unknown': '(seller unknown)',
  'plan.no_offer': '🛒 Proposal #{runId}: no offer covers the needs ({needs}).',
  'plan.no_offer_reply': 'Reply: "no" or give another query.',
  'plan.smart': 'Smart!',
  'plan.no_smart': 'no Smart!',
  'plan.bought_dates': 'bought {dates}',
  'plan.and': ' and ',
  'plan.new_seller': 'new seller',
  'plan.line': '{n}. {title} — {price}   [need: {source}]',
  'plan.other_order': 'Order {n} · {seller} ({smart}) — separate delivery, the seller has its own threshold:',
  'plan.free': 'Items {subtotal} ≥ threshold {threshold} → Smart! delivery 0.00.',
  'plan.gap': 'Items {subtotal} → {delta} short of the {threshold} threshold.',
  'plan.not_all_smart': 'Items {subtotal}; not every line is Smart! → delivery {delivery}.',
  'plan.complement': '{n}. (+) {title} — {price}  [{reason}; tier {tier}]',
  'plan.ab': 'A: with #{n} = {newSubtotal} + delivery 0 = {newSubtotal} zł  ← default     B: without #{n} = {subtotal} + {delivery} = {expected} zł',
  'plan.alts': 'Instead of #{n} you can also take: {alts}',
  'plan.alt': '{n}) {title} — {price} [tier {tier}]',
  'plan.free_a': 'A: {subtotal} + delivery 0 (Smart!) = {subtotal} zł  ← default',
  'plan.a_no_complement': 'A: {subtotal} + delivery {delivery} = {expected} zł  ← default (no complement: {why})',
  'plan.why_over_slack': 'more than {amount} short of the threshold',
  'plan.why_not_smart': 'not every line is Smart!',
  'plan.why_none': 'nothing suitable at this seller',
  'plan.total_all': 'All orders together: expected {expected} zł, ceiling {ceiling} zł.',
  'plan.facts': 'Facts from your notes: {list}.',
  'plan.assumptions': 'Assumptions from your notes: {list}.',
  'plan.none': 'none',
  'plan.context_skipped': '⚠ context not consulted: {reason}',
  'plan.open_question': 'not derived: {text} — record the answer in your notes and the next run will use it',
  'plan.critical_unknown': 'not taken (critical parameter unknown): {need} — {question}; record the answer in your notes and rerun',
  'plan.session_assumption': '{text} (session)',
  'plan.over_item': '⚠️ #{line} {value} > item limit {limit} → reply "ok {required}" (one-time) or "item limit {suggest}" (permanent)',
  'plan.over_order': '⚠️ order {value} > order limit {limit} → reply "ok {required}" (one-time) or "order limit {suggest}" (permanent)',
  'plan.over_items': '⚠️ {value} lines > limit {limit} → reply "ok without N" (drop a line) or raise the limit: asa mandate:amend --max-items {value}',
  'plan.over_aggregate': '⛔ remaining mandate {limit} < {value} — a one-time approval never covers the aggregate limit; "no" or a new limit: asa mandate:amend --total N',
  'plan.limits': 'Limits: item {item} · order {order} · lines {lines} · remaining mandate {remaining}.',
  'plan.no_limit': 'no limit',
  'plan.reply_aggregate': 'Reply: "no" · "ok without N" (drop a line) — an amount above the remaining mandate cannot be approved with a one-time "ok".',
  'plan.reply_override': 'Reply: {parts} — a bare "ok" is not accepted',
  'plan.reply': 'Reply: {parts}',
  'plan.r_amount': '"ok {amount}" (one-time)',
  'plan.r_item_limit_perm': '"item limit {n}" (permanent)',
  'plan.r_order_limit_perm': '"order limit {n}" (permanent)',
  'plan.r_without_n': '"ok without N"',
  'plan.r_no': '"no"',
  'plan.r_ok_a': '"ok" (=A)',
  'plan.r_ok_b': '"ok B"',
  'plan.r_ok_ab': '"ok A/B" (A; if Smart! does not apply — B)',
  'plan.r_without': '"ok without {n}"',
  'plan.r_plus': '"ok + {n}"',
  'plan.r_item_limit': '"item limit {n}"',
  // complement reasons (basket.ts proposeComplements)
  'reason.bought_before': 'bought from this seller{date}',
  'reason.bought_on': ' on {date}',
  'reason.wishlist': 'on the wishlist',
  'reason.same_category': 'same category',
  // payment rails
  'rail.oneclick_card': 'one-click card',
  'rail.allegro_pay': 'Allegro Pay',
  // basket:approve feedback (cli.ts)
  'approve.not_understood': 'not understood: {why}',
  'approve.closed': 'run closed: "no" — nothing bought, no basket assembled',
  'approve.limit_item': 'item limit → {amount} PLN: run\n  asa mandate:amend --per-item {amount}\nthen show the new hash, wait for "ok <hash8>" and run asa mandate:sign --by "{by}" --hash <sha256>; after that rerun asa basket:plan',
  'approve.limit_order': 'order limit → {amount} PLN: run\n  asa mandate:amend --per-order {amount}\nthen show the new hash, wait for "ok <hash8>" and run asa mandate:sign --by "{by}" --hash <sha256>; after that rerun asa basket:plan',
  'approve.needs_amount': 'the proposal needs a one-time approval with an amount ("ok <amount>"); a bare "ok" is not accepted',
  'approve.unknown_reply': 'reply "{reply}" not recognised',
  'approve.still_over': 'after "{reply}" the limits are still exceeded — reply "ok {need}" (one-time) or "item limit N" / "order limit N"',
  'approve.amount_too_small': '"ok {amount}" is below the required {need} PLN',
  'approve.amount_not_needed': '("ok {amount}": no limit is exceeded, no one-time approval needed — approving as A)',
  'approve.approved': 'basket approved ({variant}{fallback}): {count} line(s) at {seller}, items {subtotal}, expected {expected}, ceiling {ceiling} PLN{free}',
  'approve.fallback': ', fallback option {option}',
  'approve.free': ' (Smart! delivery 0)',
  'approve.other_orders': '{n} more order(s) at other sellers — a separate run for each',
  'approve.multi_line_note': '(checkout of several lines in one order is not implemented in this increment: steps 1–10 lead the first line; the rest by hand or in the next increment)',
  // mandate lines written by amend / sign (amend.ts); the parser accepts both languages
  'mandate.per_item': '- Single-item limit: ≤ {n} PLN',
  'mandate.per_order': '- Single-order limit: ≤ {n} PLN',
  'mandate.max_items': '- Lines per order: ≤ {n} lines',
  'mandate.aggregate': '- Aggregate mandate limit: ≤ {n} PLN',
  'mandate.override_max': '- One-time approvals over the limit: allowed up to ≤ {n} PLN',
  'mandate.validity': '- Validity period: from {from} to {to}',
  'mandate.categories': '- Categories: {list}',
  'mandate.marketplaces': '- Marketplaces (allowlist): {list}',
  'mandate.signed': 'Signed: {signer}, {when}',
  'mandate.sha': 'SHA-256 of sections 1–6: {hash}',
};

const RU: Dict = {
  'plan.header': '🛒 Предложение #{runId} · {seller} ({sellerNote}) · {delivery} · {rail}',
  'plan.seller_unknown': '(продавец неизвестен)',
  'plan.no_offer': '🛒 Предложение #{runId}: ни один оффер не покрывает нужное ({needs}).',
  'plan.no_offer_reply': 'Ответь: «нет» или дай другой запрос.',
  'plan.smart': 'Smart!',
  'plan.no_smart': 'без Smart!',
  'plan.bought_dates': 'покупал {dates}',
  'plan.and': ' и ',
  'plan.new_seller': 'новый продавец',
  'plan.line': '{n}. {title} — {price}   [нужно: {source}]',
  'plan.other_order': 'Заказ {n} · {seller} ({smart}) — отдельная доставка, порог у продавца свой:',
  'plan.free': 'Товары {subtotal} ≥ порога {threshold} → доставка Smart! 0,00.',
  'plan.gap': 'Товары {subtotal} → до порога {threshold} не хватает {delta}.',
  'plan.not_all_smart': 'Товары {subtotal}; не все позиции Smart! → доставка {delivery}.',
  'plan.complement': '{n}. (+) {title} — {price}  [{reason}; ярус {tier}]',
  'plan.ab': 'A: с п.{n} = {newSubtotal} + доставка 0 = {newSubtotal} zł  ← по умолчанию     B: без п.{n} = {subtotal} + {delivery} = {expected} zł',
  'plan.alts': 'Ещё можно вместо п.{n}: {alts}',
  'plan.alt': '{n}) {title} — {price} [ярус {tier}]',
  'plan.free_a': 'A: {subtotal} + доставка 0 (Smart!) = {subtotal} zł  ← по умолчанию',
  'plan.a_no_complement': 'A: {subtotal} + доставка {delivery} = {expected} zł  ← по умолчанию (довеска нет: {why})',
  'plan.why_over_slack': 'до порога больше {amount}',
  'plan.why_not_smart': 'не все позиции Smart!',
  'plan.why_none': 'нет подходящего у этого продавца',
  'plan.total_all': 'Итого по всем заказам: ожидаемо {expected} zł, потолок {ceiling} zł.',
  'plan.facts': 'Факты из vault: {list}.',
  'plan.assumptions': 'Допущения из vault: {list}.',
  'plan.none': 'нет',
  'plan.context_skipped': '⚠ контекст не сверялся: {reason}',
  'plan.open_question': 'не вывел: {text} — допишу в профиль, если скажешь',
  'plan.critical_unknown': 'не вывел (критичный параметр неизвестен): {need} — {question}; допиши ответ в заметки и повтори',
  'plan.session_assumption': '{text} (сессия)',
  'plan.over_item': '⚠️ п.{line} {value} > лимит позиции {limit} → ответь «ок {required}» (разово) или «лимит позиции {suggest}» (навсегда)',
  'plan.over_order': '⚠️ заказ {value} > лимит заказа {limit} → ответь «ок {required}» (разово) или «лимит заказа {suggest}» (навсегда)',
  'plan.over_items': '⚠️ позиций {value} > лимит {limit} → ответь «ок без N» (убрать строку) или подними лимит: asa mandate:amend --max-items {value}',
  'plan.over_aggregate': '⛔ остаток мандата {limit} < {value} — разовое подтверждение совокупный лимит не покрывает; «нет» или новый лимит: asa mandate:amend --total N',
  'plan.limits': 'Лимиты: позиция {item} · заказ {order} · позиций {lines} · остаток мандата {remaining}.',
  'plan.no_limit': 'без лимита',
  'plan.reply_aggregate': 'Ответь: «нет» · «ок без N» (убрать строку) — сумма сверх остатка мандата не утверждается разовым «ок».',
  'plan.reply_override': 'Ответь: {parts} — голое «ок» не принимается',
  'plan.reply': 'Ответь: {parts}',
  'plan.r_amount': '«ок {amount}» (разово)',
  'plan.r_item_limit_perm': '«лимит позиции {n}» (навсегда)',
  'plan.r_order_limit_perm': '«лимит заказа {n}» (навсегда)',
  'plan.r_without_n': '«ок без N»',
  'plan.r_no': '«нет»',
  'plan.r_ok_a': '«ок» (=A)',
  'plan.r_ok_b': '«ок B»',
  'plan.r_ok_ab': '«ок A/B» (A, если Smart не сработает — B)',
  'plan.r_without': '«ок без {n}»',
  'plan.r_plus': '«ок + {n}»',
  'plan.r_item_limit': '«лимит позиции {n}»',
  'reason.bought_before': 'покупал у него{date}',
  'reason.bought_on': ' {date}',
  'reason.wishlist': 'из списка нужного',
  'reason.same_category': 'та же категория',
  'rail.oneclick_card': 'карта one-click',
  'rail.allegro_pay': 'Allegro Pay',
  'approve.not_understood': 'не понял: {why}',
  'approve.closed': 'прогон закрыт: «нет» — ничего не куплено, корзина не собрана',
  'approve.limit_item': 'лимит позиции → {amount} PLN: выполни\n  asa mandate:amend --per-item {amount}\nзатем покажи новый хэш, дождись «ок <hash8>» и выполни asa mandate:sign --by "{by}" --hash <sha256>; после этого повтори asa basket:plan',
  'approve.limit_order': 'лимит заказа → {amount} PLN: выполни\n  asa mandate:amend --per-order {amount}\nзатем покажи новый хэш, дождись «ок <hash8>» и выполни asa mandate:sign --by "{by}" --hash <sha256>; после этого повтори asa basket:plan',
  'approve.needs_amount': 'предложение требует разового подтверждения суммой («ок <сумма>»), голое «ок» не принимается',
  'approve.unknown_reply': 'ответ «{reply}» не распознан',
  'approve.still_over': 'после «{reply}» лимиты всё ещё превышены — нужно «ок {need}» (разово) или «лимит позиции/заказа N»',
  'approve.amount_too_small': '«ок {amount}» меньше требуемых {need} PLN',
  'approve.amount_not_needed': '(«ок {amount}»: лимиты не превышены, разовое подтверждение не требуется — утверждаю как A)',
  'approve.approved': 'корзина утверждена ({variant}{fallback}): {count} поз. у {seller}, товары {subtotal}, ожидаемо {expected}, потолок {ceiling} PLN{free}',
  'approve.fallback': ', запасной вариант {option}',
  'approve.free': ' (Smart! доставка 0)',
  'approve.other_orders': 'ещё {n} заказ(а) у других продавцов — отдельный прогон каждый',
  'approve.multi_line_note': '(checkout нескольких строк в одном заказе в этом инкременте не реализован: шаги 1–10 ведут первую строку; остальные — вручную или в следующем инкременте)',
  'mandate.per_item': '- Лимит одной позиции: ≤ {n} PLN',
  'mandate.per_order': '- Лимит одной покупки (заказа): ≤ {n} PLN',
  'mandate.max_items': '- Лимит позиций в заказе: ≤ {n} шт',
  'mandate.aggregate': '- Совокупный лимит мандата: ≤ {n} PLN',
  'mandate.override_max': '- Разовое подтверждение сверх лимита: разрешено до ≤ {n} PLN',
  'mandate.validity': '- Срок действия: с {from} по {to}',
  'mandate.categories': '- Категории: {list}',
  'mandate.marketplaces': '- Площадки (allowlist): {list}',
  'mandate.signed': 'Подписано: {signer}, {when}',
  'mandate.sha': 'SHA-256 разделов 1–6: {hash}',
};

const DICTS: Record<Lang, Dict> = { en: EN, ru: RU };

/** Translate `key` in the current (or given) language; `{name}` placeholders are filled from `params`. */
export function t(key: string, params?: Record<string, string | number>, lang?: Lang): string {
  const d = DICTS[lang ?? current];
  let s = d[key] ?? EN[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Money formatting: "12.50" in English, "12,50" in Russian (the reply grammar accepts both). */
export function money(n: number, lang?: Lang): string {
  const s = n.toFixed(2);
  return (lang ?? current) === 'ru' ? s.replace('.', ',') : s;
}
