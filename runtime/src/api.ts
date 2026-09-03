/**
 * Allegro REST API channel for search (read-only): OAuth2 device flow + GET /offers/listing.
 * Implemented from the public endpoint schema only; no third-party MCP server is installed.
 *
 * Tokens live in ALLEGRO_TOKEN_FILE (gitignored) and are never printed or logged.
 * A 403 "verified applications" answer is not an error to retry: it means the application is not
 * verified yet and the caller falls back to the SERP channel.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeConfig } from './config.js';
import { normalizeApiOffer, type Offer } from './offers.js';

export const ALLEGRO_AUTH = 'https://allegro.pl/auth/oauth';
export const ALLEGRO_API = 'https://api.allegro.pl';
export const ACCEPT_V1 = 'application/vnd.allegro.public.v1+json';

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  scope?: string;
  /** epoch ms */
  expires_at: number;
  grant: 'device' | 'client_credentials';
}

export class ApiNotVerifiedError extends Error {
  constructor(message = 'Allegro application is not verified for /offers/listing (HTTP 403)') {
    super(message);
    this.name = 'ApiNotVerifiedError';
  }
}

export class ApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConfigError';
  }
}

function basicAuth(cfg: RuntimeConfig): string {
  if (!cfg.allegroClientId || !cfg.allegroClientSecret) {
    throw new ApiConfigError('ALLEGRO_CLIENT_ID / ALLEGRO_CLIENT_SECRET not set in config.env (question 5 to Andrii)');
  }
  return 'Basic ' + Buffer.from(`${cfg.allegroClientId}:${cfg.allegroClientSecret}`, 'utf8').toString('base64');
}

export function readTokenFile(file: string): TokenSet | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as TokenSet;
  } catch {
    return undefined;
  }
}

export function writeTokenFile(file: string, token: TokenSet): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(token, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  scope?: string;
  expires_in: number;
  error?: string;
}

async function tokenRequest(cfg: RuntimeConfig, params: Record<string, string>): Promise<TokenResponse> {
  const url = new URL(`${ALLEGRO_AUTH}/token`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { method: 'POST', headers: { Authorization: basicAuth(cfg) } });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok && !body.error) throw new Error(`token endpoint HTTP ${res.status}`);
  return body;
}

export interface DeviceFlowHooks {
  /** Called once with the URL Andrii has to open and the code to confirm (printed, not logged). */
  onUserCode: (verificationUriComplete: string, userCode: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export async function clientCredentialsToken(cfg: RuntimeConfig): Promise<TokenSet> {
  const body = await tokenRequest(cfg, { grant_type: 'client_credentials' });
  if (body.error || !body.access_token) throw new Error(`client_credentials failed: ${body.error ?? 'no token'}`);
  return {
    access_token: body.access_token,
    token_type: body.token_type,
    scope: body.scope,
    expires_at: Date.now() + body.expires_in * 1000 - 30_000,
    grant: 'client_credentials',
  };
}

export async function deviceFlowToken(cfg: RuntimeConfig, hooks: DeviceFlowHooks): Promise<TokenSet> {
  const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const startUrl = new URL(`${ALLEGRO_AUTH}/device`);
  startUrl.searchParams.set('client_id', cfg.allegroClientId as string);
  const start = await fetch(startUrl, {
    method: 'POST',
    headers: { Authorization: basicAuth(cfg), 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!start.ok) throw new Error(`device endpoint HTTP ${start.status}`);
  const dev = (await start.json()) as {
    device_code: string;
    user_code: string;
    verification_uri_complete: string;
    interval: number;
    expires_in: number;
  };
  hooks.onUserCode(dev.verification_uri_complete, dev.user_code);
  const deadline = Date.now() + dev.expires_in * 1000;
  let interval = Math.max(dev.interval, 5) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const body = await tokenRequest(cfg, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: dev.device_code,
    });
    if (body.access_token) {
      return {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        token_type: body.token_type,
        scope: body.scope,
        expires_at: Date.now() + body.expires_in * 1000 - 30_000,
        grant: 'device',
      };
    }
    if (body.error === 'slow_down') interval += 5000;
    else if (body.error && body.error !== 'authorization_pending') throw new Error(`device flow: ${body.error}`);
  }
  throw new Error('device flow: user code expired before confirmation');
}

export async function refreshToken(cfg: RuntimeConfig, token: TokenSet): Promise<TokenSet> {
  if (!token.refresh_token) throw new Error('no refresh_token');
  const body = await tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: token.refresh_token });
  if (body.error || !body.access_token) throw new Error(`refresh failed: ${body.error ?? 'no token'}`);
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? token.refresh_token,
    token_type: body.token_type,
    scope: body.scope,
    expires_at: Date.now() + body.expires_in * 1000 - 30_000,
    grant: token.grant,
  };
}

export type AuthMode = 'client' | 'device';

/** Cached token, refreshed or re-acquired as needed. Never returns to the caller anything but the TokenSet object. */
export async function getToken(cfg: RuntimeConfig, mode: AuthMode, hooks?: DeviceFlowHooks): Promise<TokenSet> {
  const cached = readTokenFile(cfg.allegroTokenFile);
  if (cached && cached.grant === (mode === 'client' ? 'client_credentials' : 'device')) {
    if (cached.expires_at > Date.now()) return cached;
    if (cached.refresh_token) {
      try {
        const t = await refreshToken(cfg, cached);
        writeTokenFile(cfg.allegroTokenFile, t);
        return t;
      } catch {
        /* fall through to a fresh grant */
      }
    }
  }
  const fresh =
    mode === 'client'
      ? await clientCredentialsToken(cfg)
      : await deviceFlowToken(cfg, hooks ?? { onUserCode: () => undefined });
  writeTokenFile(cfg.allegroTokenFile, fresh);
  return fresh;
}

export interface ListingQuery {
  phrase: string;
  priceTo?: number;
  priceFrom?: number;
  categoryId?: string;
  limit?: number;
  offset?: number;
  /** '+price' ascending, '-price' descending; default '+price' */
  sort?: string;
}

export interface ListingResult {
  offers: Offer[];
  count: number;
  rawCount: number;
}

export async function searchListing(token: TokenSet, q: ListingQuery, apiBase: string = ALLEGRO_API): Promise<ListingResult> {
  const url = new URL(`${apiBase}/offers/listing`);
  url.searchParams.set('phrase', q.phrase);
  url.searchParams.set('sellingMode.format', 'BUY_NOW');
  url.searchParams.set('sort', q.sort ?? '+price');
  url.searchParams.set('limit', String(q.limit ?? 30));
  url.searchParams.set('offset', String(q.offset ?? 0));
  if (q.priceTo !== undefined) url.searchParams.set('price.to', String(q.priceTo));
  if (q.priceFrom !== undefined) url.searchParams.set('price.from', String(q.priceFrom));
  if (q.categoryId) url.searchParams.set('category.id', q.categoryId);
  const res = await fetch(url, {
    headers: { Accept: ACCEPT_V1, Authorization: `Bearer ${token.access_token}`, 'Accept-Language': 'pl-PL' },
  });
  if (res.status === 403) throw new ApiNotVerifiedError();
  if (!res.ok) throw new Error(`/offers/listing HTTP ${res.status}`);
  const body = (await res.json()) as {
    items?: { promoted?: Record<string, unknown>[]; regular?: Record<string, unknown>[] };
    searchMeta?: { totalCount?: number };
  };
  const raw = [...(body.items?.promoted ?? []), ...(body.items?.regular ?? [])];
  const offers = raw.map(normalizeApiOffer).filter((o) => o.id && Number.isFinite(o.price_pln));
  return { offers, count: offers.length, rawCount: body.searchMeta?.totalCount ?? raw.length };
}
