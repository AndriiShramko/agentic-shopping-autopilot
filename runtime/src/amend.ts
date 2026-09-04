/**
 * Mandate amendments and signing (owner decision 2026-09-04: limits must be quick to change, and a
 * purchase above the limits is allowed after a one-time confirmation by the principal).
 *
 *   amendMandateLimits  rewrites the parseable section-2 lines; the hash changes, so the mandate is
 *                       marked `status: draft` again and must be re-signed.
 *   signMandate         writes the signer, the timestamp and the SHA-256 into section 7, sets
 *                       `status: signed` and pins the same hash as MANDATE_SHA256 in config.env.
 *                       The principal's confirmation in chat (name + hash) is the signing act.
 */
import fs from 'node:fs';
import { writeConfigValues } from './config.js';
import { computeMandateHash, normalizeText, parseMandate, type MandateHash } from './mandate.js';

export interface AmendInput {
  perItemPln?: number;
  perPurchasePln?: number;
  aggregatePln?: number;
  validFrom?: string;
  validTo?: string;
  categories?: string[];
  marketplaces?: string[];
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function isoDate(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`date must be YYYY-MM-DD, got "${s}"`);
  return s;
}

/** Rewrite section-2 lines in place (Russian labels; new per-item line inserted before the per-purchase line). */
export function amendMandateLimits(mandatePath: string, input: AmendInput): { hash: MandateHash; changed: string[] } {
  const raw = fs.readFileSync(mandatePath, 'utf8');
  const lines = normalizeText(raw).split('\n');
  const idx2 = lines.findIndex((l) => l.startsWith('## 2.'));
  const idx3 = lines.findIndex((l, i) => i > idx2 && l.startsWith('## 3.'));
  if (idx2 < 0 || idx3 < 0) throw new Error('section 2 not found');
  const changed: string[] = [];
  const setLine = (test: RegExp, text: string, insertBeforeTest?: RegExp) => {
    let i = lines.findIndex((l, k) => k > idx2 && k < idx3 && test.test(l));
    if (i < 0) {
      const at = insertBeforeTest ? lines.findIndex((l, k) => k > idx2 && k < idx3 && insertBeforeTest.test(l)) : -1;
      i = at >= 0 ? at : idx2 + 1;
      lines.splice(i, 0, text);
    } else {
      lines[i] = text;
    }
    changed.push(text);
  };
  if (input.perItemPln !== undefined) setLine(/^-\s*(Лимит одной позиции|Single-item limit)\s*:/u, `- Лимит одной позиции: ≤ ${fmt(input.perItemPln)} PLN`, /^-\s*(Лимит одной покупки|Single-purchase limit)/u);
  if (input.perPurchasePln !== undefined) setLine(/^-\s*(Лимит одной покупки|Single-purchase limit)/u, `- Лимит одной покупки (заказа): ≤ ${fmt(input.perPurchasePln)} PLN`);
  if (input.aggregatePln !== undefined) setLine(/^-\s*(Совокупный лимит мандата|Aggregate mandate limit)\s*:/u, `- Совокупный лимит мандата: ≤ ${fmt(input.aggregatePln)} PLN`);
  if (input.validFrom !== undefined || input.validTo !== undefined) {
    const current = parseMandate(raw).limits;
    const from = isoDate(input.validFrom ?? current.validFrom ?? '');
    const to = isoDate(input.validTo ?? current.validTo ?? '');
    setLine(/^-\s*(Срок действия|Validity period)\s*:/u, `- Срок действия: с ${from} по ${to}`);
  }
  if (input.categories !== undefined) setLine(/^-\s*(Категории|Categories)\s*:/u, `- Категории: ${input.categories.map((c) => c.trim()).filter(Boolean).join('; ')}`);
  if (input.marketplaces !== undefined) setLine(/^-\s*(Площадки \(allowlist\)|Marketplaces \(allowlist\))\s*:/u, `- Площадки (allowlist): ${input.marketplaces.join('; ')}`);

  // any change invalidates the signature: back to draft until re-signed
  const statusIdx = lines.findIndex((l, k) => k < idx2 && /^status\s*:/.test(l));
  if (statusIdx >= 0 && changed.length) lines[statusIdx] = 'status: draft';
  const text = lines.join('\n');
  fs.writeFileSync(mandatePath, text, { encoding: 'utf8' });
  const h = computeMandateHash(text);
  if ('error' in h) throw new Error(h.error);
  return { hash: h, changed };
}

export interface SignInput {
  signer: string;
  /** e.g. "2026-09-05 10:12 Europe/Warsaw" */
  when: string;
  /** If given, must equal the recomputed hash (protects against signing a stale text). */
  expectedHash?: string;
  configPath: string;
}

export function signMandate(mandatePath: string, input: SignInput): MandateHash {
  const raw = fs.readFileSync(mandatePath, 'utf8');
  const h = computeMandateHash(raw);
  if ('error' in h) throw new Error(h.error);
  if (input.expectedHash && input.expectedHash.toLowerCase() !== h.hash) {
    throw new Error(`hash mismatch: confirmed ${input.expectedHash.toLowerCase()} but the mandate text hashes to ${h.hash}; re-read and confirm again`);
  }
  const parsed = parseMandate(raw);
  if (parsed.parseErrors.length) throw new Error(`mandate section 2 is not complete: ${parsed.parseErrors.join('; ')}`);
  const lines = normalizeText(raw).split('\n');
  const idx7 = lines.findIndex((l) => l.startsWith('## 7.'));
  if (idx7 < 0) throw new Error('section 7 not found');
  let wroteSigned = false;
  let wroteHash = false;
  for (let i = idx7 + 1; i < lines.length; i++) {
    if (/^Подписано\s*:|^Signed\s*:/u.test(lines[i])) {
      lines[i] = `Подписано: ${input.signer}, ${input.when}`;
      wroteSigned = true;
    } else if (/SHA-256/.test(lines[i])) {
      lines[i] = `SHA-256 разделов 1–6: ${h.hash}`;
      wroteHash = true;
    }
  }
  if (!wroteSigned) lines.splice(idx7 + 1, 0, `Подписано: ${input.signer}, ${input.when}`);
  if (!wroteHash) lines.splice(idx7 + 2, 0, `SHA-256 разделов 1–6: ${h.hash}`);
  const idx1 = lines.findIndex((l) => l.startsWith('## 1.'));
  const statusIdx = lines.findIndex((l, k) => k < idx1 && /^status\s*:/.test(l));
  if (statusIdx >= 0) lines[statusIdx] = 'status: signed';
  else lines.splice(0, 0, 'status: signed');
  fs.writeFileSync(mandatePath, lines.join('\n'), { encoding: 'utf8' });
  writeConfigValues(input.configPath, { MANDATE_SHA256: h.hash });
  const check = computeMandateHash(fs.readFileSync(mandatePath, 'utf8'));
  if ('error' in check || check.hash !== h.hash) throw new Error('hash changed while signing (section 7 must stay outside the hashed range)');
  return h;
}

export interface OverrideRecord {
  run_id: string;
  amount_pln: number;
  approved_by: string;
  ts: string;
  note?: string;
}
