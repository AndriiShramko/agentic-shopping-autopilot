/**
 * Layered selector resolver over skills/<site>/selectors.yaml:
 *   layer 1  role  — a11y role + accessible name (Playwright getByRole)
 *   layer 2  css   — data attribute / CSS recorded during the flow recording (channel A)
 *   layer 3  nl    — natural-language description: the runtime does NOT resolve it; it writes an
 *                    a11y snapshot to .state/ and exits with code 3 so the Claude Code session decides,
 *                    fixes selectors.yaml (`asa selectors:set`) and reruns the step (self-healing).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type { Locator, Page } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUNTIME_ROOT = path.resolve(HERE, '..');
export const DEFAULT_SELECTORS_PATH = path.resolve(RUNTIME_ROOT, '..', 'skills', 'allegro.pl', 'selectors.yaml');

export interface RoleSpec {
  role: string;
  name?: string;
}

export interface SelectorEntry {
  role?: RoleSpec;
  css?: string;
  fallback_nl?: string;
}

export interface SelectorMap {
  path: string;
  entries: Record<string, SelectorEntry>;
  /** Additional allowlisted hosts recorded in the skill (e.g. the Allegro Pay host). */
  domains: string[];
  endpoints: Record<string, string>;
}

const RESERVED = new Set(['endpoints', 'domains']);

export function isPlaceholderCss(css: unknown): boolean {
  return typeof css !== 'string' || css.trim() === '' || /^TODO/i.test(css.trim());
}

export function loadSelectors(file: string = DEFAULT_SELECTORS_PATH): SelectorMap {
  const doc = YAML.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  const entries: Record<string, SelectorEntry> = {};
  for (const [id, raw] of Object.entries(doc ?? {})) {
    if (RESERVED.has(id) || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const entry: SelectorEntry = {};
    if (r.role && typeof r.role === 'object') {
      const role = r.role as Record<string, unknown>;
      if (typeof role.role === 'string') entry.role = { role: role.role, name: typeof role.name === 'string' ? role.name : undefined };
    }
    if (!isPlaceholderCss(r.css)) entry.css = String(r.css).trim();
    if (typeof r.fallback_nl === 'string') entry.fallback_nl = r.fallback_nl;
    entries[id] = entry;
  }
  const domainsRaw = doc?.domains;
  const domains = Array.isArray(domainsRaw) ? domainsRaw.filter((d): d is string => typeof d === 'string' && !/^TODO/i.test(d)) : [];
  const endpoints = (doc?.endpoints && typeof doc.endpoints === 'object' ? doc.endpoints : {}) as Record<string, string>;
  return { path: file, entries, domains, endpoints };
}

export type ResolveOutcome =
  | { status: 'resolved'; id: string; layer: 'role' | 'css'; locator: Locator; via: string }
  | { status: 'nl'; id: string; fallback_nl?: string; tried: string[] };

export interface ResolveOptions {
  timeoutMs?: number;
  /** Restrict resolution to a sub-locator (e.g. a cart row). */
  root?: Locator;
}

export async function resolveSelector(page: Page, map: SelectorMap, id: string, opts: ResolveOptions = {}): Promise<ResolveOutcome> {
  const entry = map.entries[id];
  if (!entry) throw new Error(`unknown selector id "${id}" in ${map.path}`);
  const timeout = opts.timeoutMs ?? 3000;
  const scope = opts.root ?? page;
  const tried: string[] = [];

  if (entry.role) {
    const roleName = entry.role.role as Parameters<Page['getByRole']>[0];
    const loc = entry.role.name ? scope.getByRole(roleName, { name: entry.role.name }) : scope.getByRole(roleName);
    const via = `role=${entry.role.role}${entry.role.name ? ` name~"${entry.role.name}"` : ''}`;
    tried.push(via);
    if (await firstVisible(loc, timeout)) return { status: 'resolved', id, layer: 'role', locator: loc.first(), via };
  }
  if (entry.css) {
    const loc = scope.locator(entry.css);
    const via = `css=${entry.css}`;
    tried.push(via);
    if (await firstVisible(loc, timeout)) return { status: 'resolved', id, layer: 'css', locator: loc.first(), via };
  }
  return { status: 'nl', id, fallback_nl: entry.fallback_nl, tried };
}

async function firstVisible(loc: Locator, timeout: number): Promise<boolean> {
  try {
    await loc.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/** Self-healing write-back: set the css layer of one selector id, preserving comments and order. */
export function setSelectorCss(file: string, id: string, css: string): void {
  const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
  if (!doc.hasIn([id])) throw new Error(`unknown selector id "${id}" in ${file}`);
  doc.setIn([id, 'css'], css);
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }), { encoding: 'utf8' });
}

/** Record an additional allowlisted host (e.g. the Allegro Pay host seen during the flow recording). */
export function addSelectorDomain(file: string, host: string): void {
  const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
  const current = doc.get('domains');
  const list: string[] = YAML.isSeq(current) ? (current.toJSON() as string[]) : [];
  if (!list.includes(host)) list.push(host);
  doc.set('domains', list.filter((d) => !/^TODO/i.test(d)));
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }), { encoding: 'utf8' });
}
