/**
 * Runtime configuration: locates the private repo (ASA_PRIVATE_DIR / --private-dir),
 * reads config.env from it and exposes typed values.
 *
 * Secrets (client secret, REF_* recipient data) are loaded for mechanical checks only.
 * They are never printed, never logged and never written anywhere except config.env itself.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { splitSpecs } from './context/store.js';
import { parseLang, type Lang } from './i18n.js';

/** Platform-neutral default; override with ASA_PRIVATE_DIR or --private-dir. */
export const DEFAULT_PRIVATE_DIR = path.join(os.homedir(), '.asa', 'private');

/** The only keys config.env may contain (see the operational spec). */
export const CONFIG_KEYS = [
  'MANDATE_PATH',
  'MANDATE_SHA256',
  'ALLEGRO_CLIENT_ID',
  'ALLEGRO_CLIENT_SECRET',
  'ALLEGRO_TOKEN_FILE',
  'CDP_URL',
  'HUMAN_CONFIRM',
  'REF_FULL_NAME',
  'REF_DELIVERY_ADDRESS',
  'REF_PICKUP_POINT',
  // Smart! basket (2026-09-04): free delivery threshold per seller, complement window, profile location
  'SMART_THRESHOLD_PLN',
  'SMART_SLACK_PLN',
  'MAX_COMPLEMENTS',
  'REORDER_COOLDOWN_DAYS',
  'SHOPPING_PROFILE_DIR',
  'DEFAULT_RAIL',
  'ALLEGRO_LOGIN',
  // Context-first (2026-09-05): the user's knowledge stores, the allow / deny lists, the brief freshness window
  'CONTEXT_STORES',
  'CONTEXT_INCLUDE',
  'CONTEXT_EXCLUDE',
  'CONTEXT_MAX_SNIPPETS',
  'CONTEXT_MAX_PER_FILE',
  'CONTEXT_STALE_DAYS',
  'CONTEXT_BRIEF_MAX_AGE_MIN',
  'CONTEXT_OPTIONAL',
  // Language of the strings shown to people (en default, ru); parsers stay bilingual
  'ASA_LANG',
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export const DEFAULT_CONTEXT_MAX_SNIPPETS = 40;
export const DEFAULT_CONTEXT_MAX_PER_FILE = 5;
export const DEFAULT_CONTEXT_STALE_DAYS = 180;
export const DEFAULT_CONTEXT_BRIEF_MAX_AGE_MIN = 240;

export type Rail = 'oneclick_card' | 'allegro_pay';

/**
 * Allegro Smart! (regulations of 2026-03-02, verified 2026-09-04): delivery is free when the sum of item
 * prices from ONE seller in one order is >= 49.90 PLN (per seller, never per basket); subscriptions
 * started before 2026-03-02 keep 45 PLN (lockers/points) / 65 PLN (courier) until renewal.
 */
export const DEFAULT_SMART_THRESHOLD_PLN = 49.9;
export const DEFAULT_SMART_SLACK_PLN = 25;
export const DEFAULT_MAX_COMPLEMENTS = 1;
export const DEFAULT_REORDER_COOLDOWN_DAYS = 30;
export const DEFAULT_RAIL: Rail = 'oneclick_card';

/** Values that must never appear in logs, snapshots, reports or the model context. */
export const SECRET_KEYS: ReadonlySet<string> = new Set<string>([
  'ALLEGRO_CLIENT_SECRET',
  'REF_FULL_NAME',
  'REF_DELIVERY_ADDRESS',
  'REF_PICKUP_POINT',
]);

export interface RuntimeConfig {
  privateDir: string;
  configPath: string;
  configExists: boolean;
  mandatePath: string;
  mandateSha256?: string;
  allegroClientId?: string;
  allegroClientSecret?: string;
  allegroTokenFile: string;
  cdpUrl: string;
  humanConfirm: boolean;
  refFullName?: string;
  refDeliveryAddress?: string;
  refPickupPoint?: string;
  /** Smart! free-delivery threshold per seller (49.90; grandfathered subscriptions 45 / 65). */
  smartThresholdPln: number;
  /** Complement window above the gap to the threshold: delta <= price <= delta + slack. */
  smartSlackPln: number;
  /** How many complementary lines may be added to a basket (shown: up to 3). */
  maxComplements: number;
  /** A non-consumable bought within this many days is not proposed again. */
  reorderCooldownDays: number;
  /** wishlist.jsonl, purchase-history.jsonl, sellers.json, do-not-buy.txt live here (private). */
  shoppingProfileDir: string;
  defaultRail: Rail;
  /** Expected Allegro account login (compared with the logged-in account; never printed). */
  allegroLogin?: string;
  /** Knowledge-store specs ("obsidian:<path>", "jsonl:<path>", "folder:<path>"); ASA_CONTEXT_STORES overrides. */
  contextStores: string[];
  /** Include globs for vault stores (CONTEXT_INCLUDE); undefined = the default allow-list of the adapter. */
  contextInclude?: string[];
  /** Extra exclude globs for the stores; the default and hard excludes always apply and cannot be removed. */
  contextExclude: string[];
  /** How many snippets a need brief keeps (default 40). */
  contextMaxSnippets: number;
  /** Snippets per file (default 5). */
  contextMaxPerFile: number;
  /** A note older than this many days is flagged stale in the brief (default 180). */
  contextStaleDays: number;
  /** A brief older than this is stale for the gate (default 240 minutes). */
  contextBriefMaxAgeMin: number;
  /** CONTEXT_OPTIONAL=1 (an owner decision in config.env) is the only thing that lets `--no-context <code>` pass the gate. */
  contextOptional: boolean;
  /** Language of the strings shown to people: en (default) or ru; ASA_LANG in the environment overrides. */
  lang: Lang;
  unknownKeys: string[];
}

/** Parse KEY=VALUE lines (optional `export`, quotes and `#` comments supported). */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const dq = value.startsWith('"') && value.endsWith('"') && value.length >= 2;
    const sq = value.startsWith("'") && value.endsWith("'") && value.length >= 2;
    if (dq || sq) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[m[1]] = value;
  }
  return out;
}

export function resolvePrivateDir(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): string {
  const i = argv.indexOf('--private-dir');
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);
  const eq = argv.find((a) => a.startsWith('--private-dir='));
  if (eq) return path.resolve(eq.slice('--private-dir='.length));
  if (env.ASA_PRIVATE_DIR) return path.resolve(env.ASA_PRIVATE_DIR);
  return DEFAULT_PRIVATE_DIR;
}

export interface LoadConfigOptions {
  privateDir?: string;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
}

export function loadConfig(opts: LoadConfigOptions = {}): RuntimeConfig {
  const env = opts.env ?? process.env;
  const privateDir = opts.privateDir ?? resolvePrivateDir(opts.argv, env);
  const configPath = path.join(privateDir, 'config.env');
  const configExists = fs.existsSync(configPath);
  const values = configExists ? parseEnvText(fs.readFileSync(configPath, 'utf8')) : {};
  const known = new Set<string>(CONFIG_KEYS);
  const unknownKeys = Object.keys(values).filter((k) => !known.has(k));
  const nonEmpty = (k: ConfigKey): string | undefined => (values[k] && values[k].length > 0 ? values[k] : undefined);
  // environment overrides (tests, one-off runs against another vault) take precedence over config.env
  const envStores = env.ASA_CONTEXT_STORES && env.ASA_CONTEXT_STORES.trim().length ? env.ASA_CONTEXT_STORES : undefined;
  const envLang = parseLang(env.ASA_LANG);
  const extraExcludes = splitSpecs(nonEmpty('CONTEXT_EXCLUDE') ?? '');
  const includeRaw = nonEmpty('CONTEXT_INCLUDE');

  return {
    privateDir,
    configPath,
    configExists,
    mandatePath: nonEmpty('MANDATE_PATH') ?? path.join(privateDir, 'PURCHASE_MANDATE.md'),
    mandateSha256: nonEmpty('MANDATE_SHA256')?.toLowerCase(),
    allegroClientId: nonEmpty('ALLEGRO_CLIENT_ID'),
    allegroClientSecret: nonEmpty('ALLEGRO_CLIENT_SECRET'),
    allegroTokenFile: nonEmpty('ALLEGRO_TOKEN_FILE') ?? path.join(privateDir, 'secrets', 'allegro-token.json'),
    cdpUrl: nonEmpty('CDP_URL') ?? 'http://127.0.0.1:9222',
    humanConfirm: (nonEmpty('HUMAN_CONFIRM') ?? '0') === '1',
    refFullName: nonEmpty('REF_FULL_NAME'),
    refDeliveryAddress: nonEmpty('REF_DELIVERY_ADDRESS'),
    refPickupPoint: nonEmpty('REF_PICKUP_POINT'),
    smartThresholdPln: numberOr(nonEmpty('SMART_THRESHOLD_PLN'), DEFAULT_SMART_THRESHOLD_PLN, 'SMART_THRESHOLD_PLN'),
    smartSlackPln: numberOr(nonEmpty('SMART_SLACK_PLN'), DEFAULT_SMART_SLACK_PLN, 'SMART_SLACK_PLN'),
    maxComplements: Math.max(0, Math.trunc(numberOr(nonEmpty('MAX_COMPLEMENTS'), DEFAULT_MAX_COMPLEMENTS, 'MAX_COMPLEMENTS'))),
    reorderCooldownDays: Math.max(0, Math.trunc(numberOr(nonEmpty('REORDER_COOLDOWN_DAYS'), DEFAULT_REORDER_COOLDOWN_DAYS, 'REORDER_COOLDOWN_DAYS'))),
    shoppingProfileDir: nonEmpty('SHOPPING_PROFILE_DIR') ?? path.join(privateDir, 'shopping-profile'),
    defaultRail: railOr(nonEmpty('DEFAULT_RAIL')),
    allegroLogin: nonEmpty('ALLEGRO_LOGIN'),
    contextStores: splitSpecs(envStores ?? nonEmpty('CONTEXT_STORES') ?? ''),
    contextInclude: includeRaw ? splitSpecs(includeRaw) : undefined,
    contextExclude: extraExcludes,
    contextMaxSnippets: Math.max(1, Math.trunc(numberOr(nonEmpty('CONTEXT_MAX_SNIPPETS'), DEFAULT_CONTEXT_MAX_SNIPPETS, 'CONTEXT_MAX_SNIPPETS'))),
    contextMaxPerFile: Math.max(1, Math.trunc(numberOr(nonEmpty('CONTEXT_MAX_PER_FILE'), DEFAULT_CONTEXT_MAX_PER_FILE, 'CONTEXT_MAX_PER_FILE'))),
    contextStaleDays: Math.max(1, numberOr(nonEmpty('CONTEXT_STALE_DAYS'), DEFAULT_CONTEXT_STALE_DAYS, 'CONTEXT_STALE_DAYS')),
    contextBriefMaxAgeMin: Math.max(1, numberOr(nonEmpty('CONTEXT_BRIEF_MAX_AGE_MIN'), DEFAULT_CONTEXT_BRIEF_MAX_AGE_MIN, 'CONTEXT_BRIEF_MAX_AGE_MIN')),
    contextOptional: (nonEmpty('CONTEXT_OPTIONAL') ?? '0') === '1',
    lang: envLang ?? parseLang(nonEmpty('ASA_LANG')) ?? 'en',
    unknownKeys,
  };
}

function numberOr(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined) return fallback;
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${key} in config.env must be a non-negative number, got "${raw}"`);
  return n;
}

function railOr(raw: string | undefined): Rail {
  if (raw === undefined) return DEFAULT_RAIL;
  if (raw === 'oneclick_card' || raw === 'allegro_pay') return raw;
  throw new Error(`DEFAULT_RAIL in config.env must be oneclick_card or allegro_pay, got "${raw}"`);
}

/** Non-empty REF_* values: everything the redaction filter must replace with [REDACTED]. */
export function refValues(cfg: RuntimeConfig): string[] {
  return [cfg.refFullName, cfg.refDeliveryAddress, cfg.refPickupPoint].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
}

/**
 * Insert or replace KEY=VALUE lines in config.env, keeping every other line intact.
 * Used by `ref:capture`; the values are written to disk only and never returned or printed.
 */
export function writeConfigValues(configPath: string, updates: Partial<Record<ConfigKey, string>>): void {
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const lines = existing.length ? existing.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const pending = new Map<string, string>(
    Object.entries(updates).filter(([, v]) => typeof v === 'string') as [string, string][],
  );
  const out: string[] = [];
  for (const line of lines) {
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && pending.has(m[1])) {
      out.push(`${m[1]}=${quoteEnv(pending.get(m[1]) as string)}`);
      pending.delete(m[1]);
    } else {
      out.push(line);
    }
  }
  for (const [k, v] of pending) out.push(`${k}=${quoteEnv(v)}`);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, out.join('\n') + '\n', { encoding: 'utf8' });
}

function quoteEnv(v: string): string {
  return /[\s#"']/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}
