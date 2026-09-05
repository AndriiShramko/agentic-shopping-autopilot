/**
 * Term matching for the knowledge-store adapters: folding so that a term typed by the operator session
 * finds the same fact written in another script or notation, Unicode-aware word boundaries, stem-prefix
 * matching for inflected languages, per-line scoring and the recency boost. Pure functions, no I/O.
 *
 * No ASCII `\b` anywhere in this file: JavaScript's `\b` knows only [A-Za-z0-9_], so `\bпростыня\b`
 * never matches. Boundaries are `(?<![\p{L}\p{N}])` … `(?![\p{L}\p{N}])` with the `u` flag.
 */

/**
 * Fold text for comparison: NFKC, lower case, diacritics stripped (ё→е, ą→a, ś→s), ł→l, "×", Latin "x"
 * and Cyrillic "х" between digits (with or without blanks) → "x" ("180 × 200", "180х200", "180 x 200"
 * → "180x200"), a см/cm/мм/mm unit after a number dropped ("180x200 см" → "180x200"), a decimal comma
 * between digits → a dot, runs of blanks collapsed. Newlines are preserved so that a folded file splits
 * into the same lines as the original.
 */
export function fold(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/ł/g, 'l')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .replace(/(\d)[ \t]*[x×х][ \t]*(\d)/g, '$1x$2')
    .replace(/×/g, 'x')
    .replace(/(\d)[ \t]*(?:см|cm|мм|mm)(?![\p{L}\p{N}])/gu, '$1')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[ \t]+/g, ' ');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface TermMatcher {
  term: string;
  folded: string;
  re: RegExp;
  /** The term carries a digit (a size, a code): exact match, and a hit earns the dimension bonus. */
  dimension: boolean;
}

/** Final letters that inflection replaces (after folding, so no diacritics). */
const INFLECTED_FINALS = new Set('aeiouyаеиоуыэюяь');

/**
 * Regexp body of one folded word. Words of five letters or more match by stem prefix: the last two
 * letters may change (at least five letters are kept), and up to four letters may follow — простыня →
 * простыни / простынь / простынями, prześcieradło → prześcieradła / prześcieradeł, кровать → кровати /
 * кроватью, sheet → sheets, but not sheep. Four-letter words may lose an inflected final letter; shorter
 * words may only grow by two letters. Anything with a digit or punctuation (m5, 180x200, din 912) is exact.
 */
function wordBody(w: string): string {
  if (!/^\p{L}+$/u.test(w)) return escapeRegExp(w);
  const n = w.length;
  if (n >= 5) return `${escapeRegExp(w.slice(0, Math.max(5, n - 2)))}\\p{L}{0,4}`;
  if (n === 4 && INFLECTED_FINALS.has(w[3])) return `${escapeRegExp(w.slice(0, 3))}(?:${escapeRegExp(w[3])})?\\p{L}{0,3}`;
  return `${escapeRegExp(w)}\\p{L}{0,2}`;
}

/** Regexp body of a folded term: one body per word, blanks match any run of blanks. */
export function termBody(folded: string): string {
  return folded.split(' ').filter(Boolean).map(wordBody).join('\\s+');
}

export const BOUNDARY_LEFT = '(?<![\\p{L}\\p{N}])';
export const BOUNDARY_RIGHT = '(?![\\p{L}\\p{N}])';

/** Split a --terms value on commas and semicolons; blanks trimmed, empties dropped. */
export function splitTerms(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One matcher per distinct folded term, Unicode boundaries on both sides. Terms under two characters are dropped. */
export function termMatchers(terms: readonly string[]): TermMatcher[] {
  const seen = new Set<string>();
  const out: TermMatcher[] = [];
  for (const raw of terms) {
    const folded = fold(raw).trim();
    if (folded.length < 2 || seen.has(folded)) continue;
    seen.add(folded);
    out.push({ term: raw.trim(), folded, re: new RegExp(`${BOUNDARY_LEFT}${termBody(folded)}${BOUNDARY_RIGHT}`, 'gu'), dimension: /\p{N}/u.test(folded) });
  }
  return out;
}

/** One regexp that tells whether a folded line contains ANY of the terms (cheap pre-filter). */
export function combinedMatcher(matchers: readonly TermMatcher[]): RegExp | undefined {
  if (!matchers.length) return undefined;
  const alts = matchers.map((m) => termBody(m.folded)).join('|');
  return new RegExp(`${BOUNDARY_LEFT}(?:${alts})`, 'u');
}

/**
 * Per-term hits are capped at 3; two or more distinct terms on one line earn +2 per extra term; a hit
 * on a term with a digit (a size or a code) earns +1.
 */
export function scoreFolded(folded: string, matchers: readonly TermMatcher[]): number {
  let score = 0;
  let distinct = 0;
  let dimension = false;
  for (const m of matchers) {
    let hits = 0;
    m.re.lastIndex = 0;
    while (hits < 3 && m.re.exec(folded)) hits++;
    if (hits > 0) {
      distinct++;
      score += hits;
      if (m.dimension) dimension = true;
    }
  }
  if (distinct >= 2) score += 2 * (distinct - 1);
  if (dimension) score += 1;
  return score;
}

/** Σ per-term hits (Unicode word boundaries, case-folded) with the distinct-term and dimension bonuses. */
export function scoreLine(text: string, terms: readonly string[]): number {
  return scoreFolded(fold(text), termMatchers(terms));
}

export const RECENCY_FULL_DAYS = 30;
export const RECENCY_HALF_DAYS = 365;

/** 1.0 for a note dated within 30 days, falling linearly to 0.5 at 365 days and beyond; 0.75 for an unknown date. */
export function recencyBoost(modifiedIso: string, now: Date): number {
  const t = Date.parse(modifiedIso);
  if (!Number.isFinite(t)) return 0.75;
  const days = (now.getTime() - t) / 86_400_000;
  if (days <= RECENCY_FULL_DAYS) return 1;
  if (days >= RECENCY_HALF_DAYS) return 0.5;
  return 1 - 0.5 * ((days - RECENCY_FULL_DAYS) / (RECENCY_HALF_DAYS - RECENCY_FULL_DAYS));
}

/** Days between an ISO date and `now`; +Infinity when the date does not parse. */
export function ageDays(iso: string, now: Date): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now.getTime() - t) / 86_400_000 : Number.POSITIVE_INFINITY;
}

/** Folded tokens of letters/digits, two characters or longer. */
export function foldedTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of fold(s).matchAll(/[\p{L}\p{N}]+/gu)) if (m[0].length >= 2) out.add(m[0]);
  return out;
}

export function hasCyrillic(s: string): boolean {
  return /\p{Script=Cyrillic}/u.test(s);
}

/** Letter counts by script in a sample: [cyrillic, latin]. */
export function scriptCounts(sample: string): [number, number] {
  let cyr = 0;
  let lat = 0;
  for (const ch of sample) {
    if (/\p{Script=Cyrillic}/u.test(ch)) cyr++;
    else if (/\p{Script=Latin}/u.test(ch)) lat++;
  }
  return [cyr, lat];
}

export interface ScriptShare {
  /** Share of Cyrillic letters among Cyrillic + Latin letters, 0..1 (0 when the sample has no letters). */
  cyrillic: number;
  latin: number;
}

/** Shares of Cyrillic and Latin letters (two decimals) from raw counts. */
export function scriptShareOf(counts: readonly [number, number]): ScriptShare {
  const total = counts[0] + counts[1];
  if (!total) return { cyrillic: 0, latin: 0 };
  const cyr = Math.round((counts[0] / total) * 100) / 100;
  return { cyrillic: cyr, latin: Math.round((1 - cyr) * 100) / 100 };
}

export function scriptShare(sample: string): ScriptShare {
  return scriptShareOf(scriptCounts(sample));
}
