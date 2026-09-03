import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectBlock, detectLoggedIn } from '../src/browser.js';
import { addSelectorDomain, isPlaceholderCss, loadSelectors, resolveSelector, setSelectorCss } from '../src/selectors.js';
import { FIXTURES, fixtureUrl, tmpDir } from './helpers.js';

const YAML_FIXTURE = path.join(FIXTURES, 'selectors.test.yaml');

describe('selectors.yaml loading', () => {
  it('drops TODO css placeholders, reads domains and endpoints', () => {
    const map = loadSelectors(YAML_FIXTURE);
    expect(map.entries.search_input.css).toBeUndefined();
    expect(map.entries.add_to_cart.css).toBe("button[data-analytics-click='add-to-cart']");
    expect(map.entries.add_to_cart.role).toEqual({ role: 'button', name: 'Dodaj do koszyka' });
    expect(map.domains).toEqual(['pay.allegro-pay.test']);
    expect(map.endpoints.search).toContain('/offers/listing');
    expect(isPlaceholderCss('TODO-verify (x)')).toBe(true);
    expect(isPlaceholderCss('.x')).toBe(false);
  });

  it('writes css back preserving comments and appends domains', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'selectors.yaml');
    fs.copyFileSync(YAML_FIXTURE, file);
    setSelectorCss(file, 'pay_button', "button[data-role='pay']");
    addSelectorDomain(file, 'secure.payu.com');
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('# keep this comment: write-back must preserve it');
    expect(text).toContain("pay_button:");
    const map = loadSelectors(file);
    expect(map.entries.pay_button.css).toBe("button[data-role='pay']");
    expect(map.domains).toEqual(['pay.allegro-pay.test', 'secure.payu.com']);
    expect(() => setSelectorCss(file, 'nope', 'x')).toThrow(/unknown selector id/);
  });
});

describe('layered resolver on synthetic pages (offline headless Chromium)', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto(fixtureUrl('product.html'));
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('resolves by role first', async () => {
    const map = loadSelectors(YAML_FIXTURE);
    const r = await resolveSelector(page, map, 'add_to_cart', { timeoutMs: 1000 });
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') {
      expect(r.layer).toBe('role');
      expect(await r.locator.textContent()).toBe('Dodaj do koszyka');
    }
    const s = await resolveSelector(page, map, 'search_input', { timeoutMs: 1000 });
    expect(s.status === 'resolved' && s.layer).toBe('role');
  });

  it('falls through to css when the accessible name changed', async () => {
    const map = loadSelectors(YAML_FIXTURE);
    const r = await resolveSelector(page, map, 'buy_now', { timeoutMs: 500 });
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') {
      expect(r.layer).toBe('css');
      expect(await r.locator.textContent()).toBe('Kup teraz');
    }
  });

  it('returns the NL layer (session decision) when neither role nor css match', async () => {
    const map = loadSelectors(YAML_FIXTURE);
    const r = await resolveSelector(page, map, 'pay_button', { timeoutMs: 500 });
    expect(r.status).toBe('nl');
    if (r.status === 'nl') {
      expect(r.fallback_nl).toBe('final payment button');
      expect(r.tried).toEqual(['role=button name~"Kupuję i płacę"']);
    }
    await expect(resolveSelector(page, map, 'missing_id')).rejects.toThrow(/unknown selector id/);
  });

  it('detects a block page and a logged-in page read-only', async () => {
    expect(await detectLoggedIn(page)).toBe(true);
    expect(await detectBlock(page)).toEqual({ blocked: false });
    const p2 = await browser.newPage();
    await p2.goto(fixtureUrl('blocked.html'));
    const b = await detectBlock(p2);
    expect(b.blocked).toBe(true);
    expect(b.marker).toContain('blocked');
    expect(Object.keys(b)).toEqual(['blocked', 'marker']);
    await p2.close();
  });
});
