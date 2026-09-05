/**
 * Term matching for the knowledge-store adapters: cheap folding so that a term typed by the operator
 * session finds the same fact written in another script or notation, per-line scoring and the recency
 * boost. Pure functions, no I/O.
 */

/**
 * Fold text for comparison: NFKC, lower case, diacritics stripped (ё→е, ą→a, ł→l), "×" → "x",
 * "180 × 200" → "180x200", a decimal comma between digits → a dot, runs of blanks collapsed.
 * Newlines are preserved so that a folded file splits into the same lines as the original.
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
    .replace(/(\d)[ \t]*[x×][ \t]*(\d)/g, '$1x$2')
    .replace(/×/g, 'x')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[ \t ]+/g, ' ');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface TermMatcher {
  term: string;
  folded: string;
  re: RegExp;
}

/** Final letters that inflection replaces: vowels plus the Cyrillic soft sign and short i. */
const INFLECTED_FINALS = new Set('aeiouyąęóàáâãäåèéêëìíîïòôõöùúûüýаеёиоуыэюяіїьй');

/**
 * Regexp body of one folded term: inner blanks match any run of blanks; the final letter of a word of
 * four letters or more is optional when inflection replaces it (наволочка → наволочки, кровать →
 * кровати, poszewka → poszewki, prześcieradło → prześcieradła); the whole term may carry up to three
 * trailing letters (матрас → матрасы/матрасами, sheet → sheets). Codes and sizes (m5, 180x200) stay exact.
 */
function termBody(folded: string): string {
  const last = folded[folded.length - 1];
  const word = /[\p{L}]{4,}$/u.test(folded);
  const stem = word && INFLECTED_FINALS.has(last) ? `${escapeRegExp(folded.slice(0, -1))}(?:${escapeRegExp(last)})?` : escapeRegExp(folded);
  return stem.replace(/ /g, '\\s+');
}

/** One matcher per distinct term; the term must start at a word boundary. Terms under two characters are dropped. */
export function termMatchers(terms: readonly string[]): TermMatcher[] {
  const seen = new Set<string>();
  const out: TermMatcher[] = [];
  for (const raw of terms) {
    const folded = fold(raw).trim();
    if (folded.length < 2 || seen.has(folded)) continue;
    seen.add(folded);
    out.push({ term: raw.trim(), folded, re: new RegExp(`(?<![\\p{L}\\p{N}])${termBody(folded)}\\p{L}{0,3}(?![\\p{L}\\p{N}])`, 'gu') });
  }
  return out;
}

/** One regexp that tells whether a folded line contains ANY of the terms (cheap pre-filter). */
export function combinedMatcher(matchers: readonly TermMatcher[]): RegExp | undefined {
  if (!matchers.length) return undefined;
  const alts = matchers.map((m) => termBody(m.folded)).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})`, 'u');
}

/** Per-term hits are capped at 3; two or more distinct terms on one line earn a bonus. */
export function scoreFolded(folded: string, matchers: readonly TermMatcher[]): number {
  let score = 0;
  let distinct = 0;
  for (const m of matchers) {
    let hits = 0;
    m.re.lastIndex = 0;
    while (hits < 3 && m.re.exec(folded)) hits++;
    if (hits > 0) {
      distinct++;
      score += hits;
    }
  }
  if (distinct >= 2) score += 2 * (distinct - 1);
  return score;
}

/** Σ per-term hits (word-boundary, case-folded, Unicode-aware) with a bonus for ≥ 2 distinct terms. */
export function scoreLine(text: string, terms: readonly string[]): number {
  return scoreFolded(fold(text), termMatchers(terms));
}

export const RECENCY_FULL_DAYS = 30;
export const RECENCY_HALF_DAYS = 365;

/** 1.0 for a file modified within 30 days, falling linearly to 0.5 at 365 days and beyond. */
export function recencyBoost(modifiedIso: string, now: Date): number {
  const t = Date.parse(modifiedIso);
  if (!Number.isFinite(t)) return 0.75;
  const days = (now.getTime() - t) / 86_400_000;
  if (days <= RECENCY_FULL_DAYS) return 1;
  if (days >= RECENCY_HALF_DAYS) return 0.5;
  return 1 - 0.5 * ((days - RECENCY_FULL_DAYS) / (RECENCY_HALF_DAYS - RECENCY_FULL_DAYS));
}

/** Folded tokens of letters/digits, two characters or longer (for need matching). */
export function foldedTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of fold(s).matchAll(/[\p{L}\p{N}]+/gu)) if (m[0].length >= 2) out.add(m[0]);
  return out;
}
