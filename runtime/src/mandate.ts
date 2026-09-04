/**
 * Purchase-mandate parser and checker.
 *
 * Hash rule (byte-exact, from the operational spec):
 *   SHA-256 of the UTF-8 bytes (BOM stripped) of the lines from the first line starting with
 *   "## 1." up to, but not including, the first following line starting with "## 7.";
 *   lines joined with "\n" (CRLF normalised to LF), trailing "\n" at the end of the range dropped,
 *   no other normalisation.
 *
 * Section 2 is parsed line by line in a strict format (Russian or English labels):
 *   - Лимит одной покупки: ≤ 50 PLN             | - Single-purchase limit: ≤ 50 PLN
 *   - Совокупный лимит мандата: ≤ 300 PLN       | - Aggregate mandate limit: ≤ 300 PLN
 *   - Срок действия: с 2026-09-10 по 2026-10-10 | - Validity period: from 2026-09-10 to 2026-10-10
 *   - Категории: cat1; cat2                     | - Categories: cat1; cat2
 *   - Площадки (allowlist): allegro.pl          | - Marketplaces (allowlist): allegro.pl
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeConfig } from './config.js';

export const REVOKED_FILENAME = 'MANDATE_REVOKED';

export interface MandateHash {
  hash: string;
  /** 1-based, inclusive */
  fromLine: number;
  /** 1-based, inclusive (last non-empty line of the hashed range) */
  toLine: number;
}

export interface MandateHeader {
  mandateId?: string;
  version?: string;
  status?: string;
}

export interface MandateLimits {
  /** Optional: ceiling for a single item (line) inside an order. */
  perItemPln?: number;
  /** Ceiling for one purchase (order total incl. delivery). */
  perPurchasePln: number;
  aggregatePln: number;
  validFrom: string;
  validTo: string;
  categories: string[];
  marketplaces: string[];
}

export interface ParsedMandate {
  header: MandateHeader;
  limits: Partial<MandateLimits>;
  signedHash?: string;
  parseErrors: string[];
}

export function normalizeText(raw: string): string {
  let t = raw;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t.replace(/\r\n/g, '\n');
}

export function computeMandateHash(raw: string): MandateHash | { error: string } {
  const lines = normalizeText(raw).split('\n');
  const start = lines.findIndex((l) => l.startsWith('## 1.'));
  if (start < 0) return { error: 'no line starting with "## 1."' };
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## 7.')) {
      end = i;
      break;
    }
  }
  if (end < 0) return { error: 'no line starting with "## 7." after "## 1."' };
  let joined = lines.slice(start, end).join('\n');
  joined = joined.replace(/\n+$/, '');
  const hash = crypto.createHash('sha256').update(joined, 'utf8').digest('hex');
  let lastNonEmpty = end - 1;
  while (lastNonEmpty > start && lines[lastNonEmpty] === '') lastNonEmpty--;
  return { hash, fromLine: start + 1, toLine: lastNonEmpty + 1 };
}

const NUM = '(\\d+(?:[.,]\\d{1,2})?)';
const RE_PER_ITEM = new RegExp(
  '^-\\s*(?:Лимит одной позиции|Single-item limit)\\s*:\\s*[≤<=]+\\s*' + NUM + '\\s*PLN\\s*(?:\\(.*\\))?\\s*$',
  'u',
);
const RE_PER_PURCHASE = new RegExp(
  '^-\\s*(?:Лимит одной покупки(?: \\(заказа\\))?|Single-purchase limit|Single-order limit)\\s*:\\s*[≤<=]+\\s*' + NUM + '\\s*PLN\\s*(?:\\(.*\\))?\\s*$',
  'u',
);
const RE_AGGREGATE = new RegExp(
  '^-\\s*(?:Совокупный лимит мандата|Aggregate mandate limit)\\s*:\\s*[≤<=]+\\s*' + NUM + '\\s*PLN\\s*(?:\\(.*\\))?\\s*$',
  'u',
);
const RE_VALIDITY = /^-\s*(?:Срок действия|Validity period)\s*:\s*(?:с|from)\s+(\d{4}-\d{2}-\d{2})\s+(?:по|to)\s+(\d{4}-\d{2}-\d{2})\b/u;
const RE_CATEGORIES = /^-\s*(?:Категории|Categories)\s*:\s*(.+?)\s*$/u;
const RE_MARKETPLACES = /^-\s*(?:Площадки \(allowlist\)|Marketplaces \(allowlist\))\s*:\s*(.+?)\s*$/u;
const RE_DOMAIN = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}\b/gi;
const RE_SIGNED_HASH = /SHA-256[^:]*:\s*([0-9a-fA-F]{64})\b/u;

function toNumber(s: string): number {
  return Number(s.replace(',', '.'));
}

export function parseMandate(raw: string): ParsedMandate {
  const lines = normalizeText(raw).split('\n');
  const header: MandateHeader = {};
  const limits: Partial<MandateLimits> = {};
  const parseErrors: string[] = [];
  let signedHash: string | undefined;

  const idx1 = lines.findIndex((l) => l.startsWith('## 1.'));
  const idx2 = lines.findIndex((l) => l.startsWith('## 2.'));
  const idx3 = lines.findIndex((l) => l.startsWith('## 3.'));
  const idx7 = lines.findIndex((l) => l.startsWith('## 7.'));

  const headerEnd = idx1 >= 0 ? idx1 : lines.length;
  for (const l of lines.slice(0, headerEnd)) {
    const m = /^(mandate_id|version|status)\s*:\s*(.+?)\s*$/.exec(l);
    if (!m) continue;
    if (m[1] === 'mandate_id') header.mandateId = m[2];
    else if (m[1] === 'version') header.version = m[2];
    else header.status = m[2].toLowerCase();
  }

  if (idx2 < 0) parseErrors.push('section "## 2." not found');
  const sec2 = idx2 >= 0 ? lines.slice(idx2 + 1, idx3 > idx2 ? idx3 : lines.length) : [];
  for (const l of sec2) {
    let m: RegExpExecArray | null;
    if ((m = RE_PER_ITEM.exec(l))) limits.perItemPln = toNumber(m[1]);
    else if ((m = RE_PER_PURCHASE.exec(l))) limits.perPurchasePln = toNumber(m[1]);
    else if ((m = RE_AGGREGATE.exec(l))) limits.aggregatePln = toNumber(m[1]);
    else if ((m = RE_VALIDITY.exec(l))) {
      limits.validFrom = m[1];
      limits.validTo = m[2];
    } else if ((m = RE_CATEGORIES.exec(l))) {
      limits.categories = m[1]
        .split(';')
        .map((c) => c.trim())
        .filter((c) => c.length > 0 && !/^<.*>$/.test(c));
    } else if ((m = RE_MARKETPLACES.exec(l))) {
      limits.marketplaces = Array.from(m[1].matchAll(RE_DOMAIN)).map((d) => d[0].toLowerCase());
    }
  }
  if (limits.perPurchasePln === undefined) parseErrors.push('per-purchase limit line missing or malformed');
  if (limits.aggregatePln === undefined) parseErrors.push('aggregate limit line missing or malformed');
  if (!limits.validFrom || !limits.validTo) parseErrors.push('validity period line missing or malformed');
  if (!limits.categories || limits.categories.length === 0) parseErrors.push('categories line missing or empty');
  if (!limits.marketplaces || limits.marketplaces.length === 0) parseErrors.push('marketplaces line missing or empty');

  if (idx7 >= 0) {
    for (const l of lines.slice(idx7 + 1)) {
      const m = RE_SIGNED_HASH.exec(l);
      if (m) {
        signedHash = m[1].toLowerCase();
        break;
      }
    }
  }
  return { header, limits, signedHash, parseErrors };
}

/** Calendar date (YYYY-MM-DD) in Europe/Warsaw for a given instant. */
export function warsawDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function domainMatches(domain: string, allowed: readonly string[]): boolean {
  const host = domain.toLowerCase().replace(/^\*\./, '');
  return allowed.some((a) => {
    const base = a.toLowerCase().replace(/^\*\./, '');
    return host === base || host.endsWith('.' + base);
  });
}

export interface CheckInput {
  config: RuntimeConfig;
  now?: Date;
  /** Total amount of the purchase (item + delivery) in PLN. */
  amountPln?: number;
  /** Price of the most expensive single item in the order, when the mandate has a per-item limit. */
  itemPln?: number;
  /**
   * One-time over-limit approval given by the principal in chat for THIS purchase (owner decision
   * 2026-09-04): amounts up to this value pass the item / purchase / aggregate checks, and the fact is
   * reported in the check output and the audit log.
   */
  overridePln?: number;
  category?: string;
  domain?: string;
  /** Sum of order_confirmed amounts for this mandate so far (from the audit log). */
  spentPln?: number;
  /** Default true; pass false to demonstrate the checker on a draft. */
  requireSigned?: boolean;
}

export interface CheckItem {
  id: string;
  ok: boolean;
  detail: string;
}

export interface CheckResult {
  ok: boolean;
  items: CheckItem[];
  hash?: MandateHash;
  parsed?: ParsedMandate;
  remainingPln?: number;
  mandateId?: string;
}

export function checkMandate(input: CheckInput): CheckResult {
  const { config } = input;
  const requireSigned = input.requireSigned ?? true;
  const items: CheckItem[] = [];
  const push = (id: string, ok: boolean, detail: string) => items.push({ id, ok, detail });

  let raw: string;
  try {
    raw = fs.readFileSync(config.mandatePath, 'utf8');
    push('file', true, `mandate read: ${config.mandatePath}`);
  } catch (e) {
    push('file', false, `mandate not readable: ${config.mandatePath} (${(e as Error).message})`);
    return { ok: false, items };
  }

  const hashRes = computeMandateHash(raw);
  let hash: MandateHash | undefined;
  if ('error' in hashRes) {
    push('hash-range', false, hashRes.error);
  } else {
    hash = hashRes;
    push('hash-range', true, `sha256 ${hash.hash} over lines ${hash.fromLine}-${hash.toLine}`);
  }

  const parsed = parseMandate(raw);
  const status = parsed.header.status ?? '(none)';
  push(
    'status',
    !requireSigned || status === 'signed',
    `status: ${status}${requireSigned ? '' : ' (signature not required for this check)'}`,
  );

  const revokedPath = path.join(path.dirname(config.mandatePath), REVOKED_FILENAME);
  const revoked = fs.existsSync(revokedPath);
  push('revoked', !revoked, revoked ? `${REVOKED_FILENAME} present at ${revokedPath}` : `${REVOKED_FILENAME} absent`);

  if (hash) {
    if (parsed.signedHash) {
      const same = parsed.signedHash === hash.hash;
      push('hash-signed', same, same ? 'section 7 hash matches' : `section 7 hash ${parsed.signedHash} != computed ${hash.hash}`);
    } else {
      push('hash-signed', !requireSigned, 'section 7 carries no SHA-256 yet');
    }
    if (config.mandateSha256) {
      const same = config.mandateSha256 === hash.hash;
      push('hash-config', same, same ? 'MANDATE_SHA256 in config.env matches' : `MANDATE_SHA256 ${config.mandateSha256} != computed ${hash.hash}`);
    } else {
      push('hash-config', !requireSigned, 'MANDATE_SHA256 not set in config.env');
    }
  }

  push(
    'limits',
    parsed.parseErrors.length === 0,
    parsed.parseErrors.length === 0 ? describeLimits(parsed.limits) : parsed.parseErrors.join('; '),
  );

  const today = warsawDate(input.now);
  if (parsed.limits.validFrom && parsed.limits.validTo) {
    const inRange = today >= parsed.limits.validFrom && today <= parsed.limits.validTo;
    push(
      'validity',
      inRange,
      `today ${today} (Europe/Warsaw) ${inRange ? 'within' : 'outside'} ${parsed.limits.validFrom}..${parsed.limits.validTo}`,
    );
  }

  let remainingPln: number | undefined;
  if (parsed.limits.aggregatePln !== undefined) {
    remainingPln = round2(parsed.limits.aggregatePln - (input.spentPln ?? 0));
  }
  const override = input.overridePln !== undefined && input.overridePln > 0 ? input.overridePln : undefined;
  const covered = (value: number): boolean => override !== undefined && value <= override + 0.001;
  const viaOverride = (value: number): string => (covered(value) ? ` (allowed by one-time approval up to ${override?.toFixed(2)} PLN)` : '');
  if (input.itemPln !== undefined && parsed.limits.perItemPln !== undefined) {
    const lim = parsed.limits.perItemPln;
    const ok = input.itemPln <= lim || covered(input.itemPln);
    push('item', ok, `item ${input.itemPln.toFixed(2)} PLN ${input.itemPln <= lim ? '<=' : '>'} per-item limit ${lim}${viaOverride(input.itemPln)}`);
  }
  if (input.amountPln !== undefined) {
    const per = parsed.limits.perPurchasePln;
    if (per !== undefined) {
      const ok = input.amountPln <= per || covered(input.amountPln);
      push('amount', ok, `amount ${input.amountPln.toFixed(2)} PLN ${input.amountPln <= per ? '<=' : '>'} per-purchase limit ${per}${viaOverride(input.amountPln)}`);
    }
    if (parsed.limits.aggregatePln !== undefined) {
      const spent = input.spentPln ?? 0;
      const within = round2(input.amountPln + spent) <= parsed.limits.aggregatePln;
      const ok = within || covered(input.amountPln);
      push(
        'aggregate',
        ok,
        `amount ${input.amountPln.toFixed(2)} + spent ${spent.toFixed(2)} ${within ? '<=' : '>'} aggregate limit ${parsed.limits.aggregatePln}${within ? '' : viaOverride(input.amountPln)}`,
      );
    }
  }
  if (input.category !== undefined && parsed.limits.categories) {
    const wanted = input.category.toLowerCase();
    const ok = parsed.limits.categories.some((c) => c.toLowerCase() === wanted);
    push('category', ok, `category "${input.category}" ${ok ? 'is' : 'is NOT'} in [${parsed.limits.categories.join('; ')}]`);
  }
  if (input.domain !== undefined && parsed.limits.marketplaces) {
    const ok = domainMatches(input.domain, parsed.limits.marketplaces);
    push('domain', ok, `domain "${input.domain}" ${ok ? 'is' : 'is NOT'} in allowlist [${parsed.limits.marketplaces.join(', ')}]`);
  }

  return {
    ok: items.every((i) => i.ok),
    items,
    hash,
    parsed,
    remainingPln,
    mandateId: parsed.header.mandateId,
  };
}

function describeLimits(l: Partial<MandateLimits>): string {
  return (
    `${l.perItemPln !== undefined ? `per-item <= ${l.perItemPln} PLN; ` : ''}per-purchase <= ${l.perPurchasePln} PLN; aggregate <= ${l.aggregatePln} PLN; ` +
    `${l.validFrom}..${l.validTo}; categories [${(l.categories ?? []).join('; ')}]; ` +
    `marketplaces [${(l.marketplaces ?? []).join(', ')}]`
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatCheck(res: CheckResult): string {
  const lines: string[] = [];
  for (const i of res.items) lines.push(`${i.ok ? 'OK  ' : 'FAIL'} ${i.id.padEnd(12)} ${i.detail}`);
  if (res.hash) {
    lines.push(`hash: ${res.hash.hash}`);
    lines.push(`range: lines ${res.hash.fromLine}-${res.hash.toLine} (1-based, inclusive)`);
  }
  if (res.remainingPln !== undefined) lines.push(`remaining aggregate limit: ${res.remainingPln.toFixed(2)} PLN`);
  lines.push(res.ok ? 'MANDATE: GREEN' : 'MANDATE: RED');
  return lines.join('\n');
}
