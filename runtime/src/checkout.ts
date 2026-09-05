/**
 * Deterministic checkout runner (flows/checkout.md) for channel B. One step per CLI call:
 *   asa checkout --step N
 * Each step writes .state/step-result.json; a step the runtime cannot resolve mechanically writes a
 * redacted a11y snapshot and returns EXIT.DECISION (3) so the session decides and reruns it.
 *
 * Money rules enforced here, not in the skill text:
 *   - the pay button is clicked only after a GREEN full mandate check on the final total;
 *   - HUMAN_CONFIRM=1 stops before the pay button (status "human-confirm");
 *   - any host outside the allowlist during payment = 3DS hand-off: no reads, no clicks, wait <= 5 min;
 *   - a declined payment or a 3DS timeout is a STOP with no retry on any rail.
 */
import type { Page } from 'playwright';
import { hostAllowed, hostOf, urlAllowed, DEFAULT_ALLOWLIST } from './allowlist.js';
import type { AuditLog } from './audit.js';
import { detectBlock, detectLoggedIn, sleep } from './browser.js';
import type { Rail, RuntimeConfig } from './config.js';
import { checkMandate, formatCheck, warsawDate } from './mandate.js';
import { parsePln } from './offers.js';
import { appendPurchase } from './profile.js';
import { resolveSelector, type SelectorMap } from './selectors.js';
import { EXIT, readState, writeAriaSnapshot, writeState, writeStepResult, stripQuery, type StepStatus } from './state.js';
import { StopError, type RunContext } from './stop.js';

export const FLOW = 'checkout';
export type { Rail };

export interface SelectedOffer {
  id: string;
  url: string;
  title: string;
  /** Ceiling agreed at selection time (price + delivery as shown on the listing). */
  total_pln: number;
  /** Item price without delivery (checked against the per-item limit when the mandate has one). */
  price_pln?: number;
  seller: string;
  category: string;
  rationale?: string;
  /** Concrete offer id seen on the product page (data-analytics-interaction-value of #add-to-cart-button). */
  offer_id?: string;
  /** Total actually shown at cart / checkout (may be lower than total_pln, e.g. Smart delivery applied). */
  actual_total_pln?: number;
}

export interface CheckoutEnv {
  page: Page;
  cfg: RuntimeConfig;
  audit: AuditLog;
  selectors: SelectorMap;
  ctx: RunContext;
  selected: SelectedOffer;
  rail: Rail;
  redactValues: readonly string[];
  /** Pause between actions (human pace). Default 1200 ms. */
  paceMs?: number;
  /** Offline tests only: allow file:// fixture pages. Never set in production. */
  offlineFixtures?: boolean;
}

export interface StepOutcome {
  code: number;
  status: StepStatus;
  note?: string;
  data?: Record<string, unknown>;
}

export const STEP_NAMES: Record<number, string> = {
  1: 'open-offer',
  2: 'add-to-cart',
  3: 'cart-check',
  4: 'go-to-delivery',
  5: 'address-check',
  6: 'delivery-option',
  7: 'payment-method',
  8: 'mandate-gate',
  9: 'pay',
  10: 'confirm',
};

function allowlist(env: CheckoutEnv): string[] {
  return [...DEFAULT_ALLOWLIST, ...env.selectors.domains];
}

function urlOk(env: CheckoutEnv, url: string): boolean {
  if (env.offlineFixtures && url.startsWith('file:///')) return true;
  return urlAllowed(url, allowlist(env));
}

async function guardPage(env: CheckoutEnv, step: number): Promise<void> {
  const url = env.page.url();
  if (!urlOk(env, url)) throw new StopError('domain_not_allowlisted', { host: hostOf(url), step });
  const block = await detectBlock(env.page);
  if (block.blocked) throw new StopError('captcha_or_antibot', { marker: block.marker, step });
}

async function click(env: CheckoutEnv, id: string, step: number): Promise<boolean> {
  const r = await resolveSelector(env.page, env.selectors, id);
  if (r.status === 'nl') {
    await needsDecision(env, step, `selector "${id}" unresolved (tried: ${r.tried.join(', ') || 'nothing'}); NL: ${r.fallback_nl ?? ''}`);
    return false;
  }
  await r.locator.click({ timeout: 10_000 });
  await sleep(env.paceMs ?? 1200);
  return true;
}

async function needsDecision(env: CheckoutEnv, step: number, note: string): Promise<void> {
  const snap = await writeAriaSnapshot(env.page, `snapshot-${FLOW}-${step}`, env.redactValues);
  writeStepResult({ flow: FLOW, step, status: 'needs-decision', url: stripQuery(env.page.url()), note, snapshot: snap });
  env.audit.append({ ...env.ctx, event: 'checkout_step', flow: FLOW, step, data: { status: 'needs-decision', note } });
}

/** Read the final amount shown on the page ("Do zapłaty", "Razem", "Łącznie"). In-process only. */
async function readPageTotal(page: Page): Promise<number | null> {
  const text: string = await page.evaluate(() => ((document.body && (document.body as HTMLElement).innerText) || '').slice(0, 60000));
  const patterns = [/do zap[łl]aty[^0-9]{0,40}(\d[\d  ]*(?:[.,]\d{1,2})?)\s*z[łl]/i, /(?:razem|[łl][ąa]cznie|suma)[^0-9]{0,40}(\d[\d  ]*(?:[.,]\d{1,2})?)\s*z[łl]/i];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return parsePln(m[1]);
  }
  return null;
}

/** Recipient block check: compares in-process against REF_* and returns only a boolean. */
async function recipientMatches(env: CheckoutEnv): Promise<{ ok: boolean; missingRef: boolean }> {
  const { cfg } = env;
  if (!cfg.refFullName || (!cfg.refDeliveryAddress && !cfg.refPickupPoint)) return { ok: false, missingRef: true };
  const text: string = await env.page.evaluate(() => ((document.body && (document.body as HTMLElement).innerText) || '').replace(/\s+/g, ' '));
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const t = norm(text);
  const nameOk = t.includes(norm(cfg.refFullName));
  const addrOk = (cfg.refDeliveryAddress && t.includes(norm(cfg.refDeliveryAddress))) || (cfg.refPickupPoint && t.includes(norm(cfg.refPickupPoint)));
  return { ok: Boolean(nameOk && addrOk), missingRef: false };
}

function gate(env: CheckoutEnv, amount: number): { ok: boolean; text: string } {
  const spent = env.audit.spentPln(env.ctx.mandate_id);
  const override = readState<{ run_id: string; amount_pln: number; approved_by: string; offer_id?: string }>('override.json');
  const overrideApplies = !!override && override.run_id === env.ctx.run_id && (!override.offer_id || override.offer_id === env.selected.id || override.offer_id === env.selected.offer_id);
  const overridePln = overrideApplies ? override!.amount_pln : undefined;
  const res = checkMandate({ config: env.cfg, amountPln: amount, itemPln: env.selected.price_pln, overridePln, category: env.selected.category, domain: 'allegro.pl', spentPln: spent });
  env.audit.append({ ...env.ctx, event: 'mandate_checked', flow: FLOW, step: 8, data: { ok: res.ok, amount_pln: amount, item_pln: env.selected.price_pln, spent_pln: spent, remaining_pln: res.remainingPln, override_pln: overridePln, override_by: overridePln !== undefined ? override?.approved_by : undefined, failed: res.items.filter((i) => !i.ok).map((i) => i.id) } });
  return { ok: res.ok, text: formatCheck(res) };
}

export async function runStep(env: CheckoutEnv, step: number): Promise<StepOutcome> {
  const { page, audit, ctx, selected } = env;
  const done = (status: StepStatus, note?: string, data?: Record<string, unknown>): StepOutcome => {
    writeStepResult({ flow: FLOW, step, status, url: stripQuery(page.url()), note, data });
    audit.append({ ...ctx, event: 'checkout_step', flow: FLOW, step, data: { status, name: STEP_NAMES[step], ...(data ?? {}) } });
    return { code: status === 'ok' ? EXIT.OK : status === 'human-confirm' ? EXIT.OK : EXIT.DECISION, status, note, data };
  };

  switch (step) {
    case 1: {
      if (!urlOk(env, selected.url)) throw new StopError('domain_not_allowlisted', { host: hostOf(selected.url), step });
      await page.goto(selected.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await sleep(env.paceMs ?? 1200);
      await guardPage(env, step);
      if (!(await detectLoggedIn(page))) throw new StopError('logged_out', { step });
      const offerId = await readOfferId(page);
      if (offerId) {
        selected.offer_id = offerId;
        writeState('selected.json', selected);
      }
      return done('ok', 'offer page open, logged in', offerId ? { offer_id: offerId } : undefined);
    }
    case 2: {
      await guardPage(env, step);
      if (await click(env, 'buy_now', step)) return done('ok', 'buy_now clicked');
      return { code: EXIT.DECISION, status: 'needs-decision' };
    }
    case 3: {
      await guardPage(env, step);
      const total = await readPageTotal(page);
      if (total === null) {
        await needsDecision(env, step, 'cart total not found on page');
        return { code: EXIT.DECISION, status: 'needs-decision' };
      }
      if (total > selected.total_pln + 0.01) throw new StopError('mandate_deviation', { step, expected_pln: selected.total_pln, seen_pln: total });
      selected.actual_total_pln = total;
      writeState('selected.json', selected);
      return done('ok', total < selected.total_pln ? 'cart total below the selected ceiling' : 'cart total matches selected offer', { total_pln: total });
    }
    case 4: {
      await guardPage(env, step);
      if (await click(env, 'cart_go_checkout', step)) return done('ok', 'moved to delivery');
      return { code: EXIT.DECISION, status: 'needs-decision' };
    }
    case 5: {
      await guardPage(env, step);
      const r = await recipientMatches(env);
      if (r.missingRef) throw new StopError('mandate_deviation', { step, reason: 'REF_* not captured; run `asa ref:capture` first' });
      if (!r.ok) throw new StopError('mandate_deviation', { step, reason: 'recipient/address differs from REF_*' });
      return done('ok', 'recipient and address match the reference');
    }
    case 6: {
      await guardPage(env, step);
      if (await click(env, 'delivery_option', step)) return done('ok', 'delivery option selected');
      return { code: EXIT.DECISION, status: 'needs-decision' };
    }
    case 7: {
      await guardPage(env, step);
      const id = env.rail === 'allegro_pay' ? 'payment_allegro_pay' : 'payment_oneclick_card';
      if (await click(env, id, step)) return done('ok', `payment method ${env.rail} selected`);
      return { code: EXIT.DECISION, status: 'needs-decision' };
    }
    case 8: {
      await guardPage(env, step);
      const total = (await readPageTotal(page)) ?? selected.actual_total_pln ?? selected.total_pln;
      if (total > selected.total_pln + 0.01) throw new StopError('mandate_deviation', { step, expected_pln: selected.total_pln, seen_pln: total });
      selected.actual_total_pln = total;
      writeState('selected.json', selected);
      const g = gate(env, total);
      process.stdout.write(g.text + '\n');
      if (!g.ok) throw new StopError('mandate_red', { step, amount_pln: total });
      if (env.cfg.humanConfirm) {
        audit.append({ ...ctx, event: 'stop', flow: FLOW, step, data: { reason: 'human_confirm_flag', amount_pln: total } });
        return done('human-confirm', 'HUMAN_CONFIRM=1: the user presses "Kupuję i płacę" in the browser window', { amount_pln: total });
      }
      return done('ok', 'mandate gate GREEN', { amount_pln: total });
    }
    case 9: {
      await guardPage(env, step);
      const total = (await readPageTotal(page)) ?? selected.actual_total_pln ?? selected.total_pln;
      if (total > selected.total_pln + 0.01) throw new StopError('mandate_deviation', { step, expected_pln: selected.total_pln, seen_pln: total });
      const g = gate(env, total);
      if (!g.ok) throw new StopError('mandate_red', { step, amount_pln: total });
      if (env.cfg.humanConfirm) return done('human-confirm', 'HUMAN_CONFIRM=1: not clicking the pay button', { amount_pln: total });
      if (!(await click(env, 'pay_button', step))) return { code: EXIT.DECISION, status: 'needs-decision' };
      audit.append({ ...ctx, event: 'pay_clicked', flow: FLOW, step, data: { amount_pln: total, rail: env.rail } });
      const wait = await waitForPaymentOutcome(env);
      if (wait.outcome === 'declined') throw new StopError('payment_declined', { step });
      if (wait.outcome === 'timeout') throw new StopError('3ds_timeout', { step, waited_ms: wait.waitedMs });
      return done('ok', wait.challenged ? 'paid after a 3DS hand-off' : 'paid without a challenge', { challenged: wait.challenged, waited_ms: wait.waitedMs });
    }
    case 10: {
      await guardPage(env, step);
      const orderId = await readOrderId(page);
      if (!orderId) {
        await needsDecision(env, step, 'order id not found on the confirmation page');
        return { code: EXIT.DECISION, status: 'needs-decision' };
      }
      const amount = selected.actual_total_pln ?? selected.total_pln;
      audit.append({ ...ctx, event: 'order_confirmed', flow: FLOW, step, data: { order_id: orderId, amount_pln: amount, seller: selected.seller, offer_url: selected.url, offer_id: selected.offer_id, title: selected.title } });
      // the purchase history the next context brief reads: one line per confirmed order (profile.ts)
      let historyAppended = false;
      try {
        appendPurchase(env.cfg.shoppingProfileDir, { date: warsawDate(), seller: selected.seller, title: selected.title, qty: 1, price_pln: selected.price_pln ?? amount, category: selected.category, offer_id: selected.offer_id, source: 'runtime', order_id: orderId });
        historyAppended = true;
      } catch (e) {
        process.stderr.write(`warning: purchase history not appended: ${(e as Error).message}\n`);
      }
      return done('ok', `order ${orderId} confirmed`, { order_id: orderId, amount_pln: amount, history_appended: historyAppended });
    }
    default:
      throw new Error(`unknown checkout step ${step} (1-10)`);
  }
}

export interface PaymentWait {
  outcome: 'confirmed' | 'declined' | 'timeout';
  challenged: boolean;
  waitedMs: number;
}

/**
 * After the pay click: poll the URL only. On an allowlisted host read the page for a confirmation or a
 * decline; on any other host (the bank's ACS) read nothing and click nothing — that is the 3DS hand-off.
 */
export async function waitForPaymentOutcome(env: CheckoutEnv, maxMs = 5 * 60_000): Promise<PaymentWait> {
  const { page, audit, ctx } = env;
  const hosts = allowlist(env);
  const started = Date.now();
  let challenged = false;
  let offPlatform = false;
  while (Date.now() - started < maxMs) {
    const host = hostOf(page.url());
    if (host && !hostAllowed(host, hosts)) {
      if (!offPlatform) {
        offPlatform = true;
        challenged = true;
        audit.append({ ...ctx, event: 'challenge_3ds', flow: FLOW, step: 9, data: { phase: 'start' } });
        process.stdout.write('3DS: confirm the payment in your banking app (waiting up to 5 minutes)\n');
      }
      await sleep(2000);
      continue;
    }
    if (offPlatform) {
      offPlatform = false;
      audit.append({ ...ctx, event: 'challenge_3ds', flow: FLOW, step: 9, data: { phase: 'done' } });
    }
    const verdict = await page.evaluate(() => {
      const t = ((document.body && (document.body as HTMLElement).innerText) || '').toLowerCase();
      if (/odrzucon|nie uda[łl]o si[ęe] zap[łl]aci|p[łl]atno[śs][ćc] nieudana|payment (?:failed|declined)/.test(t)) return 'declined';
      if (/dzi[ęe]kujemy za zakup|zam[óo]wienie z[łl]o[żz]one|numer zam[óo]wienia|op[łl]acone|p[łl]atno[śs][ćc] przyj[ęe]ta/.test(t)) return 'confirmed';
      return 'pending';
    });
    if (verdict === 'declined') return { outcome: 'declined', challenged, waitedMs: Date.now() - started };
    if (verdict === 'confirmed') return { outcome: 'confirmed', challenged, waitedMs: Date.now() - started };
    await sleep(2000);
  }
  return { outcome: 'timeout', challenged, waitedMs: Date.now() - started };
}

/** Product page: the concrete offer id sits on the add-to-cart button (recorded 2026-09-04). Read-only. */
export async function readOfferId(page: Page): Promise<string | null> {
  const fromUrl = /\/oferta\/(?:.*-)?(\d{6,})/.exec(page.url());
  if (fromUrl) return fromUrl[1];
  return page.evaluate(() => {
    const b = document.querySelector('#add-to-cart-button');
    const v = b ? b.getAttribute('data-analytics-interaction-value') : null;
    return v && /^\d{6,}$/.test(v) ? v : null;
  });
}

export async function readOrderId(page: Page): Promise<string | null> {
  const fromUrl = /(?:order|zamowieni[ae]|checkout)[^0-9a-f]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{6,})/i.exec(page.url());
  if (fromUrl) return fromUrl[1];
  const text: string = await page.evaluate(() => ((document.body && (document.body as HTMLElement).innerText) || '').slice(0, 60000));
  const m = /numer zam[óo]wienia[^0-9a-f]{0,20}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{6,})/i.exec(text);
  return m ? m[1] : null;
}
