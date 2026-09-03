import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuditLog, newRunId, parseJsonl } from '../src/audit.js';
import { tmpDir } from './helpers.js';

const REF = ['Jan Testowy', 'ul. Przykładowa 12/3, 00-001 Warszawa', 'WAW123A'];

describe('AuditLog', () => {
  it('appends one redacted JSON line per event into measurements/raw/audit-YYYY-MM.jsonl', () => {
    const dir = tmpDir();
    const log = new AuditLog(dir, REF);
    const ev = log.append({ ts: '2026-09-04T10:00:00.000Z', run_id: 'run-1', mandate_id: 'PM-1', event: 'command_received', data: { command: 'buy wkręty do 30 zł' } });
    log.append({ ts: '2026-09-04T10:01:00.000Z', run_id: 'run-1', mandate_id: 'PM-1', event: 'checkout_step', flow: 'checkout', step: 5, data: { note: 'recipient Jan Testowy at ul. Przykładowa 12/3, 00-001 Warszawa', address: 'must be dropped', order_id: 'ORD-1' } });
    const file = path.join(dir, 'measurements', 'raw', 'audit-2026-09.jsonl');
    expect(fs.existsSync(file)).toBe(true);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(ev);
    const second = JSON.parse(lines[1]);
    expect(second.data.note).toBe('recipient [REDACTED] at [REDACTED]');
    expect(second.data.address).toBeUndefined();
    expect(second.data.order_id).toBe('ORD-1');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('Testowy');
  });

  it('never rewrites earlier lines (append-only) and tolerates a torn last line', () => {
    const dir = tmpDir();
    const log = new AuditLog(dir, REF);
    log.append({ ts: '2026-09-04T10:00:00.000Z', run_id: 'r', mandate_id: 'm', event: 'command_received' });
    const file = log.rawPath('2026-09');
    fs.appendFileSync(file, '{"torn": tru');
    log.append({ ts: '2026-09-04T10:02:00.000Z', run_id: 'r', mandate_id: 'm', event: 'stop', data: { reason: 'x' } });
    const text = fs.readFileSync(file, 'utf8');
    expect(text.startsWith('{"ts":"2026-09-04T10:00:00.000Z","run_id":"r","mandate_id":"m","event":"command_received"}')).toBe(true);
    expect(text).toContain('{"torn": tru');
    const parsed = parseJsonl(text);
    expect(parsed.map((e) => e.event)).toEqual(['command_received', 'stop']);
  });

  it('sums spent = order_confirmed.amount_pln per mandate across months', () => {
    const dir = tmpDir();
    const log = new AuditLog(dir, []);
    log.append({ ts: '2026-08-30T10:00:00.000Z', run_id: 'a', mandate_id: 'PM-1', event: 'order_confirmed', data: { order_id: '1', amount_pln: 24.99 } });
    log.append({ ts: '2026-09-02T10:00:00.000Z', run_id: 'b', mandate_id: 'PM-1', event: 'order_confirmed', data: { order_id: '2', amount_pln: 10.01 } });
    log.append({ ts: '2026-09-03T10:00:00.000Z', run_id: 'c', mandate_id: 'PM-2', event: 'order_confirmed', data: { order_id: '3', amount_pln: 99 } });
    log.append({ ts: '2026-09-03T11:00:00.000Z', run_id: 'd', mandate_id: 'PM-1', event: 'pay_clicked', data: { amount_pln: 500 } });
    expect(log.spentPln('PM-1')).toBe(35);
    expect(log.spentPln('PM-2')).toBe(99);
    expect(log.spentPln('PM-none')).toBe(0);
    expect(log.readAll().map((e) => e.run_id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('exports a redacted month file next to raw/ (the copy that goes into git)', () => {
    const dir = tmpDir();
    const log = new AuditLog(dir, REF);
    log.append({ ts: '2026-09-04T10:00:00.000Z', run_id: 'r', mandate_id: 'm', event: 'order_confirmed', data: { order_id: 'ORD', amount_pln: 5, pickup_point: 'WAW123A', seller: 'sklep_x', offer_url: 'https://allegro.pl/oferta/1' } });
    const out = log.exportRedacted('2026-09');
    expect(out).toBe(path.join(dir, 'measurements', 'audit-2026-09.redacted.jsonl'));
    const rec = JSON.parse(fs.readFileSync(out, 'utf8').trim());
    expect(rec.data).toEqual({ order_id: 'ORD', amount_pln: 5, seller: 'sklep_x', offer_url: 'https://allegro.pl/oferta/1' });
    expect(fs.readFileSync(out, 'utf8')).not.toContain('WAW123A');
  });

  it('newRunId is unique and sortable', () => {
    const a = newRunId(new Date('2026-09-04T10:00:00Z'));
    const b = newRunId(new Date('2026-09-04T10:00:01Z'));
    expect(a).toMatch(/^run-20260904T100000Z-[a-z0-9]{4}$/);
    expect(a < b).toBe(true);
  });
});
