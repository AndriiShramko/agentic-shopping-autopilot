import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { checkMandate, computeMandateHash, domainMatches, parseMandate, warsawDate } from '../src/mandate.js';
import { MANDATE_LF, tmpDir, withSignedHash, writePrivateRepo } from './helpers.js';

function independentHash(text: string): { hash: string; from: number; to: number } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const from = lines.findIndex((l) => l.startsWith('## 1.'));
  const to = lines.findIndex((l, i) => i > from && l.startsWith('## 7.'));
  const body = lines.slice(from, to).join('\n').replace(/\n+$/, '');
  return { hash: crypto.createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex'), from: from + 1, to };
}

describe('mandate hash (byte-exact rule)', () => {
  it('hashes lines from "## 1." to the line before "## 7.", trailing newlines dropped', () => {
    const r = computeMandateHash(MANDATE_LF);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    const ref = independentHash(MANDATE_LF);
    expect(r.hash).toBe(ref.hash);
    expect(r.fromLine).toBe(ref.from);
    // the range ends on the last non-empty line before "## 7." (the blank separator is excluded)
    expect(r.toLine).toBe(ref.to - 1);
    expect(MANDATE_LF.split('\n')[r.toLine - 1]).toBe('[ ] всё = ДА');
  });

  it('is invariant to CRLF and BOM, sensitive to any byte inside the range', () => {
    const lf = computeMandateHash(MANDATE_LF);
    const crlf = computeMandateHash(MANDATE_LF.replace(/\n/g, '\r\n'));
    const bom = computeMandateHash('﻿' + MANDATE_LF);
    const changed = computeMandateHash(MANDATE_LF.replace('≤ 50 PLN', '≤ 51 PLN'));
    const sig = computeMandateHash(withSignedHash(MANDATE_LF, 'a'.repeat(64)));
    if ('error' in lf || 'error' in crlf || 'error' in bom || 'error' in changed || 'error' in sig) throw new Error('unexpected');
    expect(crlf.hash).toBe(lf.hash);
    expect(bom.hash).toBe(lf.hash);
    expect(changed.hash).not.toBe(lf.hash);
    // section 7 is outside the range: writing the signature does not change the hash
    expect(sig.hash).toBe(lf.hash);
  });

  it('reports a missing range', () => {
    expect(computeMandateHash('no sections here')).toEqual({ error: expect.stringContaining('## 1.') });
    expect(computeMandateHash('## 1. only')).toEqual({ error: expect.stringContaining('## 7.') });
  });
});

describe('mandate parser', () => {
  it('parses header, strict section-2 lines and the section-7 hash', () => {
    const p = parseMandate(withSignedHash(MANDATE_LF, 'ab'.repeat(32)));
    expect(p.header).toEqual({ mandateId: 'PM-TEST-0001', version: '1.0', status: 'signed' });
    expect(p.limits).toEqual({
      perPurchasePln: 50,
      aggregatePln: 300,
      validFrom: '2026-09-01',
      validTo: '2026-12-31',
      categories: ['расходники 3D-печати', 'крепёж', 'инструмент'],
      marketplaces: ['allegro.pl'],
    });
    expect(p.signedHash).toBe('ab'.repeat(32));
    expect(p.parseErrors).toEqual([]);
  });

  it('accepts English labels and decimal amounts', () => {
    const en = MANDATE_LF.replace('- Лимит одной покупки: ≤ 50 PLN', '- Single-purchase limit: ≤ 49.90 PLN')
      .replace('- Совокупный лимит мандата: ≤ 300 PLN', '- Aggregate mandate limit: ≤ 300,50 PLN')
      .replace('- Срок действия: с 2026-09-01 по 2026-12-31', '- Validity period: from 2026-09-01 to 2026-12-31')
      .replace('- Категории: расходники 3D-печати; крепёж; инструмент', '- Categories: 3D printing consumables; fasteners')
      .replace('- Площадки (allowlist): allegro.pl', '- Marketplaces (allowlist): allegro.pl');
    const p = parseMandate(en);
    expect(p.parseErrors).toEqual([]);
    expect(p.limits.perPurchasePln).toBe(49.9);
    expect(p.limits.aggregatePln).toBe(300.5);
    expect(p.limits.categories).toEqual(['3D printing consumables', 'fasteners']);
  });

  it('flags placeholders and malformed lines instead of guessing', () => {
    const draft = MANDATE_LF.replace('≤ 50 PLN', '≤ <N> PLN').replace('с 2026-09-01 по 2026-12-31', 'с <дата> по <дата>');
    const p = parseMandate(draft);
    expect(p.parseErrors).toContain('per-purchase limit line missing or malformed');
    expect(p.parseErrors).toContain('validity period line missing or malformed');
    expect(parseMandate(MANDATE_LF).signedHash).toBeUndefined();
  });
});

describe('checkMandate', () => {
  function setup(mandate: string, config: Record<string, string> = {}) {
    const dir = tmpDir();
    writePrivateRepo(dir, mandate, config);
    return { dir, cfg: loadConfig({ privateDir: dir }) };
  }
  const NOW = new Date('2026-10-01T10:00:00Z');

  it('is GREEN for a signed mandate whose hash matches section 7 and config.env', () => {
    const h = computeMandateHash(MANDATE_LF);
    if ('error' in h) throw new Error(h.error);
    const { cfg } = setup(withSignedHash(MANDATE_LF, h.hash), { MANDATE_SHA256: h.hash });
    const res = checkMandate({ config: cfg, now: NOW, amountPln: 24.99, category: 'крепёж', domain: 'allegro.pl', spentPln: 100 });
    expect(res.items.filter((i) => !i.ok)).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.remainingPln).toBe(200);
    expect(res.mandateId).toBe('PM-TEST-0001');
  });

  it('is RED for a draft (no signature) unless the draft demo mode is used', () => {
    const { cfg } = setup(MANDATE_LF.replace('status: signed', 'status: draft'));
    const strict = checkMandate({ config: cfg, now: NOW });
    expect(strict.ok).toBe(false);
    expect(strict.items.find((i) => i.id === 'status')?.ok).toBe(false);
    expect(strict.items.find((i) => i.id === 'hash-signed')?.ok).toBe(false);
    expect(strict.items.find((i) => i.id === 'hash-config')?.ok).toBe(false);
    const demo = checkMandate({ config: cfg, now: NOW, requireSigned: false });
    expect(demo.ok).toBe(true);
    expect(demo.hash?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails on a hash mismatch (edited text), a wrong MANDATE_SHA256 and MANDATE_REVOKED', () => {
    const h = computeMandateHash(MANDATE_LF);
    if ('error' in h) throw new Error(h.error);
    const signed = withSignedHash(MANDATE_LF, h.hash);
    const edited = setup(signed.replace('≤ 50 PLN', '≤ 500 PLN'), { MANDATE_SHA256: h.hash });
    const r1 = checkMandate({ config: edited.cfg, now: NOW });
    expect(r1.items.find((i) => i.id === 'hash-signed')?.ok).toBe(false);
    expect(r1.items.find((i) => i.id === 'hash-config')?.ok).toBe(false);

    const wrongCfg = setup(signed, { MANDATE_SHA256: 'f'.repeat(64) });
    const r2 = checkMandate({ config: wrongCfg.cfg, now: NOW });
    expect(r2.items.find((i) => i.id === 'hash-signed')?.ok).toBe(true);
    expect(r2.items.find((i) => i.id === 'hash-config')?.ok).toBe(false);

    const revoked = setup(signed, { MANDATE_SHA256: h.hash });
    fs.writeFileSync(path.join(revoked.dir, 'MANDATE_REVOKED'), '', 'utf8');
    const r3 = checkMandate({ config: revoked.cfg, now: NOW });
    expect(r3.ok).toBe(false);
    expect(r3.items.find((i) => i.id === 'revoked')?.ok).toBe(false);
  });

  it('enforces validity (Europe/Warsaw, inclusive), per-purchase, aggregate, category and domain', () => {
    const h = computeMandateHash(MANDATE_LF);
    if ('error' in h) throw new Error(h.error);
    const { cfg } = setup(withSignedHash(MANDATE_LF, h.hash), { MANDATE_SHA256: h.hash });
    // 2026-12-31 23:30 in Warsaw is 22:30Z: still inside; 2027-01-01 00:30 Warsaw (23:30Z) is outside
    expect(checkMandate({ config: cfg, now: new Date('2026-12-31T22:30:00Z') }).items.find((i) => i.id === 'validity')?.ok).toBe(true);
    expect(checkMandate({ config: cfg, now: new Date('2026-12-31T23:30:00Z') }).items.find((i) => i.id === 'validity')?.ok).toBe(false);
    expect(checkMandate({ config: cfg, now: new Date('2026-08-31T21:00:00Z') }).items.find((i) => i.id === 'validity')?.ok).toBe(false);
    expect(checkMandate({ config: cfg, now: new Date('2026-08-31T22:30:00Z') }).items.find((i) => i.id === 'validity')?.ok).toBe(true);

    const over = checkMandate({ config: cfg, now: NOW, amountPln: 50.01 });
    expect(over.items.find((i) => i.id === 'amount')?.ok).toBe(false);
    const agg = checkMandate({ config: cfg, now: NOW, amountPln: 20, spentPln: 285 });
    expect(agg.items.find((i) => i.id === 'amount')?.ok).toBe(true);
    expect(agg.items.find((i) => i.id === 'aggregate')?.ok).toBe(false);
    expect(checkMandate({ config: cfg, now: NOW, category: 'электроника' }).items.find((i) => i.id === 'category')?.ok).toBe(false);
    expect(checkMandate({ config: cfg, now: NOW, domain: 'olx.pl' }).items.find((i) => i.id === 'domain')?.ok).toBe(false);
    expect(checkMandate({ config: cfg, now: NOW, domain: 'www.allegro.pl' }).items.find((i) => i.id === 'domain')?.ok).toBe(true);
  });

  it('reports a missing mandate file as RED without throwing', () => {
    const cfg = loadConfig({ privateDir: tmpDir() });
    const res = checkMandate({ config: cfg });
    expect(res.ok).toBe(false);
    expect(res.items[0].id).toBe('file');
  });
});

describe('helpers', () => {
  it('warsawDate uses the Europe/Warsaw calendar', () => {
    expect(warsawDate(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01');
    expect(warsawDate(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });
  it('domainMatches handles subdomains and wildcards', () => {
    expect(domainMatches('allegro.pl', ['allegro.pl'])).toBe(true);
    expect(domainMatches('www.allegro.pl', ['allegro.pl'])).toBe(true);
    expect(domainMatches('allegro.pl.evil.com', ['allegro.pl'])).toBe(false);
    expect(domainMatches('olx.pl', ['allegro.pl'])).toBe(false);
  });
});
