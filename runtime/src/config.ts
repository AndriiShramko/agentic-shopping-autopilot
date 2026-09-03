/**
 * Runtime configuration: locates the private repo (ASA_PRIVATE_DIR / --private-dir),
 * reads config.env from it and exposes typed values.
 *
 * Secrets (client secret, REF_* recipient data) are loaded for mechanical checks only.
 * They are never printed, never logged and never written anywhere except config.env itself.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PRIVATE_DIR = 'C:\\dev\\agentic-shopping-autopilot-private';

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
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

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
  const privateDir = opts.privateDir ?? resolvePrivateDir(opts.argv, opts.env);
  const configPath = path.join(privateDir, 'config.env');
  const configExists = fs.existsSync(configPath);
  const values = configExists ? parseEnvText(fs.readFileSync(configPath, 'utf8')) : {};
  const known = new Set<string>(CONFIG_KEYS);
  const unknownKeys = Object.keys(values).filter((k) => !known.has(k));
  const nonEmpty = (k: ConfigKey): string | undefined => (values[k] && values[k].length > 0 ? values[k] : undefined);

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
    unknownKeys,
  };
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
