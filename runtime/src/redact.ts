/**
 * Redaction filter for audit lines, snapshots and reports.
 * - every REF_* value (recipient name, delivery address, pickup point) becomes [REDACTED];
 * - keys that carry address / recipient data are dropped entirely;
 * - order ids, amounts, offer URLs and seller names are kept (docs/security.md, section 3.3).
 */
export const REDACTED = '[REDACTED]';

export const DROP_KEYS: ReadonlySet<string> = new Set([
  'address',
  'delivery_address',
  'deliveryaddress',
  'pickup_point',
  'pickuppoint',
  'paczkomat',
  'recipient',
  'recipient_name',
  'full_name',
  'fullname',
  'phone',
  'email',
  'street',
  'postal_code',
  'postcode',
  'city',
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace every occurrence of each value (case-insensitive, whitespace-tolerant) with [REDACTED]. */
export function redactString(input: string, values: readonly string[]): string {
  let out = input;
  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed) continue;
    const pattern = trimmed.split(/\s+/).map(escapeRegExp).join('\\s+');
    out = out.replace(new RegExp(pattern, 'gi'), REDACTED);
  }
  return out;
}

/** Deep-redact an arbitrary JSON-like value. Drops DROP_KEYS, redacts strings. */
export function redactDeep<T>(value: T, values: readonly string[], dropKeys: ReadonlySet<string> = DROP_KEYS): T {
  if (typeof value === 'string') return redactString(value, values) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, values, dropKeys)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (dropKeys.has(k.toLowerCase())) continue;
      out[k] = redactDeep(v, values, dropKeys);
    }
    return out as T;
  }
  return value;
}
