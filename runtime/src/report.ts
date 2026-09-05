/**
 * Post-purchase report and the MVP metrics, computed from the audit log only.
 *   metric (b): order_confirmed.ts - command_received.ts - (3DS done - 3DS start)
 *   metric "share without the user": runs whose order_confirmed happened with no challenge_3ds and no stop
 */
import type { AuditEvent } from './audit.js';

export interface RunSummary {
  run_id: string;
  mandate_id: string;
  command?: string;
  title?: string;
  seller?: string;
  offer_url?: string;
  order_id?: string;
  amount_pln?: number;
  rationale?: string;
  remaining_pln?: number;
  challenged: boolean;
  challenge_ms: number;
  stops: string[];
  /** ms from command_received to order_confirmed, 3DS window excluded */
  duration_ms?: number;
  confirmed: boolean;
  mode?: string;
}

export function summarizeRun(events: readonly AuditEvent[], runId: string): RunSummary {
  const ev = events.filter((e) => e.run_id === runId).sort((a, b) => a.ts.localeCompare(b.ts));
  const s: RunSummary = { run_id: runId, mandate_id: ev[0]?.mandate_id ?? '', challenged: false, challenge_ms: 0, stops: [], confirmed: false };
  let start: number | undefined;
  let end: number | undefined;
  let chStart: number | undefined;
  for (const e of ev) {
    const d = (e.data ?? {}) as Record<string, unknown>;
    switch (e.event) {
      case 'command_received':
        start = Date.parse(e.ts);
        s.command = typeof d.command === 'string' ? d.command : undefined;
        s.mode = typeof d.mode === 'string' ? d.mode : s.mode;
        break;
      case 'offer_selected':
        s.title = typeof d.title === 'string' ? d.title : s.title;
        s.seller = typeof d.seller === 'string' ? d.seller : s.seller;
        s.offer_url = typeof d.url === 'string' ? d.url : s.offer_url;
        s.rationale = typeof d.rationale === 'string' ? d.rationale : s.rationale;
        break;
      case 'mandate_checked':
        if (typeof d.remaining_pln === 'number') s.remaining_pln = d.remaining_pln;
        break;
      case 'challenge_3ds':
        s.challenged = true;
        if (d.phase === 'start') chStart = Date.parse(e.ts);
        if (d.phase === 'done' && chStart !== undefined) {
          s.challenge_ms += Date.parse(e.ts) - chStart;
          chStart = undefined;
        }
        break;
      case 'order_confirmed':
        end = Date.parse(e.ts);
        s.confirmed = true;
        s.order_id = typeof d.order_id === 'string' ? d.order_id : s.order_id;
        s.amount_pln = typeof d.amount_pln === 'number' ? d.amount_pln : s.amount_pln;
        s.seller = typeof d.seller === 'string' ? d.seller : s.seller;
        s.offer_url = typeof d.offer_url === 'string' ? d.offer_url : s.offer_url;
        s.title = typeof d.title === 'string' ? d.title : s.title;
        break;
      case 'stop':
        s.stops.push(String(d.reason ?? 'unknown'));
        break;
    }
  }
  if (start !== undefined && end !== undefined) s.duration_ms = Math.max(0, end - start - s.challenge_ms);
  if (s.remaining_pln !== undefined && s.amount_pln !== undefined && s.confirmed) s.remaining_pln = Math.round((s.remaining_pln - s.amount_pln) * 100) / 100;
  return s;
}

export function formatReport(s: RunSummary): string {
  const lines: string[] = [];
  lines.push(`# Purchase report — ${s.run_id}`);
  lines.push('');
  lines.push(`- Mandate: ${s.mandate_id}`);
  if (s.command) lines.push(`- Command: ${s.command}`);
  lines.push(`- Item: ${s.title ?? '(unknown)'}`);
  lines.push(`- Seller: ${s.seller ?? '(unknown)'}`);
  lines.push(`- Amount: ${s.amount_pln !== undefined ? s.amount_pln.toFixed(2) + ' PLN' : '(none)'}`);
  lines.push(`- Rationale: ${s.rationale ?? '(none recorded)'}`);
  lines.push(`- Remaining aggregate limit: ${s.remaining_pln !== undefined ? s.remaining_pln.toFixed(2) + ' PLN' : '(unknown)'}`);
  lines.push(`- Order: ${s.order_id ?? '(not confirmed)'}${s.offer_url ? ` — offer ${s.offer_url}` : ''}`);
  lines.push(`- 3DS / bank challenge: ${s.challenged ? `yes (${Math.round(s.challenge_ms / 1000)} s)` : 'no'}`);
  lines.push(`- Stops: ${s.stops.length ? s.stops.join(', ') : 'none'}`);
  if (s.duration_ms !== undefined) lines.push(`- Time command → order (3DS excluded): ${(s.duration_ms / 1000).toFixed(0)} s${s.mode ? ` [${s.mode}]` : ''}`);
  lines.push(`- Status: ${s.confirmed ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
  return lines.join('\n') + '\n';
}

export interface Metrics {
  runs: number;
  confirmed: number;
  without_human: number;
  with_3ds: number;
  with_stop: number;
  share_without_human: number | null;
  share_3ds: number | null;
  median_duration_s: number | null;
}

export function computeMetrics(events: readonly AuditEvent[], mandateId?: string): Metrics {
  const runIds = Array.from(new Set(events.filter((e) => !mandateId || e.mandate_id === mandateId).map((e) => e.run_id)));
  const sums = runIds.map((r) => summarizeRun(events, r)).filter((s) => s.command !== undefined || s.confirmed);
  const confirmed = sums.filter((s) => s.confirmed);
  const withoutHuman = confirmed.filter((s) => !s.challenged && s.stops.length === 0);
  const with3ds = sums.filter((s) => s.challenged);
  const withStop = sums.filter((s) => s.stops.length > 0);
  const durations = confirmed.map((s) => s.duration_ms).filter((d): d is number => typeof d === 'number').sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor((durations.length - 1) / 2)] / 1000 : null;
  return {
    runs: sums.length,
    confirmed: confirmed.length,
    without_human: withoutHuman.length,
    with_3ds: with3ds.length,
    with_stop: withStop.length,
    share_without_human: sums.length ? Math.round((withoutHuman.length / sums.length) * 1000) / 10 : null,
    share_3ds: sums.length ? Math.round((with3ds.length / sums.length) * 1000) / 10 : null,
    median_duration_s: median === null ? null : Math.round(median),
  };
}
