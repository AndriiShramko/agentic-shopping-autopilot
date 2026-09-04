/**
 * runtime/.state/ — the interface between the deterministic runtime and the Claude Code session.
 *   step-result.json   { flow, step, status, url, ts, note }   after every runtime step
 *   offers.json        normalised offers (flows/search.md, step 3) written by `search`, read by the session
 *   snapshot-*.yaml    redacted a11y snapshots written when a step needs the session's decision (exit 3)
 * Nothing in .state/ is committed (gitignored) and every snapshot passes the redaction filter first.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { redactString } from './redact.js';
import { RUNTIME_ROOT } from './selectors.js';

export const STATE_DIR = path.join(RUNTIME_ROOT, '.state');

export const EXIT = {
  OK: 0,
  ERROR: 1,
  /** A stop trigger fired: the run halts and the decision goes to the user (chat). */
  STOP: 2,
  /** The runtime could not resolve a step mechanically: the session decides, fixes, reruns. */
  DECISION: 3,
} as const;

export type StepStatus = 'ok' | 'fail' | 'stop' | 'needs-decision' | 'human-confirm' | 'waiting-3ds';

export interface StepResult {
  flow: string;
  step: number | string;
  status: StepStatus;
  url: string;
  ts: string;
  note?: string;
  snapshot?: string;
  data?: Record<string, unknown>;
}

export function ensureStateDir(): string {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  return STATE_DIR;
}

export function statePath(name: string): string {
  return path.join(ensureStateDir(), name);
}

export function writeState(name: string, value: unknown): string {
  const p = statePath(name);
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8' });
  return p;
}

export function readState<T>(name: string): T | undefined {
  const p = path.join(STATE_DIR, name);
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

export function writeStepResult(r: Omit<StepResult, 'ts'> & { ts?: string }): StepResult {
  const full: StepResult = { ...r, ts: r.ts ?? new Date().toISOString() };
  writeState('step-result.json', full);
  return full;
}

export function readStepResult(): StepResult | undefined {
  return readState<StepResult>('step-result.json');
}

/** Redacted a11y snapshot of the current page (Playwright ariaSnapshot), written to .state/. */
export async function writeAriaSnapshot(page: Page, name: string, redactValues: readonly string[]): Promise<string> {
  let snap: string;
  try {
    snap = await page.locator('body').ariaSnapshot();
  } catch (e) {
    snap = `# ariaSnapshot failed: ${(e as Error).message}`;
  }
  const header = `# url: ${redactString(stripQuery(page.url()), redactValues)}\n# ts: ${new Date().toISOString()}\n`;
  const p = statePath(`${name}.yaml`);
  fs.writeFileSync(p, header + redactString(snap, redactValues) + '\n', { encoding: 'utf8' });
  return p;
}

/** URLs are logged without query strings (docs/security.md 3.3). */
export function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}
