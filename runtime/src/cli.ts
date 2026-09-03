#!/usr/bin/env node
/**
 * asa — Agentic Shopping Autopilot runtime CLI (step-wise; the Claude Code session drives it).
 *
 *   asa mandate:check [--amount N] [--category C] [--domain D] [--draft]
 *   asa run:start --command "..." [--mode cdp|mcp]
 *   asa search --query Q [--source api|serp|state] [--auth client|device] [--limit N]
 *   asa select --id OFFER_ID --category C --rationale "..."
 *   asa checkout --step N [--rail oneclick_card|allegro_pay]
 *   asa ref:capture
 *   asa browser:check
 *   asa audit:append --event E [--data JSON] [--flow F] [--step S]
 *   asa audit:redact --month YYYY-MM
 *   asa report [--run-id ID]
 *   asa metrics
 *   asa selectors:set ID CSS   |   asa selectors:domain HOST
 *
 * Exit codes: 0 ok · 1 error · 2 STOP (decision to Andrii) · 3 the session must decide / fix / rerun.
 * Global: --private-dir PATH (or ASA_PRIVATE_DIR).
 */
import fs from 'node:fs';
import path from 'node:path';
import { AuditLog, newRunId } from './audit.js';
import { ApiConfigError, ApiNotVerifiedError, getToken, searchListing } from './api.js';
import { connectChannelB, detectBlock, detectLoggedIn } from './browser.js';
import { runStep, STEP_NAMES, type Rail, type SelectedOffer } from './checkout.js';
import { loadConfig, refValues, writeConfigValues } from './config.js';
import { checkMandate, formatCheck } from './mandate.js';
import { coerceOffer, type Offer } from './offers.js';
import { filterAndRank } from './rank.js';
import { computeMetrics, formatReport, summarizeRun } from './report.js';
import { addSelectorDomain, loadSelectors, setSelectorCss } from './selectors.js';
import { searchSerp } from './serp.js';
import { EXIT, readState, statePath, writeState, writeStepResult } from './state.js';
import { recordStop, StopError, type RunContext } from './stop.js';

type Args = { _: string[]; [k: string]: string | boolean | string[] };

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          out[a.slice(2)] = next;
          i++;
        } else out[a.slice(2)] = true;
      }
    } else out._.push(a);
  }
  return out;
}

function str(a: Args, k: string): string | undefined {
  const v = a[k];
  return typeof v === 'string' ? v : undefined;
}

function num(a: Args, k: string): number | undefined {
  const v = str(a, k);
  if (v === undefined) return undefined;
  const n = Number(v.replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`--${k} must be a number`);
  return n;
}

interface RunState {
  run_id: string;
  mandate_id: string;
  started: string;
  mode: 'cdp' | 'mcp';
  command?: string;
}

function currentRun(cfg: ReturnType<typeof loadConfig>): RunState {
  const r = readState<RunState>('run.json');
  if (r) return r;
  const res = checkMandate({ config: cfg, requireSigned: false });
  return { run_id: newRunId(), mandate_id: res.mandateId ?? 'unknown', started: new Date().toISOString(), mode: 'cdp' };
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const cfg = loadConfig({ argv });
  const redact = refValues(cfg);
  const audit = new AuditLog(cfg.privateDir, redact);
  const out = (s: string) => process.stdout.write(s + '\n');

  if (cfg.unknownKeys.length) process.stderr.write(`warning: unknown keys in config.env ignored: ${cfg.unknownKeys.join(', ')}\n`);

  switch (cmd) {
    case 'mandate:check': {
      const draft = args.draft === true;
      const run = readState<RunState>('run.json');
      const spent = run ? audit.spentPln(run.mandate_id) : undefined;
      const res = checkMandate({
        config: cfg,
        amountPln: num(args, 'amount'),
        category: str(args, 'category'),
        domain: str(args, 'domain'),
        spentPln: spent,
        requireSigned: !draft,
      });
      out(formatCheck(res));
      if (run) audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'mandate_checked', data: { ok: res.ok, amount_pln: num(args, 'amount'), spent_pln: spent, remaining_pln: res.remainingPln, failed: res.items.filter((i) => !i.ok).map((i) => i.id), draft } });
      return res.ok ? EXIT.OK : EXIT.STOP;
    }

    case 'run:start': {
      const command = str(args, 'command') ?? '';
      const mode = (str(args, 'mode') ?? 'cdp') as 'cdp' | 'mcp';
      const res = checkMandate({ config: cfg, requireSigned: false });
      const run: RunState = { run_id: newRunId(), mandate_id: res.mandateId ?? 'unknown', started: new Date().toISOString(), mode, command };
      writeState('run.json', run);
      for (const f of ['offers.json', 'selected.json', 'step-result.json']) {
        const p = path.join(path.dirname(statePath('run.json')), f);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'command_received', data: { command, mode } });
      out(`run ${run.run_id} started (mandate ${run.mandate_id}, mode ${mode})`);
      return EXIT.OK;
    }

    case 'search': {
      const query = str(args, 'query');
      const source = (str(args, 'source') ?? 'api') as 'api' | 'serp' | 'state';
      if (!query && source !== 'state') throw new Error('--query is required');
      const run = currentRun(cfg);
      const mres = checkMandate({ config: cfg, requireSigned: false });
      const per = num(args, 'limit') ?? mres.parsed?.limits.perPurchasePln;
      if (per === undefined) throw new Error('per-purchase limit unknown: fill section 2 of the mandate or pass --limit');
      const spent = audit.spentPln(run.mandate_id);
      const remaining = (mres.parsed?.limits.aggregatePln ?? Number.POSITIVE_INFINITY) - spent;
      let offers: Offer[] = [];
      let usedSource = source;
      if (source === 'api') {
        try {
          const token = await getToken(cfg, (str(args, 'auth') ?? 'client') as 'client' | 'device', {
            onUserCode: (url, code) => out(`Allegro OAuth: open ${url} and confirm code ${code}`),
          });
          const r = await searchListing(token, { phrase: query as string, priceTo: per, limit: Number(str(args, 'max') ?? 40) });
          offers = r.offers;
        } catch (e) {
          if (e instanceof ApiNotVerifiedError || e instanceof ApiConfigError) {
            process.stderr.write(`api unavailable (${e.message}); falling back to serp\n`);
            usedSource = 'serp';
          } else throw e;
        }
      }
      if (usedSource === 'serp') {
        const b = await connectChannelB(cfg.cdpUrl);
        try {
          offers = await searchSerp(b.page, { phrase: query as string, priceTo: per });
        } finally {
          await b.browser.close().catch(() => undefined);
        }
      }
      if (usedSource === 'state') {
        const raw = readState<{ offers?: Record<string, unknown>[] } | Record<string, unknown>[]>('offers.json');
        const list = Array.isArray(raw) ? raw : (raw?.offers ?? []);
        offers = list.map((o) => coerceOffer(o, 'session')).filter((o): o is Offer => o !== null);
      }
      const ranked = filterAndRank(offers, { perPurchaseLimitPln: per, remainingPln: remaining });
      writeState('offers.json', { query, source: usedSource, ts: new Date().toISOString(), per_purchase_limit_pln: per, remaining_pln: remaining, accepted: ranked.accepted, rejected: ranked.rejected });
      audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'search_done', flow: 'search', data: { query, source: usedSource, offers_total: offers.length, accepted: ranked.accepted.length, rejected: ranked.rejected.length } });
      out(`search "${query ?? '(state)'}" via ${usedSource}: ${offers.length} offers, ${ranked.accepted.length} within the mandate`);
      for (const o of ranked.accepted.slice(0, 10)) out(`  #${o.rank} ${o.total_pln.toFixed(2)} PLN  ${o.smart ? 'Smart ' : ''}${o.seller || '?'}  ${o.title.slice(0, 70)}  ${o.url}`);
      const reasons = new Map<string, number>();
      for (const r of ranked.rejected) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
      if (reasons.size) out(`  rejected: ${Array.from(reasons, ([k, v]) => `${k}=${v}`).join(', ')}`);
      return EXIT.OK;
    }

    case 'select': {
      const id = str(args, 'id');
      const category = str(args, 'category');
      const rationale = str(args, 'rationale') ?? '';
      if (!id || !category) throw new Error('--id and --category are required');
      const run = currentRun(cfg);
      const state = readState<{ accepted: (Offer & { total_pln: number })[] }>('offers.json');
      const offer = state?.accepted.find((o) => o.id === id);
      if (!offer) throw new Error(`offer ${id} is not in the accepted list of .state/offers.json (mechanical filter)`);
      const sel: SelectedOffer = { id: offer.id, url: offer.url, title: offer.title, total_pln: offer.total_pln, seller: offer.seller, category, rationale };
      writeState('selected.json', sel);
      audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'offer_selected', flow: 'search', data: { id: sel.id, url: sel.url, title: sel.title, total_pln: sel.total_pln, seller: sel.seller, category, rationale } });
      out(`selected ${sel.id} ${sel.total_pln.toFixed(2)} PLN ${sel.title}`);
      return EXIT.OK;
    }

    case 'checkout': {
      const step = num(args, 'step');
      if (!step || !STEP_NAMES[step]) throw new Error('--step 1..10 is required');
      const run = currentRun(cfg);
      const selected = readState<SelectedOffer>('selected.json');
      if (!selected) throw new Error('no .state/selected.json: run `asa select` first');
      const rail = (str(args, 'rail') ?? 'oneclick_card') as Rail;
      const ctx: RunContext = { run_id: run.run_id, mandate_id: run.mandate_id, flow: 'checkout', step };
      const selectors = loadSelectors();
      const b = await connectChannelB(cfg.cdpUrl);
      try {
        const r = await runStep({ page: b.page, cfg, audit, selectors, ctx, selected, rail, redactValues: redact }, step);
        out(`step ${step} ${STEP_NAMES[step]}: ${r.status}${r.note ? ' — ' + r.note : ''}`);
        return r.code;
      } catch (e) {
        if (e instanceof StopError) return recordStop(audit, ctx, e.reason, e.details, b.page.url());
        throw e;
      } finally {
        await b.browser.close().catch(() => undefined);
      }
    }

    case 'ref:capture': {
      // Channel B only: reads the recipient block of the open checkout page and writes REF_* into config.env.
      // Prints nothing but a confirmation; the values never reach stdout, the audit log or the session.
      const b = await connectChannelB(cfg.cdpUrl, { launchIfDown: false });
      try {
        const block = await detectBlock(b.page);
        if (block.blocked) return recordStop(audit, { ...currentRun(cfg), flow: 'ref-capture' }, 'captcha_or_antibot', { marker: block.marker }, b.page.url());
        const captured = await b.page.evaluate(() => {
          const text = ((document.body && (document.body as HTMLElement).innerText) || '').split('\n').map((l) => l.trim()).filter(Boolean);
          const i = text.findIndex((l) => /^(dane odbiorcy|odbiorca|adres dostawy|dostawa do|paczkomat)/i.test(l));
          if (i < 0) return null;
          const lines = text.slice(i + 1, i + 6);
          return { name: lines[0] ?? '', address: lines.slice(1, 4).join(', ') };
        });
        if (!captured || !captured.name) {
          out('recipient block not found on this page; open the checkout delivery step and rerun');
          return EXIT.DECISION;
        }
        const isPickup = /paczkomat|punkt odbioru|[A-Z]{3}\d{2,}[A-Z]?/i.test(captured.address);
        writeConfigValues(cfg.configPath, isPickup ? { REF_FULL_NAME: captured.name, REF_PICKUP_POINT: captured.address } : { REF_FULL_NAME: captured.name, REF_DELIVERY_ADDRESS: captured.address });
        out(`REF_FULL_NAME and ${isPickup ? 'REF_PICKUP_POINT' : 'REF_DELIVERY_ADDRESS'} written to config.env (values not shown)`);
        return EXIT.OK;
      } finally {
        await b.browser.close().catch(() => undefined);
      }
    }

    case 'browser:check': {
      const b = await connectChannelB(cfg.cdpUrl);
      try {
        const url = b.page.url();
        out(`channel B: connected to ${cfg.cdpUrl}${b.launched ? ' (Chrome launched by the runtime — log in to Allegro in that window first)' : ''}; current host ${url ? new URL(url).hostname || '(blank)' : '(blank)'}`);
        if (/allegro\.pl$/.test(new URL(url).hostname)) {
          const block = await detectBlock(b.page);
          out(`DataDome block page: ${block.blocked ? 'YES — STOP, channel B unusable' : 'no'}`);
          out(`logged in: ${(await detectLoggedIn(b.page)) ? 'yes' : 'no'}`);
          return block.blocked ? EXIT.STOP : EXIT.OK;
        }
        out('open https://allegro.pl in that window (log in) and rerun for the block / login check');
        return EXIT.OK;
      } finally {
        await b.browser.close().catch(() => undefined);
      }
    }

    case 'audit:append': {
      const event = str(args, 'event');
      if (!event) throw new Error('--event is required');
      const run = currentRun(cfg);
      const data = str(args, 'data') ? (JSON.parse(str(args, 'data') as string) as Record<string, unknown>) : undefined;
      const ev = audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event, flow: str(args, 'flow'), step: str(args, 'step'), data });
      out(JSON.stringify(ev));
      if (event === 'stop') writeStepResult({ flow: str(args, 'flow') ?? 'n/a', step: str(args, 'step') ?? 'n/a', status: 'stop', url: '', note: `STOP: ${String(data?.reason ?? '')}` });
      return EXIT.OK;
    }

    case 'audit:redact': {
      const month = str(args, 'month') ?? AuditLog.monthOf(new Date());
      out(`redacted export written: ${audit.exportRedacted(month)}`);
      return EXIT.OK;
    }

    case 'report': {
      const run = str(args, 'run-id') ?? currentRun(cfg).run_id;
      const s = summarizeRun(audit.readAll(), run);
      const text = formatReport(s);
      const p = statePath(`report-${run}.md`);
      fs.writeFileSync(p, text, { encoding: 'utf8' });
      out(text);
      out(`(written to ${p})`);
      return EXIT.OK;
    }

    case 'metrics': {
      const run = readState<RunState>('run.json');
      out(JSON.stringify(computeMetrics(audit.readAll(), str(args, 'mandate-id') ?? run?.mandate_id), null, 2));
      return EXIT.OK;
    }

    case 'selectors:set': {
      const [, id, css] = args._;
      if (!id || !css) throw new Error('usage: asa selectors:set ID CSS');
      const file = str(args, 'file');
      setSelectorCss(file ?? loadSelectors().path, id, css);
      out(`selectors.yaml: ${id}.css = ${css}`);
      return EXIT.OK;
    }

    case 'selectors:domain': {
      const [, host] = args._;
      if (!host) throw new Error('usage: asa selectors:domain HOST');
      addSelectorDomain(str(args, 'file') ?? loadSelectors().path, host);
      out(`selectors.yaml: domains += ${host}`);
      return EXIT.OK;
    }

    default:
      out('usage: asa <mandate:check|run:start|search|select|checkout|ref:capture|browser:check|audit:append|audit:redact|report|metrics|selectors:set|selectors:domain> [options]');
      return cmd ? EXIT.ERROR : EXIT.OK;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    process.exitCode = EXIT.ERROR;
  });
