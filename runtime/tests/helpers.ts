import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A synthetic, fully filled mandate (Russian labels, values are test data only). */
export const MANDATE_LF = `# ПОКУПАТЕЛЬСКИЙ МАНДАТ — тест
mandate_id: PM-TEST-0001
version: 1.0
status: signed

## 1. Принципал
Я, Test Person, разрешаю Агенту покупать в рамках мандата.

## 2. Пределы полномочий
- Лимит одной покупки: ≤ 50 PLN
- Совокупный лимит мандата: ≤ 300 PLN
- Срок действия: с 2026-09-01 по 2026-12-31
- Категории: расходники 3D-печати; крепёж; инструмент
- Площадки (allowlist): allegro.pl
- Запрещено: подписки; дробление сумм.

## 3. Платёжный инструмент
Только сохранённая карта one-click (PayU) и/или Allegro Pay.

## 4. Обязанности Агента
1) чек-лист перед оплатой.

## 5. Ответственность и отзыв
Файл MANDATE_REVOKED отзывает мандат.

## 6. Чек-лист
[ ] всё = ДА

## 7. Подпись
Подписано: Test Person, 2026-09-01 10:00 Europe/Warsaw
SHA-256 разделов 1–6: HASHPLACEHOLDER
`;

export function withSignedHash(text: string, hash: string): string {
  return text.replace('HASHPLACEHOLDER', hash);
}

export function tmpDir(prefix = 'asa-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writePrivateRepo(dir: string, mandate: string, config: Record<string, string> = {}): { mandatePath: string; configPath: string } {
  const mandatePath = path.join(dir, 'PURCHASE_MANDATE.md');
  fs.writeFileSync(mandatePath, mandate, 'utf8');
  const configPath = path.join(dir, 'config.env');
  const lines = Object.entries(config).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(configPath, lines.join('\n') + '\n', 'utf8');
  return { mandatePath, configPath };
}

export const FIXTURES = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'fixtures');

export function fixtureUrl(name: string): string {
  return 'file:///' + path.join(FIXTURES, 'html', name).replace(/\\/g, '/');
}
