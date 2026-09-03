/**
 * Domain allowlist for the runtime. Actions and reads are permitted only on these hosts;
 * the bank's 3DS page (ACS) is deliberately NOT allowlisted: between challenge_3ds start and done
 * the runtime neither clicks nor reads, it only waits for the return to an allowlisted host.
 */
export const DEFAULT_ALLOWLIST: readonly string[] = ['*.allegro.pl', 'allegro.pl', '*.payu.com', 'payu.com'];

export function hostAllowed(host: string, patterns: readonly string[] = DEFAULT_ALLOWLIST): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  for (const p of patterns) {
    const pat = p.toLowerCase().trim();
    if (!pat) continue;
    if (pat.startsWith('*.')) {
      const base = pat.slice(2);
      if (h === base || h.endsWith('.' + base)) return true;
    } else if (h === pat) {
      return true;
    }
  }
  return false;
}

export function urlAllowed(url: string, patterns: readonly string[] = DEFAULT_ALLOWLIST): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return hostAllowed(u.hostname, patterns);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
