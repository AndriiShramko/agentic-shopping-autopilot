import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { amendMandateLimits, signMandate } from '../src/amend.js';
import { loadConfig } from '../src/config.js';
import { setLang } from '../src/i18n.js';
import { checkMandate, computeMandateHash, parseMandate } from '../src/mandate.js';
import { MANDATE_LF, tmpDir, writePrivateRepo } from './helpers.js';

// amend / sign write labels in the configured language; this file checks the Russian labels of the
// original mandate (ASA_LANG=ru), tests/i18n.test.ts checks the English default.
beforeAll(() => setLang('ru'));
afterAll(() => setLang('en'));

const NOW = new Date('2026-10-01T10:00:00Z');

describe('amend → sign → check (owner decision 2026-09-04: quick limit changes, one-time over-limit approval)', () => {
  it('amend rewrites section-2 lines, inserts the new lines in order, drops the signature; sign restores GREEN', () => {
    const dir = tmpDir();
    const { mandatePath, configPath } = writePrivateRepo(dir, MANDATE_LF.replace('status: signed', 'status: draft'));
    const r = amendMandateLimits(mandatePath, {
      perItemPln: 60,
      perPurchasePln: 100,
      maxItems: 4,
      aggregatePln: 600,
      overrideMaxPln: 300,
      validFrom: '2026-09-04',
      validTo: '2026-10-04',
      categories: ['Крепёж и метизы', 'Расходники 3D-печати'],
    });
    expect(r.changed).toEqual([
      '- Лимит одной позиции: ≤ 60 PLN',
      '- Лимит одной покупки (заказа): ≤ 100 PLN',
      '- Лимит позиций в заказе: ≤ 4 шт',
      '- Совокупный лимит мандата: ≤ 600 PLN',
      '- Разовое подтверждение сверх лимита: разрешено до ≤ 300 PLN',
      '- Срок действия: с 2026-09-04 по 2026-10-04',
      '- Категории: Крепёж и метизы; Расходники 3D-печати',
    ]);
    const text = fs.readFileSync(mandatePath, 'utf8');
    const p = parseMandate(text);
    expect(p.header.status).toBe('draft');
    expect(p.limits).toEqual({
      perItemPln: 60,
      perPurchasePln: 100,
      maxItems: 4,
      aggregatePln: 600,
      overrideMaxPln: 300,
      validFrom: '2026-09-04',
      validTo: '2026-10-04',
      categories: ['Крепёж и метизы', 'Расходники 3D-печати'],
      marketplaces: ['allegro.pl'],
    });
    const lines = text.split('\n');
    const at = (s: string) => lines.indexOf(s);
    expect(at('- Лимит одной позиции: ≤ 60 PLN')).toBeLessThan(at('- Лимит одной покупки (заказа): ≤ 100 PLN'));
    expect(at('- Лимит одной покупки (заказа): ≤ 100 PLN')).toBeLessThan(at('- Лимит позиций в заказе: ≤ 4 шт'));
    expect(at('- Лимит позиций в заказе: ≤ 4 шт')).toBeLessThan(at('- Совокупный лимит мандата: ≤ 600 PLN'));
    expect(at('- Совокупный лимит мандата: ≤ 600 PLN')).toBeLessThan(at('- Разовое подтверждение сверх лимита: разрешено до ≤ 300 PLN'));
    expect(at('- Разовое подтверждение сверх лимита: разрешено до ≤ 300 PLN')).toBeLessThan(at('- Срок действия: с 2026-09-04 по 2026-10-04'));

    const red = checkMandate({ config: loadConfig({ privateDir: dir }), now: NOW });
    expect(red.ok).toBe(false);

    const h = signMandate(mandatePath, { signer: 'Test Person (chat)', when: '2026-09-04 12:00 Europe/Warsaw', expectedHash: r.hash.hash, configPath });
    expect(h.hash).toBe(r.hash.hash);
    const signed = fs.readFileSync(mandatePath, 'utf8');
    expect(signed).toContain('status: signed');
    expect(signed).toContain('Подписано: Test Person (chat), 2026-09-04 12:00 Europe/Warsaw');
    expect(signed).toContain(`SHA-256 разделов 1–6: ${h.hash}`);
    expect(fs.readFileSync(configPath, 'utf8')).toContain(`MANDATE_SHA256=${h.hash}`);
    const green = checkMandate({ config: loadConfig({ privateDir: dir }), now: NOW, amountPln: 95, itemPln: 55, itemsCount: 3, category: 'Крепёж и метизы', domain: 'allegro.pl' });
    expect(green.items.filter((i) => !i.ok)).toEqual([]);
    expect(green.ok).toBe(true);
    const again = computeMandateHash(signed);
    expect('error' in again ? '' : again.hash).toBe(h.hash);
  });

  it('refuses to sign a stale hash or an incomplete section 2', () => {
    const dir = tmpDir();
    const { mandatePath, configPath } = writePrivateRepo(dir, MANDATE_LF);
    expect(() => signMandate(mandatePath, { signer: 'x', when: 'now', expectedHash: 'f'.repeat(64), configPath })).toThrow(/hash mismatch/);
    const draft = writePrivateRepo(tmpDir(), MANDATE_LF.replace('≤ 50 PLN', '≤ <N> PLN'));
    expect(() => signMandate(draft.mandatePath, { signer: 'x', when: 'now', configPath: draft.configPath })).toThrow(/not complete/);
  });

  it('a one-time approval lifts the item and order limits up to the mandate ceiling, never the aggregate limit', () => {
    const dir = tmpDir();
    const { mandatePath, configPath } = writePrivateRepo(dir, MANDATE_LF.replace('status: signed', 'status: draft'));
    amendMandateLimits(mandatePath, { perItemPln: 60, perPurchasePln: 100, aggregatePln: 600, overrideMaxPln: 300 });
    signMandate(mandatePath, { signer: 'Test Person (chat)', when: '2026-09-04 12:00 Europe/Warsaw', configPath });
    const cfg = loadConfig({ privateDir: dir });
    const failed = (r: ReturnType<typeof checkMandate>) => r.items.filter((i) => !i.ok).map((i) => i.id);

    expect(failed(checkMandate({ config: cfg, now: NOW, amountPln: 149.9, itemPln: 140, spentPln: 100 }))).toEqual(['item', 'amount']);
    const ok = checkMandate({ config: cfg, now: NOW, amountPln: 149.9, itemPln: 140, spentPln: 100, overridePln: 150 });
    expect(failed(ok)).toEqual([]);
    expect(ok.items.find((i) => i.id === 'override')?.detail).toContain('ceiling 300 PLN');
    expect(ok.items.find((i) => i.id === 'amount')?.detail).toContain('one-time approval up to 150.00 PLN');
    // the aggregate limit is a budget brake: an approval does not move it
    expect(failed(checkMandate({ config: cfg, now: NOW, amountPln: 149.9, itemPln: 140, spentPln: 500, overridePln: 150 }))).toEqual(['aggregate']);
    // an approval above the ceiling is rejected as a whole
    expect(failed(checkMandate({ config: cfg, now: NOW, amountPln: 320, itemPln: 320, spentPln: 0, overridePln: 320 }))).toEqual(['override', 'item', 'amount']);
    // an approval smaller than the amount does not cover it
    expect(checkMandate({ config: cfg, now: NOW, amountPln: 149.9, itemPln: 140, spentPln: 0, overridePln: 120 }).ok).toBe(false);
  });

  it('without a ceiling line in the mandate, one-time approvals are not permitted at all', () => {
    const dir = tmpDir();
    const { mandatePath, configPath } = writePrivateRepo(dir, MANDATE_LF.replace('status: signed', 'status: draft'));
    amendMandateLimits(mandatePath, { perItemPln: 60, perPurchasePln: 100, aggregatePln: 600 });
    signMandate(mandatePath, { signer: 'Test Person (chat)', when: '2026-09-04 12:00 Europe/Warsaw', configPath });
    const cfg = loadConfig({ privateDir: dir });
    const r = checkMandate({ config: cfg, now: NOW, amountPln: 80, itemPln: 80, overridePln: 80 });
    expect(r.items.filter((i) => !i.ok).map((i) => i.id)).toEqual(['override', 'item']);
    expect(checkMandate({ config: cfg, now: NOW, amountPln: 80, itemPln: 55 }).ok).toBe(true);
  });
});
