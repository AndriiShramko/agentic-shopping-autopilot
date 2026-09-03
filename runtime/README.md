# runtime/ — the deterministic runtime of Agentic Shopping Autopilot

Node 20 + TypeScript + Playwright. The runtime is a **step-wise CLI** (`asa`) driven by an operator session
(Claude Code or Codex): the runtime does everything that can be checked mechanically — mandate, limits, domains,
selectors, audit log, the pay click and the 3DS hand-off — and stops with a redacted snapshot whenever a decision
is needed (exit code 3). No LLM API keys, no Stagehand/browser-use: the operator session *is* the LLM at branch
points.

## What it enforces

| Concern | Module | Rule |
|---|---|---|
| Purchase mandate | `src/mandate.ts` | SHA-256 over the lines from `## 1.` to the line before `## 7.` (LF, no BOM, trailing newlines dropped) must equal the hash in section 7 **and** `MANDATE_SHA256` in `config.env`; `status: signed`; `MANDATE_REVOKED` absent; validity (Europe/Warsaw, inclusive); per-purchase and aggregate limits; category and domain allowlists. |
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
npm test                            # 49 offline tests, no marketplace traffic
```

Configuration lives in the **private** repository (`ASA_PRIVATE_DIR` or `--private-dir`, default
`C:\dev\agentic-shopping-autopilot-private`): `PURCHASE_MANDATE.md` and `config.env` with the keys
`MANDATE_PATH`, `MANDATE_SHA256`, `ALLEGRO_CLIENT_ID`, `ALLEGRO_CLIENT_SECRET`, `ALLEGRO_TOKEN_FILE`, `CDP_URL`,
`HUMAN_CONFIRM`, `REF_FULL_NAME`, `REF_DELIVERY_ADDRESS`, `REF_PICKUP_POINT`. `config.env` is gitignored.

## Commands

```
asa mandate:check [--amount N] [--category C] [--domain D] [--draft]
asa run:start --command "buy X up to Y zł" [--mode cdp|mcp]
asa search --query Q [--source api|serp|state] [--auth client|device] [--limit N]
asa select --id OFFER_ID --category C --rationale "..."
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

`.state/` (gitignored): `run.json` (current run and mandate id), `offers.json` (ranked offers with rejection
reasons), `selected.json` (the chosen offer and the agreed ceiling), `step-result.json` (`{flow, step, status,
url, ts, note, snapshot}`), `snapshot-*.yaml` (redacted a11y snapshots), `report-*.md`.

In **MCP mode** (no dedicated profile), the session performs the browser steps itself through the user's own
Chrome and still uses the runtime for the mandate check, ranking (`asa search --source state`), the audit log and
the report; metrics are then labelled as MCP mode.
