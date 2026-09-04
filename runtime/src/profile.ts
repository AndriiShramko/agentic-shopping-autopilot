/**
 * Shopping profile — the only knowledge store the runtime reads (design synthesis 2026-09-04, section 2).
 * Everything lives in the PRIVATE directory (`SHOPPING_PROFILE_DIR`, default <private>/shopping-profile):
 *   wishlist.jsonl          {label, query_pl, category, qty, max_item_pln?, priority, project?, spec?, source?}
 *   purchase-history.jsonl  {date, seller, title, qty, price_pln, category, offer_id?, source}
 *   sellers.json            {trusted: string[], avoid: string[]}
 *   do-not-buy.txt          one title / pattern per line (`# comments` allowed, `/regex/` allowed)
 * The session generates these files from the vault notes; the runtime only reads them and appends to the
 * history after a confirmed order. Missing files are tolerated (empty profile). No field may carry
 * PII: `checkProfileFiles` flags address-like strings and stale files so the session rebuilds them.
 */
import fs from 'node:fs';
import path from 'node:path';

export const PROFILE_FILES = {
  wishlist: 'wishlist.jsonl',
  history: 'purchase-history.jsonl',
  sellers: 'sellers.json',
  doNotBuy: 'do-not-buy.txt',
} as const;

export interface WishlistLine {
  label: string;
  query_pl: string;
  category: string;
  qty: number;
  max_item_pln?: number;
  /** 1 = buy first; higher numbers are lower priority (complement tier 2). */
  priority: number;
  /** Line belongs to a project (invoice with NIP wanted). */
  project?: boolean;
  spec?: Record<string, unknown>;
  /** Vault note the line came from, e.g. "[[Металлическая резьба M5 в PETG]]". */
  source?: string;
  /** Consumables ignore the reorder cooldown. */
  consumable?: boolean;
}

export interface PurchaseRecord {
  /** YYYY-MM-DD */
  date: string;
  seller: string;
  title: string;
  qty: number;
  price_pln: number;
  category: string;
  offer_id?: string;
  source: string;
  consumable?: boolean;
  order_id?: string;
}

export interface SellersFile {
  trusted: string[];
  avoid: string[];
}

export interface ShoppingProfile {
  dir: string;
  wishlist: WishlistLine[];
  history: PurchaseRecord[];
  sellers: SellersFile;
  /** Normalised do-not-buy patterns (lowercase text or a RegExp for `/…/` lines). */
  doNotBuy: (string | RegExp)[];
  /** Files that exist on disk. */
  present: string[];
  /** Lines that could not be parsed (file:line — reason). */
  errors: string[];
}

/** Minimal shape shared by offers, plan lines and history records. */
export interface OfferLike {
  id?: string;
  offer_id?: string;
  seller?: string;
  title: string;
  category?: string;
}

function readTextIfExists(p: string): string | undefined {
  if (!fs.existsSync(p)) return undefined;
  let t = fs.readFileSync(p, 'utf8');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t;
}

export function parseJsonlObjects(text: string, file: string, errors: string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('#')) continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Record<string, unknown>);
      else errors.push(`${file}:${i + 1} — not a JSON object`);
    } catch (e) {
      errors.push(`${file}:${i + 1} — ${(e as Error).message}`);
    }
  }
  return out;
}

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim();
}

export function coerceWishlistLine(raw: Record<string, unknown>): WishlistLine | null {
  const label = asString(raw.label);
  const query = asString(raw.query_pl);
  if (!label || !query) return null;
  const line: WishlistLine = {
    label,
    query_pl: query,
    category: asString(raw.category),
    qty: Math.max(1, Math.trunc(asNumber(raw.qty, 1))),
    priority: Math.max(1, Math.trunc(asNumber(raw.priority, 1))),
  };
  const max = raw.max_item_pln === undefined || raw.max_item_pln === null ? undefined : asNumber(raw.max_item_pln, Number.NaN);
  if (max !== undefined && Number.isFinite(max)) line.max_item_pln = max;
  if (raw.project === true) line.project = true;
  if (raw.consumable === true) line.consumable = true;
  if (raw.spec && typeof raw.spec === 'object' && !Array.isArray(raw.spec)) line.spec = raw.spec as Record<string, unknown>;
  const source = asString(raw.source);
  if (source) line.source = source;
  return line;
}

export function coercePurchaseRecord(raw: Record<string, unknown>): PurchaseRecord | null {
  const title = asString(raw.title);
  const date = asString(raw.date);
  if (!title || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const rec: PurchaseRecord = {
    date: date.slice(0, 10),
    seller: asString(raw.seller),
    title,
    qty: Math.max(1, Math.trunc(asNumber(raw.qty, 1))),
    price_pln: asNumber(raw.price_pln, Number.NaN),
    category: asString(raw.category),
    source: asString(raw.source) || 'unknown',
  };
  if (!Number.isFinite(rec.price_pln)) return null;
  const offerId = asString(raw.offer_id);
  if (offerId) rec.offer_id = offerId;
  const orderId = asString(raw.order_id);
  if (orderId) rec.order_id = orderId;
  if (raw.consumable === true) rec.consumable = true;
  return rec;
}

export function parseDoNotBuy(text: string): (string | RegExp)[] {
  const out: (string | RegExp)[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    const re = /^\/(.+)\/([a-z]*)$/.exec(t);
    if (re) {
      try {
        out.push(new RegExp(re[1], re[2].includes('i') ? re[2] : re[2] + 'i'));
        continue;
      } catch {
        /* fall through: treat as plain text */
      }
    }
    out.push(normalizeTitle(t));
  }
  return out;
}

/** Empty profile: every reader tolerates missing files. */
export function emptyProfile(dir: string): ShoppingProfile {
  return { dir, wishlist: [], history: [], sellers: { trusted: [], avoid: [] }, doNotBuy: [], present: [], errors: [] };
}

export function loadProfile(dir: string): ShoppingProfile {
  const p = emptyProfile(dir);
  const wl = readTextIfExists(path.join(dir, PROFILE_FILES.wishlist));
  if (wl !== undefined) {
    p.present.push(PROFILE_FILES.wishlist);
    for (const raw of parseJsonlObjects(wl, PROFILE_FILES.wishlist, p.errors)) {
      const line = coerceWishlistLine(raw);
      if (line) p.wishlist.push(line);
      else p.errors.push(`${PROFILE_FILES.wishlist} — line without label/query_pl skipped`);
    }
  }
  const hist = readTextIfExists(path.join(dir, PROFILE_FILES.history));
  if (hist !== undefined) {
    p.present.push(PROFILE_FILES.history);
    for (const raw of parseJsonlObjects(hist, PROFILE_FILES.history, p.errors)) {
      const rec = coercePurchaseRecord(raw);
      if (rec) p.history.push(rec);
      else p.errors.push(`${PROFILE_FILES.history} — record without date/title/price skipped`);
    }
  }
  const sellers = readTextIfExists(path.join(dir, PROFILE_FILES.sellers));
  if (sellers !== undefined) {
    p.present.push(PROFILE_FILES.sellers);
    try {
      const v = JSON.parse(sellers) as Partial<Record<'trusted' | 'avoid', unknown>>;
      const list = (x: unknown): string[] => (Array.isArray(x) ? x.map(asString).filter(Boolean) : []);
      p.sellers = { trusted: list(v.trusted), avoid: list(v.avoid) };
    } catch (e) {
      p.errors.push(`${PROFILE_FILES.sellers} — ${(e as Error).message}`);
    }
  }
  const dnb = readTextIfExists(path.join(dir, PROFILE_FILES.doNotBuy));
  if (dnb !== undefined) {
    p.present.push(PROFILE_FILES.doNotBuy);
    p.doNotBuy = parseDoNotBuy(dnb);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Matching

export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Lowercase tokens of letters/digits; one-character tokens ("x", "-") carry no signal and are dropped. */
export function titleTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) if (m[0].length >= 2) out.add(m[0]);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export const BOUGHT_BEFORE_JACCARD = 0.5;

function sameSeller(a: string | undefined, b: string | undefined): boolean {
  const x = (a ?? '').trim().toLowerCase();
  const y = (b ?? '').trim().toLowerCase();
  return x.length > 0 && x === y;
}

function numericOfferId(o: OfferLike): string | undefined {
  const raw = (o.offer_id ?? o.id ?? '').trim();
  const m = /(\d{6,})$/.exec(raw);
  return m ? m[1] : raw || undefined;
}

/**
 * The most recent earlier purchase of "the same thing": the same offer id, or the same seller and a
 * title whose token set overlaps by Jaccard >= 0.5. Undefined when nothing matches.
 */
export function boughtBefore(history: readonly PurchaseRecord[], offer: OfferLike): PurchaseRecord | undefined {
  const id = numericOfferId(offer);
  const tokens = titleTokens(offer.title);
  let best: PurchaseRecord | undefined;
  for (const rec of history) {
    const byId = id !== undefined && rec.offer_id !== undefined && rec.offer_id.trim() === id;
    const byTitle = sameSeller(rec.seller, offer.seller) && jaccard(tokens, titleTokens(rec.title)) >= BOUGHT_BEFORE_JACCARD;
    if (!byId && !byTitle) continue;
    if (!best || rec.date > best.date) best = rec;
  }
  return best;
}

/** Purchases from this seller, newest first (for "покупал 21.07 и 05.08" in the proposal header). */
export function purchasesFromSeller(history: readonly PurchaseRecord[], seller: string): PurchaseRecord[] {
  return history.filter((r) => sameSeller(r.seller, seller)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function daysBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso + 'T00:00:00Z').getTime();
  if (!Number.isFinite(from)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - from) / 86_400_000;
}

/** An earlier purchase of the same thing within the cooldown window (a consumable never counts). */
export function recentlyBought(history: readonly PurchaseRecord[], offer: OfferLike, cooldownDays: number, now: Date = new Date()): PurchaseRecord | undefined {
  const rec = boughtBefore(history, offer);
  if (!rec || rec.consumable) return undefined;
  const days = daysBetween(rec.date, now);
  return days >= 0 && days <= cooldownDays ? rec : undefined;
}

export interface BlockVerdict {
  blocked: boolean;
  reason?: 'do_not_buy' | 'seller_avoided';
  pattern?: string;
}

/** Do-not-buy patterns and avoided sellers. Text patterns match as a substring or as a token subset. */
export function isBlocked(profile: Pick<ShoppingProfile, 'doNotBuy' | 'sellers'>, offer: OfferLike): BlockVerdict {
  if (offer.seller && profile.sellers.avoid.some((s) => sameSeller(s, offer.seller))) {
    return { blocked: true, reason: 'seller_avoided', pattern: offer.seller };
  }
  const title = normalizeTitle(offer.title);
  const tokens = titleTokens(offer.title);
  for (const pat of profile.doNotBuy) {
    if (pat instanceof RegExp) {
      if (pat.test(offer.title)) return { blocked: true, reason: 'do_not_buy', pattern: pat.source };
      continue;
    }
    if (!pat) continue;
    if (title.includes(pat)) return { blocked: true, reason: 'do_not_buy', pattern: pat };
    const pt = titleTokens(pat);
    if (pt.size > 0 && Array.from(pt).every((t) => tokens.has(t))) return { blocked: true, reason: 'do_not_buy', pattern: pat };
  }
  return { blocked: false };
}

/** Wishlist line the offer belongs to: by need label, or by title/query token overlap >= 0.5. */
export function wishlistMatch(wishlist: readonly WishlistLine[], offer: OfferLike & { need?: string }): WishlistLine | undefined {
  if (offer.need) {
    const byLabel = wishlist.find((l) => l.label === offer.need);
    if (byLabel) return byLabel;
  }
  const tokens = titleTokens(offer.title);
  return wishlist.find((l) => jaccard(tokens, titleTokens(l.query_pl)) >= BOUGHT_BEFORE_JACCARD);
}

/** Categories whose items are consumables (reorder cooldown does not apply). */
export function isConsumableCategory(category: string | undefined): boolean {
  return !!category && /расходник|consumable|filament|филамент|клей|adhesive|glue|IPA|silica|силикагел/iu.test(category);
}

// ---------------------------------------------------------------------------------------------
// Writing

export function appendPurchase(dir: string, record: PurchaseRecord): string {
  const rec = coercePurchaseRecord(record as unknown as Record<string, unknown>);
  if (!rec) throw new Error('purchase record needs date (YYYY-MM-DD), title and a numeric price_pln');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, PROFILE_FILES.history);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, prefix + JSON.stringify(rec) + '\n', { encoding: 'utf8', flag: 'a' });
  return file;
}

// ---------------------------------------------------------------------------------------------
// Validation (asa profile:check)

export type ProfileFindingKind = 'pii_postal_code' | 'pii_phone' | 'pii_locker_code' | 'pii_nip' | 'pii_iban' | 'stale' | 'parse_error' | 'category_unknown' | 'missing';

export interface ProfileFinding {
  file: string;
  line?: number;
  kind: ProfileFindingKind;
  /** Never contains the matched value itself. */
  detail: string;
}

export interface ProfileCheck {
  findings: ProfileFinding[];
  pii: boolean;
  stale: boolean;
  ok: boolean;
}

export const PROFILE_MAX_AGE_DAYS = 14;

const RE_POSTAL = /\b\d{2}-\d{3}\b/;
/** Polish phone numbers written with a country code or with group separators (a bare 9-digit offer id is not flagged). */
const RE_PHONE = /\+48[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b|\b\d{3}[\s-]\d{3}[\s-]\d{3}\b|\b(?:tel|telefon|phone)\.?\s*:?\s*\+?\d[\d\s-]{7,}\d\b/i;
/** InPost locker codes: three uppercase letters, digits, optional letter (WAW123A, KRA01M). */
const RE_LOCKER = /\b([A-Z]{3})\d{2,}[A-Z]?\b/;
/** Standard / material designations that share the locker shape (DIN580, ISO4762, AWG12, PLA175). */
const LOCKER_FALSE_POSITIVE_PREFIXES = new Set(['DIN', 'ISO', 'PLA', 'ABS', 'ASA', 'PET', 'TPU', 'AWG', 'IEC', 'SAE', 'UNC', 'UNF', 'JIS', 'PPS', 'PVC', 'LED', 'USB', 'RGB', 'DDR', 'SSD', 'SMD', 'THT', 'PCB', 'ESC', 'GPS', 'DJI', 'HDR', 'MAX', 'MIN', 'VGA', 'RAM', 'ROM', 'CPU', 'GPU', 'PSU', 'ATX', 'PWM', 'RPM', 'ISO', 'EAN', 'GTIN']);
const RE_NIP = /\bNIP\s*[:.]?\s*(?:PL\s?)?\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b|\b\d{3}-\d{3}-\d{2}-\d{2}\b|\b\d{3}-\d{2}-\d{2}-\d{3}\b/i;
const RE_IBAN = /\bPL\s?\d{2}(?:\s?\d{4}){6}\b|\b\d{2}(?:\s\d{4}){6}\b|\b\d{26}\b/;

/** PII-looking strings in one line of text. The finding never echoes the value. */
export function piiKindsIn(text: string): ProfileFindingKind[] {
  const kinds: ProfileFindingKind[] = [];
  if (RE_POSTAL.test(text)) kinds.push('pii_postal_code');
  if (RE_PHONE.test(text)) kinds.push('pii_phone');
  const lockerRe = new RegExp(RE_LOCKER.source, 'g');
  for (const m of text.matchAll(lockerRe)) {
    if (!LOCKER_FALSE_POSITIVE_PREFIXES.has(m[1])) {
      kinds.push('pii_locker_code');
      break;
    }
  }
  if (RE_NIP.test(text)) kinds.push('pii_nip');
  if (RE_IBAN.test(text)) kinds.push('pii_iban');
  return kinds;
}

export interface CheckProfileOptions {
  now?: Date;
  maxAgeDays?: number;
  /** Mandate categories (section 2): wishlist / history categories outside this list are reported. */
  categories?: readonly string[];
}

export function checkProfileFiles(dir: string, opts: CheckProfileOptions = {}): ProfileCheck {
  const now = opts.now ?? new Date();
  const maxAge = opts.maxAgeDays ?? PROFILE_MAX_AGE_DAYS;
  const findings: ProfileFinding[] = [];
  const files = Object.values(PROFILE_FILES);
  for (const file of files) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) {
      findings.push({ file, kind: 'missing', detail: 'file not present (empty profile is tolerated)' });
      continue;
    }
    const ageDays = (now.getTime() - fs.statSync(p).mtimeMs) / 86_400_000;
    if (ageDays > maxAge) findings.push({ file, kind: 'stale', detail: `last modified ${Math.floor(ageDays)} days ago (> ${maxAge}); rebuild it from the vault before proposing a basket` });
    const text = readTextIfExists(p) ?? '';
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const kind of piiKindsIn(lines[i])) findings.push({ file, line: i + 1, kind, detail: `${kind.replace('pii_', '')}-like value on line ${i + 1}; the profile must not carry addresses, phones, locker codes, NIP or IBAN` });
    }
  }
  const profile = loadProfile(dir);
  for (const e of profile.errors) findings.push({ file: e.split(' — ')[0].split(':')[0], kind: 'parse_error', detail: e });
  if (opts.categories && opts.categories.length) {
    const allowed = new Set(opts.categories.map((c) => c.trim().toLowerCase()));
    profile.wishlist.forEach((l, i) => {
      if (l.category && !allowed.has(l.category.trim().toLowerCase())) findings.push({ file: PROFILE_FILES.wishlist, line: i + 1, kind: 'category_unknown', detail: `category "${l.category}" of "${l.label}" is not a mandate category` });
    });
  }
  const pii = findings.some((f) => f.kind.startsWith('pii_'));
  const stale = findings.some((f) => f.kind === 'stale');
  return { findings, pii, stale, ok: !pii && !stale && !findings.some((f) => f.kind === 'parse_error') };
}

export function formatProfileCheck(c: ProfileCheck): string {
  const lines = c.findings.map((f) => `${f.kind.startsWith('pii_') ? 'PII ' : f.kind === 'stale' ? 'OLD ' : f.kind === 'missing' ? '--  ' : 'WARN'} ${f.file}${f.line ? ':' + f.line : ''}  ${f.detail}`);
  lines.push(c.pii ? 'PROFILE: PII FOUND — remove the values, the runtime will not plan a basket from this profile' : c.stale ? 'PROFILE: STALE — rebuild from the vault' : 'PROFILE: OK');
  return lines.join('\n');
}
