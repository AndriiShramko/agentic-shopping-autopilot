import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/audit.js';
import { readOrderId, runStep, waitForPaymentOutcome, type CheckoutEnv } from '../src/checkout.js';
import { loadConfig } from '../src/config.js';
import { computeMandateHash } from '../src/mandate.js';
import { loadSelectors } from '../src/selectors.js';
import { EXIT, readStepResult, STATE_DIR } from '../src/state.js';
import { StopError } from '../src/stop.js';
import { FIXTURES, fixtureUrl, MANDATE_LF, tmpDir, withSignedHash, writePrivateRepo } from './helpers.js';

describe('checkout steps on synthetic pages', () => {
  let browser: Browser;
  let page: Page;
  let env: CheckoutEnv;
  let privateDir: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    privateDir = tmpDir();
    const h = computeMandateHash(MANDATE_LF);
    if ('error' in h) throw new Error(h.error);
    writePrivateRepo(privateDir, withSignedHash(MANDATE_LF, h.hash), { MANDATE_SHA256: h.hash, HUMAN_CONFIRM: '0', REF_FULL_NAME: 'Jan Testowy', REF_PICKUP_POINT: 'WAW123A' });
    const cfg = loadConfig({ privateDir });
    env = {
      page,
      cfg,
      audit: new AuditLog(privateDir, ['Jan Testowy', 'WAW123A']),
      selectors: loadSelectors(path.join(FIXTURES, 'selectors.test.yaml')),
      ctx: { run_id: 'run-test', mandate_id: 'PM-TEST-0001', flow: 'checkout' },
      selected: { id: 'fx1', url: fixtureUrl('product.html'), title: 'Wkręty (fixture)', total_pln: 24.99, seller: 'sklep_fixture', category: 'крепёж', rationale: 'test' },
      rail: 'oneclick_card',
      redactValues: ['Jan Testowy', 'WAW123A'],
      paceMs: 10,
      offlineFixtures: true,
    };
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('step 3 (cart-check) accepts a matching total and stops on a deviation', async () => {
    await page.goto(fixtureUrl('cart.html'));
    const ok = await runStep(env, 3);
    expect(ok.status).toBe('ok');
    expect(ok.data).toEqual({ total_pln: 24.99 });
    const sr = readStepResult();
    expect(sr?.status).toBe('ok');
    expect(sr?.step).toBe(3);

    env.selected.total_pln = 19.99;
    await expect(runStep(env, 3)).rejects.toMatchObject({ reason: 'mandate_deviation', details: { expected_pln: 19.99, seen_pln: 24.99 } });
    env.selected.total_pln = 24.99;
  });

  it('step 4 clicks the recorded role selector; an unresolvable step writes a redacted snapshot and exits 3', async () => {
    await page.goto(fixtureUrl('cart.html'));
    const r4 = await runStep(env, 4);
    expect(r4.status).toBe('ok');
    const r6 = await runStep(env, 6); // delivery_option is not in the fixture map
    expect(r6.code).toBe(EXIT.DECISION);
    const sr = readStepResult();
    expect(sr?.status).toBe('needs-decision');
    expect(sr?.snapshot).toBeDefined();
    const snap = fs.readFileSync(sr!.snapshot as string, 'utf8');
    expect(snap).toContain('# url:');
    expect(snap).not.toContain('Jan Testowy');
  });

  it('step 8 (mandate gate) is GREEN on the cart total and honours HUMAN_CONFIRM=1', async () => {
    await page.goto(fixtureUrl('cart.html'));
    const g = await runStep(env, 8);
    expect(g.status).toBe('ok');
    expect(g.data).toEqual({ amount_pln: 24.99 });
    const gated = { ...env, cfg: { ...env.cfg, humanConfirm: true } };
    const h = await runStep(gated, 8);
    expect(h.status).toBe('human-confirm');
    expect(h.code).toBe(EXIT.OK);
    const stops = env.audit.readAll().filter((e) => e.event === 'stop');
    expect(stops.at(-1)?.data).toMatchObject({ reason: 'human_confirm_flag' });
  });

  it('step 8 is RED (STOP mandate_red) when the total exceeds the per-purchase limit', async () => {
    const dir = tmpDir();
    const h = computeMandateHash(MANDATE_LF);
    if ('error' in h) throw new Error(h.error);
    writePrivateRepo(dir, withSignedHash(MANDATE_LF, h.hash), { MANDATE_SHA256: h.hash });
    const bigCart = path.join(dir, 'cart-big.html');
    fs.writeFileSync(bigCart, fs.readFileSync(path.join(FIXTURES, 'html', 'cart.html'), 'utf8').replace(/24,99/g, '74,99'), 'utf8');
    await page.goto('file:///' + bigCart.replace(/\\/g, '/'));
    const e2 = { ...env, cfg: loadConfig({ privateDir: dir }), audit: new AuditLog(dir, []), selected: { ...env.selected, total_pln: 74.99 } };
    await expect(runStep(e2, 8)).rejects.toMatchObject({ reason: 'mandate_red' });
    const checked = e2.audit.readAll().filter((e) => e.event === 'mandate_checked');
    expect(checked[0]?.data).toMatchObject({ ok: false, amount_pln: 74.99, failed: ['amount'] });
  });

  it('step 5 compares the recipient block in-process and never logs it', async () => {
    const dir = tmpDir();
    const html = path.join(dir, 'delivery.html');
    fs.writeFileSync(html, '<html><body><h2>Dane odbiorcy</h2><p>Jan Testowy</p><p>Paczkomat WAW123A, Warszawa</p><p>Wyloguj</p></body></html>', 'utf8');
    await page.goto('file:///' + html.replace(/\\/g, '/'));
    const r = await runStep(env, 5);
    expect(r.status).toBe('ok');
    const raw = fs.readFileSync(env.audit.rawPath('2026-09'), 'utf8') + fs.readFileSync(env.audit.rawPath(AuditLog.monthOf(new Date())), 'utf8');
    expect(raw).not.toContain('Testowy');
    expect(raw).not.toContain('WAW123A');
    fs.writeFileSync(html, '<html><body><h2>Dane odbiorcy</h2><p>Inna Osoba</p><p>Paczkomat KRA999B</p></body></html>', 'utf8');
    await page.goto('file:///' + html.replace(/\\/g, '/'));
    await expect(runStep(env, 5)).rejects.toBeInstanceOf(StopError);
  });

  it('payment wait: confirmation page → confirmed without a challenge; order id parsed', async () => {
    await page.goto(fixtureUrl('confirmation.html'));
    const w = await waitForPaymentOutcome(env, 5000);
    expect(w).toMatchObject({ outcome: 'confirmed', challenged: false });
    expect(await readOrderId(page)).toBe('1234567890');
    const r10 = await runStep(env, 10);
    expect(r10.status).toBe('ok');
    const confirmed = env.audit.readAll().filter((e) => e.event === 'order_confirmed');
    expect(confirmed.at(-1)?.data).toMatchObject({ order_id: '1234567890', amount_pln: 24.99, seller: 'sklep_fixture' });
  });

  it('step 10 appends the confirmed order to purchase-history.jsonl (context-first: the next brief reads it)', async () => {
    await page.goto(fixtureUrl('confirmation.html'));
    const history = path.join(env.cfg.shoppingProfileDir, 'purchase-history.jsonl');
    const before = fs.existsSync(history) ? fs.readFileSync(history, 'utf8').split('\n').filter(Boolean).length : 0;
    const r10 = await runStep(env, 10);
    expect(r10.status).toBe('ok');
    expect(r10.data).toMatchObject({ order_id: '1234567890', history_appended: true });
    const lines = fs.readFileSync(history, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(before + 1);
    const rec = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
    expect(rec).toMatchObject({ seller: 'sklep_fixture', title: 'Wkręty (fixture)', qty: 1, price_pln: 24.99, category: 'крепёж', source: 'runtime', order_id: '1234567890' });
    expect(String(rec.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(rec)).not.toContain('Testowy');
  });

  it('payment wait: declined wording → declined; pending page → timeout', async () => {
    const dir = tmpDir();
    const declined = path.join(dir, 'declined.html');
    fs.writeFileSync(declined, '<html><body><p>Płatność nieudana — transakcja odrzucona przez bank</p></body></html>', 'utf8');
    await page.goto('file:///' + declined.replace(/\\/g, '/'));
    expect((await waitForPaymentOutcome(env, 3000)).outcome).toBe('declined');
    const pending = path.join(dir, 'pending.html');
    fs.writeFileSync(pending, '<html><body><p>Przetwarzamy płatność…</p></body></html>', 'utf8');
    await page.goto('file:///' + pending.replace(/\\/g, '/'));
    const w = await waitForPaymentOutcome(env, 2500);
    expect(w.outcome).toBe('timeout');
    expect(w.waitedMs).toBeGreaterThanOrEqual(2500);
  });

  it('state dir lives under runtime/.state', () => {
    expect(STATE_DIR.replace(/\\/g, '/')).toMatch(/\/runtime\/\.state$/);
  });
});
