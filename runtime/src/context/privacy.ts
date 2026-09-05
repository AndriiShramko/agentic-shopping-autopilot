/**
 * Privacy filter for everything the context module lets out of a knowledge store: a snippet with a
 * PII-looking value or a secret word is dropped (counted, never shown), and `asa context:note` refuses
 * text that carries one. The filter is the union of the shopping-profile check (postal code, phone,
 * parcel-locker code, NIP, IBAN) and the kinds below. A finding never echoes the value itself.
 */
import { piiKindsIn } from '../profile.js';
import { redactString } from '../redact.js';

export const RE_EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u;
/** Sixteen digits, optionally in groups of four with blanks or hyphens (a card number). */
export const RE_CARD16 = /(?<!\d)(?:\d[ -]?){15}\d(?!\d)/;
/** Eleven-digit runs; kept only when the PESEL date field and checksum are valid (offer ids after a "/" are ignored). */
export const RE_PESEL11 = /(?<![\d/])\d{11}(?!\d)/gu;
/** Two capital letters and seven digits (a passport number). */
export const RE_PASSPORT = /(?<![\p{L}\p{N}])[A-Z]{2} ?\d{7}(?![\p{L}\p{N}])/u;
export const RE_SECRET_WORDS = /пароль|hasło|haslo|password|passwd|token|api[ _-]?key|secret/iu;
/** "PIN" as a whole word, upper case only (a pin header is not a PIN). */
export const RE_PIN = /(?<![\p{L}\p{N}])PIN(?![\p{L}\p{N}])/u;
export const RE_DOB = /дата\s*рожд|д\.\s*р\.|data\s*urodzenia|date\s*of\s*birth|(?<![\p{L}])dob(?![\p{L}])|urodzon[aey]|родил(?:ся|ась|а)(?![\p{L}])/iu;

export type ContextPiiKind = ReturnType<typeof piiKindsIn>[number] | 'pii_email' | 'pii_card' | 'pii_pesel' | 'pii_passport' | 'pii_dob' | 'secret_word';

/** Eleven digits with a valid PESEL month field, day and checksum. */
export function isPeselLike(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const mm = Number(digits.slice(2, 4));
  const month = mm % 20;
  if (mm > 92 || month < 1 || month > 12) return false;
  const dd = Number(digits.slice(4, 6));
  if (dd < 1 || dd > 31) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * weights[i];
  return (10 - (sum % 10)) % 10 === Number(digits[10]);
}

/** Every PII / secret kind found in one line of text (the value is never returned). */
export function contextPiiKinds(text: string): ContextPiiKind[] {
  const kinds: ContextPiiKind[] = [...piiKindsIn(text)];
  if (RE_EMAIL.test(text)) kinds.push('pii_email');
  if (RE_CARD16.test(text)) kinds.push('pii_card');
  for (const m of text.matchAll(RE_PESEL11)) {
    if (isPeselLike(m[0])) {
      kinds.push('pii_pesel');
      break;
    }
  }
  if (RE_PASSPORT.test(text)) kinds.push('pii_passport');
  if (RE_SECRET_WORDS.test(text) || RE_PIN.test(text)) kinds.push('secret_word');
  if (RE_DOB.test(text)) kinds.push('pii_dob');
  return kinds;
}

/** Redact the REF_* values, then drop the snippet (null) when anything PII-like or secret-like remains. */
export function sanitizeSnippet(text: string, redactValues: readonly string[]): string | null {
  const redacted = redactString(text, redactValues);
  return contextPiiKinds(redacted).length ? null : redacted;
}

/** `asa context:note` refuses a note that would carry PII or a secret word into the brief (exit 1). */
export function assertNoteClean(text: string): void {
  const kinds = contextPiiKinds(text);
  if (kinds.length) throw new Error(`the note text looks like it carries ${kinds.join(', ')}; notes must not contain addresses, phones, ids, card or account numbers, e-mails, dates of birth or secrets`);
}
