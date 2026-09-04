import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amendMandateLimits, signMandate } from '../src/amend.js';
import { loadConfig } from '../src/config.js';
import { checkMandate, computeMandateHash, parseMandate } from '../src/mandate.js';
import { MANDATE_LF, tmpDir, writePrivateRepo } from './helpers.js';

const NOW = new Date('2026-10-01T10:00:00Z');

describe('amend → sign → check (owner decision 2026-09-04: quick limit changes, one-time over-limit approval)', () => {
  it('amend rewrites section-2 lines, inserts the per-item line, drops the signature; sign restores GREEN', () => {
    const dir = tmpDir();
    const { mandatePath, configPath } = writePrivateRepo(dir, MANDATE_LF.replace('status: signed', 'status: draft'));
    const r = amendMandateLimits(mandatePath, { perItemPln: 60, perPurchasePln: 100, aggregatePln: 500, validFrom: '2026-09-04', validTo: '2026-12-31', categories: ['крепёж', 'расходники 3D-печати'] });
    expect(r.changed).toEqual([
      '- Лимит одной позиции: ≤ 60 PLN',
      '- Лимит одной покупки (заказа): ≤ 100 PLN',
      '- Совокупный лимит мандата: ≤ 500 PLN',
      '- Срок действия: с 2026-09-04 по 2026-12-31',
      '- Категории: крепёж; расходники 3D-печати',
    ]);
    const text = fs.readFileSync(mandatePath, 'utf8');
    const p = parseMandate(text);
    expect(p.header.status).toBe('draft');
    expect(p.limits).toMatchObject({ perItemPln: 60, perPurchasePln: 100, aggregatePln: 500, validFrom: '2026-09-04', validTo: '2026-12-31', categories: ['крепёж', 'расходники 3D-печати'], marketplaces: ['allegro.pl'] });
    // per-item line sits right before the per-purchase line
    const lines = text.split('\n');
    expect(lines.indexOf('- Лимит одной позиции: ≤ 60 PLN')).toBe(lines.indexOf('- Лимит одной покупки (заказа): ≤ 100 PLN') - 1);

    const red = checkMandate({ config: loadConfig({ privateDir: dir }), now: NOW });
    expect(red.ok).toBe(false);

    const h = signMandate(mandatePath, { signer: 'Test Person (chat)', when: '2026-09-04 12:00 Europe/Warsaw', expectedHash: r.hash.hash, configPath });
    expect(h.hash).toBe(r.hash.hash);
    const signed = fs.readFileSync(mandatePath, 'utf8');
    expect(signed).toContain('status: signed');
    expect(signed).toContain('Подписано: Test Person (chat), 2026-09-04 12:00 Europe/Warsaw');
    expect(signed).toContain(`SHA-256 разделов 1–6: ${h.hash}`);
    expect(fs.readFileSync(configPath, 'utf8')).toContain(`MANDATE_SHA256=${h.hash}`);
    const green = checkMandate({ config: loadConfig({ privateDir: dir }), now: NOW, amountPln: 95, itemPln: 55, category: 'крепёж', domain: 'allegro.pl' });
    expect(green.items.filter((i) => !i.ok)).toEqual([]);
    expect(green.ok).toBe(true);
    // signing did not change the hashed range
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

  it('a one-time approval lets item / purchase / aggregate checks pass up to the approved amount, and is reported', () => {
    const dir = tmpDir();
    const { mandatePath, configPath } = writePrivateRepo(dir, MANDATE_LF.replace('status: signed', 'status: draft'));
    amendMandateLimits(mandatePath, { perItemPln: 60, perPurchasePln: 100, aggregatePln: 500 });
    signMandate(mandatePath, { signer: 'Test Person (chat)', when: '2026-09-04 12:00 Europe/Warsaw', configPath });
    const cfg = loadConfig({ privateDir: dir });
    const noOverride = checkMandate({ config: cfg, now: NOW, amountPln: 149.9, itemPln: 140, spentPln: 400 });
    expect(noOverride.items.filter((i) => !i.ok).map((i) => i.id)).toEqual(['item', 'amount', 'aggregate']);
    const withOverride = checkMandate({ config: cfg, now: NOW, amountPln: 149.9, itemPln: 140, spentPln: 400, overridePln: 150 });
    expect(withOverride.items.filter((i) => !i.ok)).toEqual([]);
    expect(withOverride.items.find((i) => i.id === 'amount')?.detail).toContain('one-time approval up to 150.00 PLN');
    const tooLow = checkMandate({ config: cfg, now: NOW, amountPln: 149.9, itemPln: 140, spentPln: 400, overridePln: 120 });
    expect(tooLow.ok).toBe(false);
  });
});
