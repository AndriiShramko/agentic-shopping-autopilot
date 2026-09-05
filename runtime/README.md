# runtime/ — the deterministic runtime of Agentic Shopping Autopilot

Node 20 + TypeScript + Playwright. The runtime is a **step-wise CLI** (`asa`) driven by an operator session
(Claude Code or Codex): the runtime does everything that can be checked mechanically — mandate, limits, domains,
selectors, audit log, the pay click and the 3DS hand-off — and stops with a redacted snapshot whenever a decision
is needed (exit code 3). No LLM API keys, no Stagehand/browser-use: the operator session *is* the LLM at branch
points.

## What it enforces

| Concern | Module | Rule |
|---|---|---|
| Context gate (context-first) | `src/context/*` | Before the session searches or plans, the runtime itself consults the user's knowledge stores (`CONTEXT_STORES`: `obsidian:<vault>`, `jsonl:<shopping-profile>`, `folder:<dir>`; local file system only, never network) for the need at hand and writes one need brief into `.state/context-brief.json` (`asa context:brief`, one brief per run, one entry per need, numbered snippets `#1..#n` with date, heading, table columns and a `!stale` marker). The session records what it derived with `asa context:note --need L`: `--fact T --from "#i"` (file:line copied from the snippet; a fact without `--from` is downgraded to an *unsourced* assumption), `--assumption T --reason R`, `--question T [--critical]`, and `--query Q --from "#i"` — the exact search string it will use. `asa search` and `asa basket:plan` **refuse to run** (exit 2, stop reason `context_missing`, audit `context_gate_stop{reason}`) unless `run.json` exists, the brief belongs to this run, the need label matches exactly, the need has hits or a recorded assumption / open question, no critical question is open, the brief is younger than `CONTEXT_BRIEF_MAX_AGE_MIN` and — for a search — the query was recorded for that need. `--no-context <code>` (`repeat_purchase`, `owner_said_in_chat`, `diagnostic`) passes only when the owner set `CONTEXT_OPTIONAL=1` in `config.env`; it is audited as `context_skipped{reason_code}` and the proposal says so. A need with a critical open question is left out of the plan ("not taken (critical parameter unknown)"). Privacy: a vault is read only inside the allow-list (`00 - Inbox`, `01 - Projects`, `02 - Areas`, `03 - Resources`, `Daily`; `CONTEXT_INCLUDE` replaces it), the default excludes (archive, health, finance, mail, relationships, chat archives, deployment, memory, bank / broker / passport / treatment notes, index and changelog notes, `.log/`) can only be extended, the hard excludes (lock-glyph names, `secrets/`, `.git/`, `.jsonl`, dot-folders) always hold, `asa_context: no` or a `sensitive` / `private` / `health` / `family` tag opts a note out, every snippet passes the `REF_*` redaction and is dropped when it looks like PII or a secret (`src/context/privacy.ts`), `context:note` refuses such text, and audit events carry counts, ids, hashes and file names only — never snippet or note texts, never a store path. Checkout step 10 appends the confirmed order to `purchase-history.jsonl`. |
| Purchase mandate | `src/mandate.ts`, `src/amend.ts` | SHA-256 over the lines from `## 1.` to the line before `## 7.` (LF, no BOM, trailing newlines dropped) must equal the hash in section 7 **and** `MANDATE_SHA256` in `config.env`; `status: signed`; `MANDATE_REVOKED` absent; validity (Europe/Warsaw, inclusive); per-item, per-order, lines-per-order and aggregate limits; category and domain allowlists. Quick limit changes: `mandate:amend` rewrites section 2 and drops to `draft`; the principal confirms the new hash in chat and `mandate:sign` signs. A one-time over-limit approval (`override`, chat-confirmed amount) lifts the item and order limits up to the ceiling signed in the mandate and never the aggregate limit. |
| Spend tracking | `src/audit.ts` | Append-only JSONL (`measurements/raw/audit-YYYY-MM.jsonl`); "spent" = sum of `order_confirmed.amount_pln` for the mandate; redacted monthly export is the only copy that goes into git. |
| Secrets | `src/config.ts`, `src/redact.ts` | Recipient reference (`REF_*`) and API secrets are read for mechanical checks only, never printed, logged or written into snapshots; address-like keys are dropped from every audit line. |
| Domains | `src/allowlist.ts` | `*.allegro.pl`, `*.payu.com` plus hosts recorded in `skills/allegro.pl/selectors.yaml` → `domains`. The bank's 3DS page is deliberately **not** allowlisted: during a challenge the runtime neither reads nor clicks, it waits (≤ 5 min) for the return. |
| Browser | `src/browser.ts` | Channel B = `chromium.connectOverCDP` to a dedicated, headed, real Chrome profile on the user's machine. Never headless against a marketplace; a DataDome/CAPTCHA page is a STOP (exit 2), never bypassed. |
| Selectors | `src/selectors.ts` | Layered resolution role → css → NL. Unresolved = exit 3 with an a11y snapshot in `.state/`; the session fixes `selectors.yaml` (`asa selectors:set`) and reruns the step. |
| Checkout | `src/checkout.ts` | Steps 1–10 (`asa checkout --step N`); step 8 is the full mandate gate on the total shown by the shop; `HUMAN_CONFIRM=1` stops before the pay button; a declined payment or a 3DS timeout is a STOP with no retry on any rail. |
| Search | `src/api.ts`, `src/serp.ts`, `src/rank.ts` | Allegro `GET /offers/listing` (OAuth2 device flow or client credentials) with a SERP fallback in the user's own logged-in profile; mechanical filter (Buy-Now, new, price + delivery ≤ limit, Smart! / Super Seller / rating ≥ 98 %) and ranking by the shop's "z dostawą" total. Which offer matches the user's request is the session's decision, recorded with a rationale. |
| Reporting | `src/report.ts` | Post-purchase report and MVP metrics: share of purchases without a human, 3DS share, median command→order time with the 3DS window excluded. |

## Setup

```bash
cd runtime
npm install
npx playwright install chromium     # only for the offline fixture tests
npm test                            # offline tests only, no marketplace traffic (the state dir is a scratch folder)
```

Configuration lives in the **private** folder (`ASA_PRIVATE_DIR` or `--private-dir`, default `~/.asa/private`):
`PURCHASE_MANDATE.md` and `config.env` (template: `../examples/config.env.example`) with the keys
`MANDATE_PATH`, `MANDATE_SHA256`, `ALLEGRO_CLIENT_ID`, `ALLEGRO_CLIENT_SECRET`, `ALLEGRO_TOKEN_FILE`, `CDP_URL`,
`HUMAN_CONFIRM`, `REF_FULL_NAME`, `REF_DELIVERY_ADDRESS`, `REF_PICKUP_POINT`, for the Smart! basket
`SMART_THRESHOLD_PLN` (49.90), `SMART_SLACK_PLN` (25), `MAX_COMPLEMENTS` (1), `REORDER_COOLDOWN_DAYS` (30),
`SHOPPING_PROFILE_DIR` (`<private>/shopping-profile`), `DEFAULT_RAIL`, `ALLEGRO_LOGIN`, for the context gate
`CONTEXT_STORES` (`obsidian:<path>;jsonl:<path>;folder:<path>`, split on the first colon of each spec; a path may list
`|`-separated fallbacks, first existing wins; a path with blanks may be quoted), `CONTEXT_INCLUDE` (allow-list globs for
vault stores; default `00 - Inbox/**;01 - Projects/**;02 - Areas/**;03 - Resources/**;Daily/**`), `CONTEXT_EXCLUDE`
(extra globs; the default and hard excludes cannot be removed), `CONTEXT_MAX_SNIPPETS` (40), `CONTEXT_MAX_PER_FILE` (5),
`CONTEXT_STALE_DAYS` (180), `CONTEXT_BRIEF_MAX_AGE_MIN` (240), `CONTEXT_OPTIONAL` (0; `1` is the owner's decision that
lets `--no-context <code>` pass the gate), and `ASA_LANG` (`en` default, `ru`). `config.env` is gitignored.
Environment overrides: `ASA_CONTEXT_STORES` (stores for one run), `ASA_LANG`, `ASA_STATE_DIR` (moves `.state/`).

The **shopping profile** (`shopping-profile/wishlist.jsonl`, `purchase-history.jsonl`, `sellers.json`,
`do-not-buy.txt`; examples in `../examples/shopping-profile/`) is generated by the operator session from the
user's own notes, read by `basket:plan` and by the `jsonl:` context store, and extended by the runtime after every
confirmed order; `profile:check` refuses files that carry address-like data.

The strings shown to people (the basket proposal, reply feedback, the mandate lines written by `mandate:amend` /
`mandate:sign`) are English by default and Russian with `ASA_LANG=ru`; parsers stay bilingual, so an existing Russian
mandate and Russian replies («ок без 3») are always accepted.

## Commands

```
asa mandate:check [--amount N] [--item N] [--category C] [--domain D] [--draft]
asa mandate:amend [--per-item N] [--per-order N] [--max-items N] [--total N] [--override-max N] [--from D] [--to D] [--categories "a; b"]
asa mandate:sign --by "<name> (chat)" --hash <sha256>      # after the principal confirmed the hash in chat
asa override --amount N --by "<name> (chat)" [--offer-id ID]  # one-time over-limit approval, this run only
asa run:start --command "buy X up to Y zł" [--mode cdp|mcp]
asa context:brief --need "<label>" [--terms "a,b;c"] [--max N]   # context-first: MUST precede search / basket:plan; needs run.json; exit 3 = no snippets
asa context:note --need "<label>" --fact "..." --from "#3,#7"     # a fact cites snippet ids; file:line is copied mechanically
asa context:note --need "<label>" --assumption "..." --reason "..."
asa context:note --need "<label>" --question "..." [--critical]  # critical = the need is not searched and left out of the plan
asa context:note --need "<label>" --query "<search string>" --from "#3"   # the exact string `search --query` may use
asa search --query Q [--source api|serp|state] [--auth client|device] [--limit N] [--need LABEL --append] [--category C] [--no-context <code>]
asa select --id OFFER_ID --category C --rationale "..."           # single offer
asa basket:plan [--slack N] [--max-complements N] [--no-context <code>]   # Smart! basket: seller-grouped plan + complements, one message
asa basket:approve --reply "ok | ok B | ok A/B | ok without 3 | ok + 4 | ok 84,90 | no | item limit 120" --by "<name> (chat)"
asa profile:check                                                 # shopping-profile/*.jsonl: PII scan, staleness
asa checkout --step 1..10 [--rail oneclick_card|allegro_pay]
asa ref:capture            # channel B: writes REF_* into config.env without showing them
asa browser:check          # channel B connectivity, block page, login state
asa audit:append --event E [--data JSON] [--flow F] [--step S]
asa audit:redact --month YYYY-MM
asa report [--run-id ID] · asa metrics
asa selectors:set ID CSS · asa selectors:domain HOST
```

Run with `npm run cli -- <command>` (tsx) or build with `npm run build` and use `node dist/cli.js`.
Exit codes: `0` ok · `1` error · `2` STOP (a stop trigger fired; the decision goes to the user) · `3` the
session must decide, fix and rerun.

## State handed to the operator session

`.state/` (gitignored; `ASA_STATE_DIR` moves it): `run.json` (current run and mandate id; `context: {brief_hash,
needs, built}` once a brief exists), `context-brief.json` (`{run_id, needs: {<needKey>: {need, terms, ts, hits,
dropped, by_store, snippets[#id, file, line, text, score, modified, date_basis, stale, status, heading, columns],
facts[text, from_ids, file, line], assumptions[text, reason], open_questions[text, critical], queries[query,
from_ids]}}, stores, store_fingerprint, brief_hash, dropped_pii, built}`; deleted by `run:start`),
`context-index.json` (stat-keyed index cache of the stores, survives runs; store roots appear only as hashes),
`offers.json` (ranked offers with rejection reasons), `selected.json` (the chosen offer and the agreed ceiling),
`basket-plan.json` (includes `context_brief_hash`), `basket.json`, `step-result.json` (`{flow, step, status, url,
ts, note, snapshot}`), `snapshot-*.yaml` (redacted a11y snapshots), `report-*.md`.

Context gate reasons (audit `context_gate_stop.reason`, stderr hint): `no_run` (no `run.json`; nothing is fabricated),
`no_stores` (`CONTEXT_STORES` empty), `no_brief`, `run_mismatch` (brief of another run or hash differs from `run.json`),
`need_missing` (no brief for that exact label — `M5` does not satisfy a brief for `M5 DIN 912`), `empty_without_notes`
(0 hits and no assumption / open question recorded), `query_not_derived` (the search string was not recorded with
`context:note --query`), `stale` (older than `CONTEXT_BRIEF_MAX_AGE_MIN`, counted from `built`; notes do not refresh it),
`critical_open` (a critical open question; `basket:plan` leaves the need out instead of stopping). A store that changed
since the brief was built is a warning plus `context_store_changed`, not a stop. `asa metrics` and `asa report` count
briefs, facts, assumptions, critical questions, gate skips and snippets dropped by the PII filter; the report lists the
facts (file:line) and assumptions of the run's brief.

In **MCP mode** (`--mode mcp`, no dedicated profile) the session reads pages through the user's own Chrome
(search, flow recording, attribute reading) and still uses the runtime for the mandate check, ranking
(`asa search --source state`), the audit log and the report. The address, payment-method and pay steps are never
driven through the browser extension: they run over the dedicated CDP profile or are handed to the user.
Metrics are then labelled as MCP mode.
