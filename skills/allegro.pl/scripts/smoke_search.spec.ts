/**
 * Smoke-тест (read-only, ежедневный): поиск на allegro.pl жив, селекторы валидны.
 * Запуск: npx playwright test scripts/smoke_search.spec.ts
 * НИКОГДА не доходит до оплаты. Зелёный прогон => обновить last_verified в SKILL.md.
 * TODO при первой записи флоу: заменить NL-ожидания на конкретные локаторы из selectors.yaml.
 */
import { test, expect } from '@playwright/test';

test('allegro search returns results', async ({ page }) => {
  await page.goto('https://allegro.pl');
  // consent-попап, если есть
  const consent = page.getByRole('button', { name: /ok, zgadzam się/i });
  if (await consent.isVisible({ timeout: 5000 }).catch(() => false)) await consent.click();

  const search = page.getByRole('combobox', { name: /czego szukasz/i });
  await expect(search).toBeVisible();
  await search.fill('wkręty do drewna');
  await search.press('Enter');

  // выдача содержит карточки с ценами
  await expect(page.locator('article').first()).toBeVisible({ timeout: 15000 });
  const priceCount = await page.getByText(/zł/).count();
  expect(priceCount).toBeGreaterThan(3);
});
