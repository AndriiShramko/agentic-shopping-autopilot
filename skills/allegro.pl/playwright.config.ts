/**
 * Playwright config for the allegro.pl smoke tests.
 * The tests never launch a browser: they attach over CDP to the maintainer's dedicated, headed,
 * logged-in Chrome profile (see runtime/src/browser.ts, "channel B"). Run manually from runtime/:
 *   npx playwright test -c ../skills/allegro.pl/playwright.config.ts
 * No scheduled or CI runs against allegro.pl (docs/site-skill-spec.md §3).
 */
import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './scripts',
  testMatch: /smoke_.*\.spec\.ts/,
  timeout: 90_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
