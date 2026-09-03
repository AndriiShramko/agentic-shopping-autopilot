/**
 * Smoke test (read-only; run manually by the maintainer from their own logged-in profile — no scheduled/CI runs
 * against allegro.pl, see docs/site-skill-spec.md §3): search on allegro.pl is alive, selectors are valid.
 * Run: npx playwright test scripts/smoke_search.spec.ts
 * NEVER reaches payment. Green run => update last_verified in SKILL.md.
 * TODO on first flow recording: replace NL expectations with concrete locators from selectors.yaml.
 * Run it from the user's persistent, logged-in browser profile: a fresh context with no profile
 * gets the DataDome block page on the first request (observed 2026-09-03). The test then skips
 * instead of failing — a block is a signal to stop, never something to work around.
 */
import { test, expect } from '@playwright/test';

test('allegro search returns results', async ({ page }) => {
  await page.goto('https://allegro.pl');
  // anti-bot block page => skip (run from a real persistent profile), never bypass
  const blocked = page.getByText(/you have been blocked/i);
  test.skip(await blocked.isVisible({ timeout: 3000 }).catch(() => false),
    "DataDome block page: run this smoke test from the user's persistent logged-in profile");
  // consent popup, if present
  const consent = page.getByRole('button', { name: /ok, zgadzam się/i });
  if (await consent.isVisible({ timeout: 5000 }).catch(() => false)) await consent.click();

  const search = page.getByRole('combobox', { name: /czego szukasz/i });
  await expect(search).toBeVisible();
  await search.fill('wkręty do drewna');
  await search.press('Enter');

  // results contain cards with prices
  await expect(page.locator('article').first()).toBeVisible({ timeout: 15000 });
  const priceCount = await page.getByText(/zł/).count();
  expect(priceCount).toBeGreaterThan(3);
});
