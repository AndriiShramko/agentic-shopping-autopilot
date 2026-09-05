# AGENTS.md — instructions for coding agents working in this repository

This file is read by Codex, Claude Code, Cursor, Gemini CLI, Copilot and other agents. `README.md` is for humans; this file is for you. If you are installing the project for a user rather than developing it, follow `AGENT_SETUP.md` instead.

## Project in one paragraph

Agentic Shopping Autopilot lets a user's own AI agent read the user's knowledge store first, then find, order and pay for goods on real e-commerce sites under a signed purchase mandate. The deterministic parts (mandate hash check, context gate, allowlists, checkout steps, pay click, audit log) live in `runtime/` (Node 20, TypeScript, Playwright, vitest). The agent session decides only at branch points. Site knowledge lives in `skills/<host>/` (Agent Skills `SKILL.md` format). Specifications and honest limitations live in `docs/`.

## Commands

```bash
cd runtime
npm install            # once
npm test               # offline vitest suite — must stay green
npm run typecheck      # tsc --noEmit
npm run build          # emits dist/ and the `asa` CLI
npm run cli -- <cmd>   # run the CLI from source, e.g. npm run cli -- mandate:check --draft
```

Never run `asa checkout`, `asa basket:approve` or anything that can pay from CI, a scheduled job, or a test. Tests use synthetic fixtures only (`runtime/tests/fixtures/`).

## Layout

- `runtime/src/` — `cli.ts` (dispatch), `mandate.ts`/`amend.ts` (mandate parser, hash, sign), `context/` (knowledge-store adapters, brief, gate), `profile.ts` (JSONL shopping profile), `serp.ts`/`api.ts`/`rank.ts`/`offers.ts` (search), `basket.ts` (Smart! planner, approval grammar), `checkout.ts` (steps 1–10), `browser.ts` (dedicated-profile channel, block detection), `audit.ts`/`redact.ts` (append-only log), `report.ts`, `selectors.ts`, `state.ts`, `stop.ts`, `config.ts`.
- `runtime/tests/` — vitest; one file per module; fixtures under `fixtures/`.
- `skills/allegro.pl/` — `SKILL.md`, `selectors.yaml` (role → css → nl layers), `flows/*.md`, smoke test.
- `docs/` — specifications and research-derived documents; `docs/warnings.md` is the honest list of failure modes.
- `examples/` — mandate template and example profile files (synthetic data only).

## Conventions

- English everywhere in this repository (code, comments, docs, commits). Marketplace UI strings are quoted in the site language where they are data.
- User-facing runtime strings go through `src/i18n.ts` (English default, `ASA_LANG=ru` for Russian). Parsers accept both on read.
- No new runtime dependencies without a reason in the PR; Playwright and yaml are the only runtime deps today.
- Exit codes: `0` ok, `1` error, `2` STOP (decision goes to the user), `3` the session must decide, fix and rerun.
- Every event written to the audit log passes `redactDeep`; never log snippet texts, addresses, locker codes or card details — counts and hashes only.
- Keep `runtime/README.md` command list and `CHANGELOG.md` in sync with any CLI change.

## Security rules for agents editing this repo

- Never commit `config.env`, `PURCHASE_MANDATE.md`, `runtime/.state/`, `audit-*.jsonl`, browser profiles, screenshots with addresses or payment forms. `.gitignore` covers them; check `git status` anyway.
- Never add code that types card numbers, one-time codes or passwords, solves CAPTCHAs, spoofs fingerprints or retries a declined payment. Such pull requests are closed.
- Never weaken the context gate, the mandate gate before the pay click, or the domain allowlist "for testing". Use fixtures.
- If you find a way to move money outside the mandate, do not open a public issue — email zmei116@gmail.com with subject `[ASA security]` (see `SECURITY.md`).

## Adding a site skill

Read `docs/site-skill-spec.md`, copy the layout of `skills/allegro.pl/`, verify every selector in a real logged-in browser by hand, set `last_verified` and `verified_by: human` in `SKILL.md`, add a synthetic fixture for the results page, and describe your live verification in the PR without order numbers or account data.

## Contact

Andrii Shramko — https://www.linkedin.com/in/andrii-shramko/ · zmei116@gmail.com · https://calendar.app.google/Ff729HqGk4RpzPNDA
