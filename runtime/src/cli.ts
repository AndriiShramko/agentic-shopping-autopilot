#!/usr/bin/env node
/**
 * asa — Agentic Shopping Autopilot runtime CLI (step-wise; the Claude Code session drives it).
 *
 *   asa mandate:check [--amount N] [--category C] [--domain D] [--draft]
 *   asa run:start --command "..." [--mode cdp|mcp]
 *   asa context:brief --need "<what is being bought>" [--terms a,b,c] [--max N]     # context-first: BEFORE search
 *   asa context:note --fact "..." [--source "[[note]]"] | --assumption "..." [--reason "..."] | --question "..."
 *   asa search --query Q [--source api|serp|state] [--auth client|device] [--limit N] [--need LABEL] [--append] [--category C] [--no-context "<reason>"]
 *   asa select --id OFFER_ID --category C --rationale "..."
 *   asa basket:plan [--slack N] [--max-complements N] [--primary "label1;label2"] [--assumptions "a; b"] [--no-context "<reason>"]
 *   asa basket:approve --reply "<the user's one reply>" --by "<name> (chat)"
 *   asa profile:check
 *   asa checkout --step N [--rail oneclick_card|allegro_pay]
 *   asa ref:capture
 *   asa browser:check
 *   asa audit:append --event E [--data JSON] [--flow F] [--step S]
 *   asa audit:redact --month YYYY-MM
 *   asa report [--run-id ID]
 *   asa metrics
 *   asa selectors:set ID CSS   |   asa selectors:domain HOST
 *
 * Exit codes: 0 ok · 1 error · 2 STOP (the decision goes to the user) · 3 the session must decide / fix / rerun.
 * Global: --private-dir PATH (or ASA_PRIVATE_DIR); ASA_STATE_DIR moves .state/; ASA_LANG=ru for Russian output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { amendMandateLimits, signMandate, type OverrideRecord } from './amend.js';
import { AuditLog, newRunId } from './audit.js';
import { ApiConfigError, ApiNotVerifiedError, getToken, searchListing } from './api.js';
import { applyReply, formatPlan, parseReply, planBaskets, proposeComplements, round2, type BasketOffer, type BasketPlan, type ComplementProposal, type Need } from './basket.js';
import { connectChannelB, detectBlock, detectLoggedIn } from './browser.js';
import { runStep, STEP_NAMES, type Rail, type SelectedOffer } from './checkout.js';
import { loadConfig, refValues, writeConfigValues, type RuntimeConfig } from './config.js';
import { addNote, BRIEF_FILE, buildBrief, checkContextGate, formatBriefDigest, writeBrief, type ContextBrief, type NoteKind, type RunContextRef } from './context/brief.js';
import { parseStoreSpecs, storeRootExists } from './context/store.js';
import { money, setLang, t } from './i18n.js';
import { checkMandate, formatCheck, type MandateLimits } from './mandate.js';
import { coerceOffer, type Offer } from './offers.js';
import { boughtBefore, checkProfileFiles, formatProfileCheck, isBlocked, isConsumableCategory, loadProfile, purchasesFromSeller, recentlyBought, wishlistMatch } from './profile.js';
import { filterAndRank, type Rejected, type RankedOffer } from './rank.js';
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
  /** Written by `context:brief`: the gate compares it with .state/context-brief.json. */
  context?: RunContextRef;
}

function currentRun(cfg: ReturnType<typeof loadConfig>): RunState {
  const r = readState<RunState>('run.json');
  if (r) return r;
  const res = checkMandate({ config: cfg, requireSigned: false });
  return { run_id: newRunId(), mandate_id: res.mandateId ?? 'unknown', started: new Date().toISOString(), mode: 'cdp' };
}

/** .state/offers.json — one search, or several needs appended with `search --need L --append`. */
interface OffersState {
  query?: string;
  source?: string;
  ts: string;
  per_purchase_limit_pln?: number;
  per_item_limit_pln?: number;
  remaining_pln?: number | null;
  accepted: RankedOffer[];
  rejected: Rejected[];
  needs?: { need: string; query?: string; category?: string; source?: string; ts: string; accepted: number; rejected: number }[];
}

/** .state/basket-plan.json — what `basket:plan` proposed and `basket:approve` resolves. */
interface BasketPlanState {
  run_id: string;
  ts: string;
  needs: Need[];
  primary: string[];
  plan: BasketPlan;
  proposal: ComplementProposal;
  threshold_pln: number;
  slack_pln: number;
  max_complements: number;
  remaining_pln?: number;
  text: string;
  /** Hash of the context brief the proposal was built from; absent when the gate was bypassed. */
  context_brief_hash?: string;
  context_skipped?: string;
}

function removeState(...names: string[]): void {
  for (const f of names) {
    const p = path.join(path.dirname(statePath('run.json')), f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

/**
 * One-time over-limit approval for the current run (owner decision 2026-09-04): amounts up to the
 * ceiling signed in the mandate, item and order limits only, never the aggregate one. Shared by
 * `asa override` and `basket:approve` ("ok <amount>").
 */
function recordOverride(cfg: RuntimeConfig, audit: AuditLog, run: RunState, amount: number, by: string, offerId?: string, note?: string): { ok: boolean; message: string } {
  const limits = checkMandate({ config: cfg, requireSigned: false }).parsed?.limits;
  const cap = limits?.overrideMaxPln;
  if (cap === undefined) {
    return { ok: false, message: 'STOP: the mandate has no one-time approval ceiling line in section 2 ("One-time approvals over the limit: allowed up to ≤ N PLN"); add it with mandate:amend --override-max N and re-sign' };
  }
  if (amount > cap + 0.001) {
    return { ok: false, message: `STOP: ${amount.toFixed(2)} PLN exceeds the one-time approval ceiling ${cap} PLN; raise it with mandate:amend --override-max and re-sign` };
  }
  const rec: OverrideRecord = { run_id: run.run_id, amount_pln: amount, approved_by: by, ts: new Date().toISOString(), note, offer_id: offerId };
  writeState('override.json', rec);
  audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'limit_override', data: { amount_pln: amount, approved_by: by, offer_id: rec.offer_id, note: rec.note } });
  return { ok: true, message: `one-time approval recorded for run ${run.run_id}: up to ${amount.toFixed(2)} PLN (by ${by}); item and order limits only, the aggregate limit still applies` };
}

function mandateLimits(cfg: RuntimeConfig, audit: AuditLog, run: RunState): { limits: Partial<MandateLimits>; spent: number; remaining?: number } {
  const limits = checkMandate({ config: cfg, requireSigned: false }).parsed?.limits ?? {};
  const spent = audit.spentPln(run.mandate_id);
  const remaining = limits.aggregatePln !== undefined ? round2(limits.aggregatePln - spent) : undefined;
  return { limits, spent, remaining };
}

interface GateOutcome {
  /** Exit code when the run must stop (stop reason context_missing). */
  stop?: number;
  /** The reason given with --no-context when the gate was bypassed (audited as context_skipped). */
  skipped?: string;
  brief?: ContextBrief;
}

/**
 * Hard context gate (context-first, 2026-09-05): `search` and `basket:plan` run only when a fresh brief
 * for this need exists in this run (`asa context:brief`). `--no-context "<reason>"` bypasses the gate
 * with a written reason; the bypass is audited and the proposal says so.
 */
function contextGate(cfg: RuntimeConfig, audit: AuditLog, run: RunState, need: string, args: Args, flow: string): GateOutcome {
  const g = checkContextGate(run, need, { maxAgeMin: cfg.contextBriefMaxAgeMin, storesConfigured: cfg.contextStores.length > 0 });
  if (g.ok) return { brief: g.brief };
  const skip = args['no-context'];
  if (skip !== undefined) {
    const reason = typeof skip === 'string' ? skip.trim() : '';
    if (!reason) throw new Error('--no-context needs a written reason: --no-context "<why the knowledge stores were not consulted>"');
    audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'context_skipped', flow, data: { reason, gate: g.reason, need } });
    process.stderr.write(`warning: context gate bypassed (${g.reason}): ${reason}\n`);
    return { skipped: reason, brief: g.brief };
  }
  const hint =
    g.reason === 'no_stores'
      ? 'set CONTEXT_STORES=obsidian:<vault path>[;jsonl:<shopping-profile path>] in config.env, then run: asa context:brief --need "…" --terms …'
      : `run: asa context:brief --need "${need || '<what is being bought>'}" --terms <synonyms in the languages of the notes, sizes, models>`;
  audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'context_gate_stop', flow, data: { reason: g.reason, need } });
  const code = recordStop(audit, { run_id: run.run_id, mandate_id: run.mandate_id, flow }, 'context_missing', { gate: g.reason, hint });
  process.stderr.write(hint + '\n');
  return { stop: code };
}

function splitList(v: string | undefined): string[] {
  return (v ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const cfg = loadConfig({ argv });
  setLang(cfg.lang);
  const redact = refValues(cfg);
  const audit = new AuditLog(cfg.privateDir, redact);
  const out = (s: string) => process.stdout.write(s + '\n');

  if (cfg.unknownKeys.length) process.stderr.write(`warning: unknown keys in config.env ignored: ${cfg.unknownKeys.join(', ')}\n`);

  switch (cmd) {
    case 'mandate:check': {
      const draft = args.draft === true;
      const run = readState<RunState>('run.json');
      const spent = run ? audit.spentPln(run.mandate_id) : undefined;
      const override = readState<OverrideRecord>('override.json');
      const overridePln = override && run && override.run_id === run.run_id ? override.amount_pln : undefined;
      const res = checkMandate({
        config: cfg,
        amountPln: num(args, 'amount'),
        itemPln: num(args, 'item'),
        overridePln,
        category: str(args, 'category'),
        domain: str(args, 'domain'),
        spentPln: spent,
        requireSigned: !draft,
      });
      out(formatCheck(res));
      if (run) audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'mandate_checked', data: { ok: res.ok, amount_pln: num(args, 'amount'), item_pln: num(args, 'item'), spent_pln: spent, remaining_pln: res.remainingPln, override_pln: overridePln, failed: res.items.filter((i) => !i.ok).map((i) => i.id), draft } });
      return res.ok ? EXIT.OK : EXIT.STOP;
    }

    case 'mandate:amend': {
      // Quick limit change (owner decision 2026-09-04). The hash changes -> status: draft until `mandate:sign`.
      const cats = str(args, 'categories');
      const r = amendMandateLimits(cfg.mandatePath, {
        perItemPln: num(args, 'per-item'),
        perPurchasePln: num(args, 'per-order'),
        maxItems: num(args, 'max-items'),
        aggregatePln: num(args, 'total'),
        overrideMaxPln: num(args, 'override-max'),
        validFrom: str(args, 'from'),
        validTo: str(args, 'to'),
        categories: cats ? cats.split(';').map((c) => c.trim()).filter(Boolean) : undefined,
      });
      for (const c of r.changed) out(`  ${c}`);
      out(`mandate amended (${r.changed.length} line(s)); status is now draft`);
      out(`new hash: ${r.hash.hash} (lines ${r.hash.fromLine}-${r.hash.toLine}) — confirm it in chat, then run: asa mandate:sign --by "<name> (chat)" --hash ${r.hash.hash}`);
      const run = readState<RunState>('run.json');
      if (run) audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'mandate_amended', data: { changed: r.changed, hash: r.hash.hash } });
      return EXIT.OK;
    }

    case 'mandate:sign': {
      const by = str(args, 'by');
      if (!by) throw new Error('--by "<principal name> (chat)" is required; the confirmation in chat is the signing act');
      const when = str(args, 'when') ?? `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
      const h = signMandate(cfg.mandatePath, { signer: by, when, expectedHash: str(args, 'hash'), configPath: cfg.configPath });
      out(`mandate signed by ${by} at ${when}; SHA-256 ${h.hash} written to section 7 and MANDATE_SHA256`);
      const res = checkMandate({ config: loadConfig({ argv }) });
      out(formatCheck(res));
      const run = readState<RunState>('run.json');
      if (run) audit.append({ run_id: run.run_id, mandate_id: res.mandateId ?? run.mandate_id, event: 'mandate_signed', data: { by, when, hash: h.hash, green: res.ok } });
      return res.ok ? EXIT.OK : EXIT.STOP;
    }

    case 'override': {
      // One-time over-limit approval for the CURRENT run only (owner decision 2026-09-04).
      const amount = num(args, 'amount');
      const by = str(args, 'by');
      if (!amount || !by) throw new Error('usage: asa override --amount N --by "<principal name> (chat)" [--offer-id ID] [--note "..."]');
      const run = currentRun(cfg);
      const r = recordOverride(cfg, audit, run, amount, by, str(args, 'offer-id'), str(args, 'note'));
      if (!r.ok) {
        process.stderr.write(r.message + '\n');
        return EXIT.STOP;
      }
      out(r.message);
      return EXIT.OK;
    }

    case 'run:start': {
      const command = str(args, 'command') ?? '';
      const mode = (str(args, 'mode') ?? 'cdp') as 'cdp' | 'mcp';
      const res = checkMandate({ config: cfg, requireSigned: false });
      const run: RunState = { run_id: newRunId(), mandate_id: res.mandateId ?? 'unknown', started: new Date().toISOString(), mode, command };
      writeState('run.json', run);
      // a new run needs a new brief: the previous one is deleted so that the gate cannot be satisfied by it
      removeState('offers.json', 'selected.json', 'step-result.json', 'override.json', 'basket-plan.json', 'basket.json', BRIEF_FILE);
      audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'command_received', data: { command, mode } });
      out(`run ${run.run_id} started (mandate ${run.mandate_id}, mode ${mode})`);
      return EXIT.OK;
    }

    case 'search': {
      const query = str(args, 'query');
      const source = (str(args, 'source') ?? 'api') as 'api' | 'serp' | 'state';
      if (!query && source !== 'state') throw new Error('--query is required');
      const run = currentRun(cfg);
      // context-first: no search without a fresh brief for this need in this run (exit 2, stop context_missing)
      const gate = contextGate(cfg, audit, run, str(args, 'need') ?? query ?? '', args, 'search');
      if (gate.stop !== undefined) return gate.stop;
      const mres = checkMandate({ config: cfg, requireSigned: false });
      const perOrder = num(args, 'limit') ?? mres.parsed?.limits.perPurchasePln;
      if (perOrder === undefined) throw new Error('per-purchase limit unknown: fill section 2 of the mandate or pass --limit');
      // basket mode: a line is capped by the per-item limit (the order limit is checked on the whole basket)
      const perItem = num(args, 'limit') ?? mres.parsed?.limits.perItemPln;
      const per = perItem ?? perOrder;
      const spent = audit.spentPln(run.mandate_id);
      const remaining = (mres.parsed?.limits.aggregatePln ?? Number.POSITIVE_INFINITY) - spent;
      const need = str(args, 'need');
      const append = args.append === true;
      const profile = loadProfile(cfg.shoppingProfileDir);
      const wish = need ? profile.wishlist.find((l) => l.label === need) : undefined;
      const category = str(args, 'category') ?? wish?.category;
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
        // MCP mode: the session writes raw offers to --file (default .state/offers.session.json; legacy: offers.json),
        // so that `--append` can merge several needs into offers.json without clobbering its own input.
        const file = str(args, 'file') ?? (fs.existsSync(statePath('offers.session.json')) ? statePath('offers.session.json') : statePath('offers.json'));
        const raw = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as { offers?: Record<string, unknown>[] } | Record<string, unknown>[]) : undefined;
        const list = Array.isArray(raw) ? raw : (raw?.offers ?? []);
        offers = list.map((o) => coerceOffer(o, 'session')).filter((o): o is Offer => o !== null);
      }
      if (need || category) offers = offers.map((o) => ({ ...o, need: need ?? o.need, category: category ?? o.category }));
      // An offer above the item / order limit but within the signed one-time-approval ceiling stays in the list:
      // the proposal shows it with "⚠️ … ответь «ок <сумма>»" and never buys it without that reply. No ceiling line
      // in the mandate (or an explicit --limit) = the limits are hard.
      const ceiling = num(args, 'limit') === undefined ? mres.parsed?.limits.overrideMaxPln : undefined;
      const itemCap = perItem === undefined ? undefined : ceiling !== undefined ? Math.max(perItem, ceiling) : perItem;
      const orderCap = ceiling !== undefined ? Math.max(perOrder, ceiling) : perOrder;
      const ranked = filterAndRank(offers, { perPurchaseLimitPln: orderCap, remainingPln: remaining, perItemLimitPln: itemCap, avoidSellers: profile.sellers.avoid });
      const ts = new Date().toISOString();
      const previous = append ? readState<OffersState>('offers.json') : undefined;
      const needKey = need ?? query ?? '';
      // a repeated search for the same need replaces its earlier offers; other needs stay
      const keep = <T extends { need?: string }>(list: T[] | undefined) => (list ?? []).filter((o) => (o.need ?? '') !== needKey);
      const keepRejected = (list: Rejected[] | undefined) => (list ?? []).filter((r) => (r.offer.need ?? '') !== needKey);
      const merged: OffersState = {
        query: previous ? previous.query : query,
        source: previous && previous.source !== usedSource ? 'mixed' : usedSource,
        ts,
        per_purchase_limit_pln: perOrder,
        per_item_limit_pln: perItem,
        remaining_pln: Number.isFinite(remaining) ? remaining : null,
        accepted: [...keep(previous?.accepted), ...ranked.accepted],
        rejected: [...keepRejected(previous?.rejected), ...ranked.rejected],
        needs: [...(previous?.needs ?? []).filter((n) => n.need !== needKey), { need: needKey, query, category, source: usedSource, ts, accepted: ranked.accepted.length, rejected: ranked.rejected.length }],
      };
      if (!append && !need) delete merged.needs;
      writeState('offers.json', merged);
      audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'search_done', flow: 'search', data: { query, need, source: usedSource, offers_total: offers.length, accepted: ranked.accepted.length, rejected: ranked.rejected.length, appended: append } });
      out(`search "${query ?? '(state)'}"${need ? ` for need "${need}"` : ''} via ${usedSource}: ${offers.length} offers, ${ranked.accepted.length} within the mandate${append ? ` (appended; ${merged.accepted.length} accepted in total)` : ''}`);
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
      const sel: SelectedOffer = { id: offer.id, url: offer.url, title: offer.title, total_pln: offer.total_pln, price_pln: offer.price_pln, seller: offer.seller, category, rationale };
      writeState('selected.json', sel);
      audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'offer_selected', flow: 'search', data: { id: sel.id, kind: offer.kind ?? 'offer', url: sel.url, title: sel.title, total_pln: sel.total_pln, seller: sel.seller, smart: offer.smart, super_seller: offer.super_seller, category, rationale } });
      out(`selected ${sel.id} ${sel.total_pln.toFixed(2)} PLN ${sel.title}`);
      return EXIT.OK;
    }

    case 'basket:plan': {
      // Smart! basket (design synthesis 2026-09-04, section 1): one message, one reply.
      const run = currentRun(cfg);
      const st = readState<OffersState>('offers.json');
      if (!st || !Array.isArray(st.accepted) || st.accepted.length === 0) {
        out('no accepted offers in .state/offers.json: run `asa search --query "<query_pl>" --need <label> --append` for each wishlist line first');
        return EXIT.DECISION;
      }
      const { limits, remaining } = mandateLimits(cfg, audit, run);
      const profile = loadProfile(cfg.shoppingProfileDir);
      const check = checkProfileFiles(cfg.shoppingProfileDir, { categories: limits.categories });
      if (check.pii) {
        out(formatProfileCheck(check));
        return EXIT.STOP;
      }
      const accepted = st.accepted as BasketOffer[];
      const labels = Array.from(new Set(accepted.map((o) => o.need ?? st.query ?? 'need')));
      // context-first: the brief must cover every need of the basket (one brief per basket)
      const gate = contextGate(cfg, audit, run, labels.join(';'), args, 'basket');
      if (gate.stop !== undefined) return gate.stop;
      const brief = gate.brief;
      const primaryArg = str(args, 'primary');
      const primary = primaryArg ? primaryArg.split(';').map((s) => s.trim()).filter(Boolean) : labels;
      const needOf = (label: string): Need => {
        const w = profile.wishlist.find((l) => l.label === label);
        const fromSearch = st.needs?.find((n) => n.need === label);
        return { label, category: w?.category ?? fromSearch?.category ?? accepted.find((o) => o.need === label)?.category, priority: w?.priority, qty: w?.qty, max_item_pln: w?.max_item_pln, source: w?.source };
      };
      const needs = primary.map(needOf);
      const offers: BasketOffer[] = accepted.map((o) => {
        const label = o.need ?? (labels.length === 1 ? labels[0] : undefined);
        const n = label ? needOf(label) : undefined;
        return { ...o, need: label, category: o.category ?? n?.category };
      });
      const bb = (o: Offer) => {
        const rec = boughtBefore(profile.history, o);
        return rec ? { date: rec.date } : false;
      };
      const threshold = cfg.smartThresholdPln;
      const plan = planBaskets(needs, offers, { threshold, perItemLimit: limits.perItemPln, perOrderLimit: limits.perPurchasePln, maxItems: limits.maxItems, remainingAggregate: remaining, boughtBeforeFn: bb, avoidSellers: profile.sellers.avoid });
      const slack = num(args, 'slack') ?? cfg.smartSlackPln;
      const maxComplements = num(args, 'max-complements') ?? cfg.maxComplements;
      // complement candidates: accepted offers of the chosen seller that are not primary needs (lower-priority wishlist lines, seller-store finds)
      const candidates = offers.filter((o) => !primary.includes(o.need ?? ''));
      const proposal = proposeComplements(plan, candidates, {
        threshold,
        slack,
        perItemLimit: limits.perItemPln,
        perOrderLimit: limits.perPurchasePln,
        maxItems: limits.maxItems,
        categories: limits.categories,
        primaryCategory: needs[0]?.category,
        boughtBeforeFn: bb,
        wishlistFn: (o) => wishlistMatch(profile.wishlist, o) !== undefined,
        isBlockedFn: (o) => isBlocked(profile, o).blocked,
        recentlyBoughtFn: (o) => recentlyBought(profile.history, o, cfg.reorderCooldownDays) !== undefined,
        consumableFn: (o) => isConsumableCategory(o.category) || wishlistMatch(profile.wishlist, o)?.consumable === true,
        maxShow: 3,
      });
      if (maxComplements <= 0) proposal.shown = [];
      const seller = plan.orders[0]?.seller ?? '';
      // facts, assumptions and open questions come from the context brief first; --assumptions / --not-taken add to them
      const facts = brief?.facts_confirmed.map((f) => f.fact) ?? [];
      const assumptions = [...(brief?.assumptions.map((a) => a.text) ?? []), ...splitList(str(args, 'assumptions'))];
      const notTaken = [...(brief?.open_questions.map((q) => t('plan.open_question', { text: q.text })) ?? []), ...splitList(str(args, 'not-taken'))];
      const needSources = Object.fromEntries(needs.filter((n) => n.source).map((n) => [n.label, n.source as string]));
      const text = formatPlan(plan, proposal, {
        runId: run.run_id,
        remainingPln: remaining,
        limits: { perItem: limits.perItemPln, perOrder: limits.perPurchasePln, maxItems: limits.maxItems },
        rail: cfg.defaultRail,
        purchaseDates: purchasesFromSeller(profile.history, seller).map((r) => r.date),
        facts,
        assumptions,
        needSources,
        notTaken,
        maxComplements,
        contextSkipped: gate.skipped,
      });
      const state: BasketPlanState = { run_id: run.run_id, ts: new Date().toISOString(), needs, primary, plan, proposal, threshold_pln: threshold, slack_pln: slack, max_complements: maxComplements, remaining_pln: remaining, text, context_brief_hash: brief?.brief_hash, context_skipped: gate.skipped };
      writeState('basket-plan.json', state);
      removeState('basket.json');
      audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'basket_planned', flow: 'basket', data: { seller, orders: plan.orders.length, lines: plan.orders.map((o) => o.lines.map((l) => ({ id: l.id, need: l.need, price_pln: l.price_pln, smart: l.smart }))), subtotal_pln: plan.subtotal_pln, expected_pln: plan.expected_pln, ceiling_pln: plan.ceiling_pln, free_delivery: plan.orders[0]?.free_delivery ?? false, threshold_pln: threshold, needs_override: plan.needs_override, aggregate_exceeded: plan.aggregate_exceeded, uncovered: plan.uncovered, plans_considered: plan.plans_considered } });
      if (proposal.applicable) {
        audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'complementary_proposed', flow: 'basket', data: { delta_pln: proposal.delta_pln, window: proposal.window, considered: proposal.considered, skipped: proposal.skipped, shown: proposal.shown.map((c) => ({ n: c.n, id: c.offer.id, price_pln: c.price_pln, tier: c.tier, score: c.score })) } });
      }
      out(text);
      // diagnostics for the session go to stderr so the message above can be relayed as is
      const skipped = Object.entries(proposal.skipped).map(([k, v]) => `${k}=${v}`).join(', ');
      if (skipped) process.stderr.write(`complements: ${proposal.shown.length} shown of ${proposal.considered} candidates (skipped: ${skipped}${proposal.skipped.outside_mandate_categories ? '; a candidate needs a mandate category: pass --category to `search --need`' : ''})\n`);
      else if (!proposal.applicable && proposal.reason) process.stderr.write(`complements: not applicable (${proposal.reason})\n`);
      if (plan.uncovered.length) process.stderr.write(`uncovered needs: ${plan.uncovered.join(', ')}\n`);
      if (check.stale) process.stderr.write('profile files are older than 14 days — rebuild them from the vault (asa profile:check)\n');
      return plan.orders.length ? EXIT.OK : EXIT.DECISION;
    }

    case 'basket:approve': {
      const reply = str(args, 'reply');
      const by = str(args, 'by');
      if (!reply || !by) throw new Error('usage: asa basket:approve --reply "<the user\'s reply>" --by "<principal name> (chat)"');
      const run = currentRun(cfg);
      const planState = readState<BasketPlanState>('basket-plan.json');
      if (!planState) throw new Error('no .state/basket-plan.json: run `asa basket:plan` first');
      if (planState.run_id !== run.run_id) throw new Error(`basket-plan.json belongs to run ${planState.run_id}, current run is ${run.run_id}: rerun asa basket:plan`);
      const parsed = parseReply(reply, { needsOverride: planState.plan.needs_override });
      const again = (why: string): number => {
        out(t('approve.not_understood', { why }));
        out(planState.text);
        return EXIT.DECISION;
      };
      switch (parsed.kind) {
        case 'no': {
          removeState('basket-plan.json', 'basket.json', 'selected.json', 'override.json');
          audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'stop', flow: 'basket', data: { reason: 'user_declined', reply } });
          writeStepResult({ flow: 'basket', step: 'approve', status: 'stop', url: '', note: 'STOP: user_declined' });
          out(t('approve.closed'));
          return EXIT.STOP;
        }
        case 'limit_item':
          out(t('approve.limit_item', { amount: parsed.amount as number, by }));
          return EXIT.DECISION;
        case 'limit_order':
          out(t('approve.limit_order', { amount: parsed.amount as number, by }));
          return EXIT.DECISION;
        case 'unknown':
          return again(planState.plan.needs_override ? t('approve.needs_amount') : t('approve.unknown_reply', { reply }));
        default:
          break;
      }
      const { limits, remaining } = mandateLimits(cfg, audit, run);
      const res = applyReply(planState.plan, planState.proposal, parsed, { threshold: planState.threshold_pln, perItemLimit: limits.perItemPln, perOrderLimit: limits.perPurchasePln, maxItems: limits.maxItems, remainingAggregate: remaining, maxComplements: planState.max_complements });
      if ('error' in res) return again(res.error);
      if (res.aggregate_exceeded) {
        process.stderr.write(`STOP: ${res.expected_pln.toFixed(2)} PLN exceeds the remaining aggregate limit ${remaining?.toFixed(2)} PLN; a one-time approval never covers it\n`);
        audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'stop', flow: 'basket', data: { reason: 'mandate_red', failed: ['aggregate'], amount_pln: res.expected_pln, remaining_pln: remaining } });
        return EXIT.STOP;
      }
      let overridePln: number | undefined;
      if (res.needs_override) {
        const need = res.override_required_pln ?? 0;
        if (parsed.kind !== 'amount') return again(t('approve.still_over', { reply, need: money(need) }));
        const amount = parsed.amount as number;
        if (amount + 0.001 < need) return again(t('approve.amount_too_small', { amount: money(amount), need: money(need) }));
        const r = recordOverride(cfg, audit, run, amount, by, res.override_offer_id, reply);
        if (!r.ok) {
          process.stderr.write(r.message + '\n');
          return EXIT.STOP;
        }
        out(r.message);
        overridePln = amount;
      } else if (parsed.kind === 'amount') {
        out(t('approve.amount_not_needed', { amount: money(parsed.amount as number) }));
      }
      const first = res.items[0];
      const primaryLine = res.items.find((l) => !l.complement) ?? first;
      const primaryNeed = planState.needs.find((n) => n.label === primaryLine.need);
      const category = primaryLine.category ?? primaryNeed?.category ?? '';
      const maxLine = res.items.reduce((a, b) => (b.price_pln > a.price_pln ? b : a));
      const rationale = `basket ${res.variant}${res.fallback_option ? '/' + res.fallback_option : ''} approved by ${by}: "${reply}"`;
      const basket = {
        run_id: run.run_id,
        ts: new Date().toISOString(),
        approved_by: by,
        reply,
        variant: res.variant,
        fallback_option: res.fallback_option,
        seller: res.seller,
        items: res.items,
        complement_id: res.complement?.id,
        subtotal_pln: res.subtotal_pln,
        expected_pln: res.expected_pln,
        ceiling_pln: res.ceiling_pln,
        free_delivery: res.free_delivery,
        smart_all: res.smart_all,
        threshold_pln: planState.threshold_pln,
        price_pln: maxLine.price_pln,
        total_pln: res.ceiling_pln,
        category,
        id: first.id,
        url: first.url,
        title: first.title,
        offer_id: first.offer_id,
        override_pln: overridePln,
        rail: cfg.defaultRail,
        other_orders: res.other_orders,
      };
      writeState('basket.json', basket);
      // SelectedOffer shape: the existing single-offer checkout keeps working for one-line baskets
      const sel: SelectedOffer = { id: first.id, url: first.url, title: first.title, total_pln: res.ceiling_pln, price_pln: maxLine.price_pln, seller: res.seller, category, rationale, offer_id: first.offer_id };
      writeState('selected.json', sel);
      audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'basket_approved', flow: 'basket', data: { approved_by: by, reply, variant: res.variant, fallback_option: res.fallback_option, seller: res.seller, items: res.items.map((l) => ({ id: l.id, need: l.need, price_pln: l.price_pln, smart: l.smart, complement: l.complement ?? false })), subtotal_pln: res.subtotal_pln, expected_pln: res.expected_pln, ceiling_pln: res.ceiling_pln, free_delivery: res.free_delivery, override_pln: overridePln, category } });
      out(
        t('approve.approved', {
          variant: res.variant,
          fallback: res.fallback_option ? t('approve.fallback', { option: res.fallback_option }) : '',
          count: res.items.length,
          seller: res.seller,
          subtotal: money(res.subtotal_pln),
          expected: money(res.expected_pln),
          ceiling: money(res.ceiling_pln),
          free: res.free_delivery ? t('approve.free') : '',
        }),
      );
      if (res.other_orders.length) out(t('approve.other_orders', { n: res.other_orders.length }));
      if (res.items.length > 1) out(t('approve.multi_line_note'));
      return EXIT.OK;
    }

    case 'context:brief': {
      // Context-first: the user's knowledge stores are consulted BEFORE any search or plan (hard gate in
      // `search` / `basket:plan`). The runtime retrieves and gates; the operator session reasons and
      // records its conclusions with `context:note`.
      const need = str(args, 'need')?.trim();
      if (!need) throw new Error('usage: asa context:brief --need "<what is being bought>" [--terms a,b,c] [--max N]');
      const run = currentRun(cfg);
      const ctx: RunContext = { run_id: run.run_id, mandate_id: run.mandate_id, flow: 'context' };
      if (!cfg.contextStores.length) {
        process.stderr.write('no knowledge stores configured: set CONTEXT_STORES in config.env (e.g. obsidian:<vault path>;jsonl:<shopping-profile path>) or ASA_CONTEXT_STORES in the environment\n');
        return recordStop(audit, ctx, 'context_missing', { gate: 'no_stores' });
      }
      const stores = parseStoreSpecs(cfg.contextStores, cfg.contextExclude);
      for (const s of stores) if (!storeRootExists(s)) process.stderr.write(`warning: store ${s.id}: root is not a directory, it contributes nothing\n`);
      const extraTerms = (str(args, 'terms') ?? '')
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const needWords = need.split(/\s+/).filter((w) => w.length >= 3);
      const terms = Array.from(new Set([...extraTerms, ...needWords]));
      const max = Math.max(1, Math.trunc(num(args, 'max') ?? cfg.contextMaxSnippets));
      const started = Date.now();
      const brief = buildBrief(stores, { need, terms, maxSnippets: max, now: new Date() }, redact);
      brief.run_id = run.run_id;
      writeBrief(brief);
      const context: RunContextRef = { brief_hash: brief.brief_hash, need: brief.need, ts: brief.ts };
      writeState('run.json', { ...run, context });
      const ms = Date.now() - started;
      audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'context_brief', flow: 'context', data: { need, terms: terms.length, stores: brief.stores, snippets: brief.snippets.length, brief_hash: brief.brief_hash, facts: 0, assumptions: 0, open_questions: 0, ms } });
      out(formatBriefDigest(brief));
      out(`(${ms} ms; written to .state/${BRIEF_FILE}; run ${run.run_id})`);
      if (!brief.snippets.length) {
        process.stderr.write('no snippets: add --terms in the languages of the notes (RU/PL/EN synonyms, sizes, models) or record what is unknown with `asa context:note --question "…"` before searching\n');
        return EXIT.DECISION;
      }
      return EXIT.OK;
    }

    case 'context:note': {
      const fact = str(args, 'fact');
      const assumption = str(args, 'assumption');
      const question = str(args, 'question');
      const given = [fact, assumption, question].filter((v): v is string => v !== undefined);
      if (given.length !== 1) throw new Error('usage: asa context:note --fact "…" [--source "[[note]]"] | --assumption "…" [--reason "…"] | --question "…"');
      const kind: NoteKind = fact !== undefined ? 'fact' : assumption !== undefined ? 'assumption' : 'question';
      const b = addNote(kind, given[0], { source: str(args, 'source'), reason: str(args, 'reason') });
      const run = currentRun(cfg);
      // counts and the hash only: the note text may quote the user's notes
      audit.append({ run_id: run.run_id, mandate_id: run.mandate_id, event: 'context_note', flow: 'context', data: { kind, facts: b.facts_confirmed.length, assumptions: b.assumptions.length, open_questions: b.open_questions.length, brief_hash: b.brief_hash } });
      out(`${kind} recorded in .state/${BRIEF_FILE}: facts ${b.facts_confirmed.length} · assumptions ${b.assumptions.length} · open questions ${b.open_questions.length}`);
      return EXIT.OK;
    }

    case 'profile:check': {
      const limits = checkMandate({ config: cfg, requireSigned: false }).parsed?.limits;
      const c = checkProfileFiles(cfg.shoppingProfileDir, { categories: limits?.categories });
      out(`profile dir: ${cfg.shoppingProfileDir}`);
      out(formatProfileCheck(c));
      return c.pii ? EXIT.STOP : c.stale || !c.ok ? EXIT.DECISION : EXIT.OK;
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
      out('usage: asa <mandate:check|mandate:amend|mandate:sign|override|run:start|context:brief|context:note|search|select|basket:plan|basket:approve|profile:check|checkout|ref:capture|browser:check|audit:append|audit:redact|report|metrics|selectors:set|selectors:domain> [options]');
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
