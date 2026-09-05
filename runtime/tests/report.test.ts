import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../src/audit.js';
import { computeMetrics, formatReport, summarizeRun } from '../src/report.js';

const ev = (ts: string, run_id: string, event: string, data: Record<string, unknown> = {}): AuditEvent => ({ ts, run_id, mandate_id: 'PM-1', event, data });

const EVENTS: AuditEvent[] = [
  ev('2026-09-10T10:00:00.000Z', 'r1', 'command_received', { command: 'kup wkręty do 30 zł', mode: 'cdp' }),
  ev('2026-09-10T10:00:20.000Z', 'r1', 'offer_selected', { title: 'Wkręty 4x40', seller: 'sklep_x', url: 'https://allegro.pl/oferta/1', rationale: 'cheapest new, Smart' }),
  ev('2026-09-10T10:00:50.000Z', 'r1', 'mandate_checked', { ok: true, remaining_pln: 300 }),
  ev('2026-09-10T10:01:00.000Z', 'r1', 'pay_clicked', { amount_pln: 24.99 }),
  ev('2026-09-10T10:01:05.000Z', 'r1', 'challenge_3ds', { phase: 'start' }),
  ev('2026-09-10T10:02:05.000Z', 'r1', 'challenge_3ds', { phase: 'done' }),
  ev('2026-09-10T10:02:20.000Z', 'r1', 'order_confirmed', { order_id: 'ORD-1', amount_pln: 24.99, seller: 'sklep_x', offer_url: 'https://allegro.pl/oferta/1', title: 'Wkręty 4x40' }),
  ev('2026-09-11T10:00:00.000Z', 'r2', 'command_received', { command: 'kup filament', mode: 'cdp' }),
  ev('2026-09-11T10:01:30.000Z', 'r2', 'order_confirmed', { order_id: 'ORD-2', amount_pln: 10 }),
  ev('2026-09-12T10:00:00.000Z', 'r3', 'command_received', { command: 'kup x' }),
  ev('2026-09-12T10:00:30.000Z', 'r3', 'stop', { reason: 'captcha_or_antibot' }),
  // context-first events of r1 (counts only; no texts)
  ev('2026-09-10T10:00:05.000Z', 'r1', 'context_brief', { need: 'wkręty', hits: 3, dropped_pii: 2 }),
  ev('2026-09-10T10:00:06.000Z', 'r1', 'context_note', { need: 'wkręty', kind: 'fact', from_ids: ['#1'], file: 'a.md', line: 3 }),
  ev('2026-09-10T10:00:07.000Z', 'r1', 'context_note', { need: 'wkręty', kind: 'assumption', from_ids: [] }),
  ev('2026-09-10T10:00:08.000Z', 'r1', 'context_note', { need: 'wkręty', kind: 'question', from_ids: [], critical: true }),
  ev('2026-09-10T10:00:09.000Z', 'r1', 'context_query', { need: 'wkręty', query: 'wkręty 4x40', from_ids: ['#1'] }),
  ev('2026-09-11T10:00:10.000Z', 'r2', 'context_skipped', { reason_code: 'repeat_purchase', gate: 'no_brief' }),
];

const CONTEXT_R1 = { briefs: 1, facts: 1, assumptions: 1, questions: 1, critical_questions: 1, queries: 1, skips: 0, gate_stops: 0, pii_dropped: 2, store_changed: 0 };

describe('report', () => {
  it('summarises a run and computes metric (b) with the 3DS window excluded', () => {
    const s = summarizeRun(EVENTS, 'r1');
    expect(s).toMatchObject({ run_id: 'r1', order_id: 'ORD-1', amount_pln: 24.99, seller: 'sklep_x', title: 'Wkręty 4x40', challenged: true, challenge_ms: 60_000, confirmed: true, stops: [], mode: 'cdp', context: CONTEXT_R1 });
    // 140 s total minus 60 s of 3DS = 80 s
    expect(s.duration_ms).toBe(80_000);
    expect(s.remaining_pln).toBe(275.01);
    const text = formatReport(s);
    expect(text).toContain('Order: ORD-1');
    expect(text).toContain('3DS / bank challenge: yes (60 s)');
    expect(text).toContain('Time command → order (3DS excluded): 80 s [cdp]');
    expect(text).toContain('Context: 1 brief(s), 1 fact(s), 1 assumption(s), 1 critical question(s), 0 gate skip(s), 2 snippet(s) dropped (PII)');
    expect(text).toContain('Status: CONFIRMED');
    expect(text).not.toContain('## Context');
  });

  it('lists the facts (file:line), assumptions and questions of the run brief in a Context section', () => {
    const s = summarizeRun(EVENTS, 'r1');
    const brief = {
      run_id: 'r1',
      needs: {
        wkręty: { need: 'wkręty', terms: [], ts: '', hits: 3, dropped: 2, by_store: [], snippets: [], facts: [{ text: 'stainless A2', from_ids: ['#1'], file: 'a.md', line: 3, ts: '' }], assumptions: [{ text: 'pack of 100', reason: 'last order', ts: '' }], open_questions: [{ text: 'length 40 or 50', critical: true, ts: '' }], queries: [{ query: 'wkręty 4x40', from_ids: ['#1'], ts: '' }] },
      },
      stores: [],
      store_fingerprint: '',
      brief_hash: '',
      dropped_pii: 2,
      built: '',
    };
    const text = formatReport(s, brief);
    expect(text).toContain('## Context');
    expect(text).toContain('### wkręty');
    expect(text).toContain('- fact: stainless A2 (a.md:3)');
    expect(text).toContain('- assumption: pack of 100 (last order)');
    expect(text).toContain('- open question: length 40 or 50 [critical]');
    expect(text).toContain('- query: wkręty 4x40');
    // a brief of another run is not listed
    expect(formatReport(s, { ...brief, run_id: 'r9' })).not.toContain('## Context');
  });

  it('computes share without human, 3DS share, the median duration and the context counts', () => {
    const m = computeMetrics(EVENTS, 'PM-1');
    expect(m).toEqual({ runs: 3, confirmed: 2, without_human: 1, with_3ds: 1, with_stop: 1, share_without_human: 33.3, share_3ds: 33.3, median_duration_s: 80, context: { ...CONTEXT_R1, skips: 1 } });
  });
});
