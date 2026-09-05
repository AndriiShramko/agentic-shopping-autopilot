/**
 * STOP handling. A stop trigger (docs/security.md section 5 + the goal prompt) means:
 * record `stop{reason}` in the audit log, write step-result.json with status "stop",
 * print one line to stderr and exit with code 2. The runtime never retries around a stop.
 */
import type { AuditLog } from './audit.js';
import { EXIT, writeStepResult } from './state.js';

export const STOP_REASONS = [
  '3ds_timeout',
  'payment_declined',
  'captcha_or_antibot',
  'logged_out',
  'mandate_red',
  'mandate_deviation',
  'off_platform_payment',
  'secret_requested',
  'injection_suspected',
  'scam_suspected',
  'irreversible_outside_mandate',
  'first_run_of_new_flow',
  'domain_not_allowlisted',
  'harness_confirm',
  'human_confirm_flag',
  /** search / basket:plan without a fresh context brief for this need and run (src/context/brief.ts). */
  'context_missing',
] as const;
export type StopReason = (typeof STOP_REASONS)[number] | string;

export interface RunContext {
  run_id: string;
  mandate_id: string;
  flow?: string;
  step?: number | string;
}

export class StopError extends Error {
  constructor(
    readonly reason: StopReason,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`STOP: ${reason}`);
    this.name = 'StopError';
  }
}

export function recordStop(audit: AuditLog, ctx: RunContext, reason: StopReason, details: Record<string, unknown> = {}, url = ''): number {
  audit.append({
    run_id: ctx.run_id,
    mandate_id: ctx.mandate_id,
    event: 'stop',
    flow: ctx.flow,
    step: ctx.step,
    data: { reason, ...details },
  });
  writeStepResult({ flow: ctx.flow ?? 'n/a', step: ctx.step ?? 'n/a', status: 'stop', url, note: `STOP: ${reason}` });
  process.stderr.write(`STOP: ${reason}${Object.keys(details).length ? ' ' + JSON.stringify(details) : ''}\n`);
  return EXIT.STOP;
}
