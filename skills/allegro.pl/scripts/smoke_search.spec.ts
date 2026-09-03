/**
 * Smoke test (read-only; run manually by the maintainer — no scheduled/CI runs against allegro.pl,
 * see docs/site-skill-spec.md §3): search on allegro.pl is alive, the role-layer selectors resolve.
 *
 * It attaches over CDP to the maintainer's dedicated, headed, logged-in Chrome profile (channel B:
 * `chrome.exe --user-data-dir=C:\dev\asa-chrome-profile --remote-debugging-port=9222`) and never
 * launches a browser of its own. Run from runtime/:
 *   npx playwright test -c ../skills/allegro.pl/playwright.config.ts
 * NEVER reaches payment. Green run => update last_verified / verified_by: human in SKILL.md.
 *
 * Field note (2026-09-03): a fresh browser context with no user profile received the DataDome block page
 * ("You have been blocked") on the very first request to allegro.pl. A block page is a signal to stop,
 * never something to work around: the test skips instead of failing.
 */
import { chromium, test as base, expect, type Browser, type Page } from 'playwright/test';

const CDP_URL = process.env.CDP_URL ?? 'http://127.0.0.1:9222';

const test = base.extend<{ cdpPage: Page }>({
  cdpPage: async ({}, use) => {
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10_000 });
    } catch {
      test.skip(true, `no Chrome with remote debugging at ${CDP_URL}: start the dedicated profile first`);
      return;
    }
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await page.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  },
});

test('allegro search returns results (read-only, real profile over CDP)', async ({ cdpPage: page }) => {
  await page.goto('https://allegro.pl', { waitUntil: 'domcontentloaded' });
  // anti-bot block page => skip, never bypass
  const blocked = page.getByText(/you have been blocked/i);
  test.skip(await blocked.isVisible({ timeout: 3000 }).catch(() => false), 'DataDome block page: stop and hand over to the user');
  // consent popup, if present
  const consent = page.getByRole('button', { name: /ok, zgadzam się/i });
  if (await consent.isVisible({ timeout: 5000 }).catch(() => false)) await consent.click();

  const search = page.getByRole('combobox', { name: /czego szukasz/i });
  await expect(search).toBeVisible();
  await search.fill('wkręty do drewna');
  await page.waitForTimeout(800);
  await search.press('Enter');

  // results contain cards with prices
  await expect(page.locator('article').first()).toBeVisible({ timeout: 15000 });
  const priceCount = await page.getByText(/zł/).count();
  expect(priceCount).toBeGreaterThan(3);
});
