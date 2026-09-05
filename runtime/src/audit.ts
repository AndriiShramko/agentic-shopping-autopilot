/**
 * Append-only JSONL audit log.
 *   raw (local only, gitignored): <private>/measurements/raw/audit-YYYY-MM.jsonl
 *   redacted export (committed):  <private>/measurements/audit-YYYY-MM.redacted.jsonl
 * One JSON object per line: { ts, run_id, mandate_id, event, flow, step, data }.
 * Every line passes the redaction filter before it is written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { redactDeep } from './redact.js';

export const AUDIT_EVENTS = [
  'command_received',
  'mandate_checked',
  'search_done',
  'offer_selected',
  'checkout_step',
  'pay_clicked',
  'challenge_3ds',
  'order_confirmed',
  'stop',
  'mandate_amended',
  'mandate_signed',
  'limit_override',
  // Smart! basket (2026-09-04)
  'basket_planned',
  'basket_approved',
  'complementary_proposed',
  // Context-first (2026-09-05): counts and hashes only, never snippet texts
  'context_brief',
  'context_note',
  'context_skipped',
  'context_gate_stop',
] as const;
export type AuditEventName = (typeof AUDIT_EVENTS)[number];

export interface AuditEvent {
  ts: string;
  run_id: string;
  mandate_id: string;
  event: AuditEventName | string;
  flow?: string;
  step?: number | string;
  data?: Record<string, unknown>;
}

export type AuditInput = Omit<AuditEvent, 'ts'> & { ts?: string };

export class AuditLog {
  readonly rawDir: string;
  readonly exportDir: string;

  constructor(
    readonly privateDir: string,
    readonly redactValues: readonly string[] = [],
  ) {
    this.exportDir = path.join(privateDir, 'measurements');
    this.rawDir = path.join(this.exportDir, 'raw');
  }

  static monthOf(ts: string | Date): string {
    const d = typeof ts === 'string' ? new Date(ts) : ts;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  rawPath(month: string): string {
    return path.join(this.rawDir, `audit-${month}.jsonl`);
  }

  exportPath(month: string): string {
    return path.join(this.exportDir, `audit-${month}.redacted.jsonl`);
  }

  append(input: AuditInput): AuditEvent {
    const ts = input.ts ?? new Date().toISOString();
    // canonical key order: ts, run_id, mandate_id, event, flow, step, data
    const ordered: AuditEvent = { ts, run_id: input.run_id, mandate_id: input.mandate_id, event: input.event };
    if (input.flow !== undefined) ordered.flow = input.flow;
    if (input.step !== undefined) ordered.step = input.step;
    if (input.data !== undefined) ordered.data = input.data;
    const ev: AuditEvent = redactDeep(ordered, this.redactValues);
    fs.mkdirSync(this.rawDir, { recursive: true });
    const file = this.rawPath(AuditLog.monthOf(ts));
    // append-only: never rewrite; if the previous write was torn (no trailing newline), start a new line
    const prefix = endsWithNewline(file) ? '' : '\n';
    fs.appendFileSync(file, prefix + JSON.stringify(ev) + '\n', { encoding: 'utf8', flag: 'a' });
    return ev;
  }

  readAll(): AuditEvent[] {
    if (!fs.existsSync(this.rawDir)) return [];
    const files = fs
      .readdirSync(this.rawDir)
      .filter((f) => /^audit-\d{4}-\d{2}\.jsonl$/.test(f))
      .sort();
    const events: AuditEvent[] = [];
    for (const f of files) events.push(...parseJsonl(fs.readFileSync(path.join(this.rawDir, f), 'utf8')));
    return events;
  }

  /** "Spent" in the mandate checklist = sum of order_confirmed.amount_pln for this mandate. */
  spentPln(mandateId: string): number {
    let sum = 0;
    for (const ev of this.readAll()) {
      if (ev.event !== 'order_confirmed' || ev.mandate_id !== mandateId) continue;
      const a = Number((ev.data as Record<string, unknown> | undefined)?.amount_pln);
      if (Number.isFinite(a)) sum += a;
    }
    return Math.round(sum * 100) / 100;
  }

  /** Write the redacted copy of one month (the file that goes into git). */
  exportRedacted(month: string): string {
    const src = this.rawPath(month);
    const dst = this.exportPath(month);
    const events = fs.existsSync(src) ? parseJsonl(fs.readFileSync(src, 'utf8')) : [];
    fs.mkdirSync(this.exportDir, { recursive: true });
    const lines = events.map((e) => JSON.stringify(redactDeep(e, this.redactValues)));
    fs.writeFileSync(dst, lines.length ? lines.join('\n') + '\n' : '', { encoding: 'utf8' });
    return dst;
  }
}

function endsWithNewline(file: string): boolean {
  if (!fs.existsSync(file)) return true;
  const size = fs.statSync(file).size;
  if (size === 0) return true;
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1);
    fs.readSync(fd, buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } finally {
    fs.closeSync(fd);
  }
}

export function parseJsonl(text: string): AuditEvent[] {
  const out: AuditEvent[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as AuditEvent);
    } catch {
      /* a torn line at the end of an append-only file is ignored, never rewritten */
    }
  }
  return out;
}

export function newRunId(now: Date = new Date()): string {
  const s = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `run-${s}-${Math.random().toString(36).slice(2, 6)}`;
}
