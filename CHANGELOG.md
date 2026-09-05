# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project uses semantic versioning once it leaves alpha.

## [Unreleased]

### Changed — context-first hardening (after an adversarial review of the 0.1.1 design)
- **Privacy by allow-list.** An Obsidian store is read only inside `00 - Inbox`, `01 - Projects`, `02 - Areas`, `03 - Resources` and `Daily` (`CONTEXT_INCLUDE` replaces the list). Default excludes extended to health, finance, mail, relationship, chat-archive, deployment and memory folders, bank / broker / passport / treatment notes, index and changelog notes and `.log/`; `CONTEXT_EXCLUDE` can only add to them. Hard excludes (lock-glyph names compared on the NFC basename, `secrets/`, `.git/`, `.jsonl`, dot-folders) hold whatever the configuration says. Notes opt out with `asa_context: no` or a `sensitive` / `private` / `health` / `family` tag (`examples/vault-frontmatter.md`).
- **PII filter** (`runtime/src/context/privacy.ts`): snippets with an e-mail, a 16-digit card number, a checksum-valid PESEL, a passport-like id, a date of birth or a secret word (`password`, `пароль`, `hasło`, `token`, `api key`, `secret`, `PIN`) are dropped and counted, on top of the profile check (postal code, phone, locker code, NIP, IBAN); `asa context:note` refuses such text (exit 1). Audit events carry ids, counts, hashes and file names only — no snippet or note text, no store path.
- **Gate hardening.** `run.json` is required (no fabricated run ids; stop `no_run`). One brief per run with one entry per need (`context:brief` upserts, notes of other needs survive); needs match by exact label (`M5` no longer satisfies `M5 DIN 912`). Snippets are numbered `#1..#n`; `context:note --fact --from "#i"` copies file:line mechanically and a fact without `--from` becomes an unsourced assumption; `--question --critical` removes the need from the plan ("not taken (critical parameter unknown)"). Query binding: `context:note --query` records the search string and `asa search --query` passes only with that exact string (`query_not_derived`). A 0-hit brief passes only with a recorded assumption or open question (`empty_without_notes`). `--no-context <code>` works only with `CONTEXT_OPTIONAL=1` in `config.env` and a code in `repeat_purchase` / `owner_said_in_chat` / `diagnostic`. `BRIEF_MAX_AGE` counts from `built`; notes do not refresh it. A `store_fingerprint` (stat-only) warns and audits `context_store_changed` when the stores changed since the brief.
- **Retrieval quality.** Frontmatter `updated` / `modified` / `created` beat the file mtime (`date_basis` recorded), snippets carry `stale` (older than `CONTEXT_STALE_DAYS`, default 180) and `status`; table rows carry the header `columns` and the nearest heading; per-file cap `CONTEXT_MAX_PER_FILE` (5). Matcher: Unicode lookaround boundaries (no ASCII `\b`), stem-prefix matching for inflected words (простыни ↔ простыня, prześcieradła ↔ prześcieradło), folding of `×`, Latin `x` and Cyrillic `х` between digits, blanks inside sizes, `см/cm/мм/mm` suffixes, `ł`, `ё` and diacritics; `--terms` accepts `,` and `;`. The digest reports the store's script share and says when a Cyrillic store got Latin-only terms.
- **Performance and robustness.** Stat-keyed index cache `.state/context-index.json` (unchanged files skip the frontmatter pass), a walk that never follows symlinks or junctions with per-entry error handling and NFC path normalisation, `|`-separated fallback paths and quoted paths in `CONTEXT_STORES`.
- **Metrics and report.** `asa metrics` and `asa report` count briefs, facts, assumptions, critical questions, gate skips and dropped snippets; the report lists the facts (file:line) and assumptions of the run's brief.
- Docs: runtime README, `skills/allegro.pl/SKILL.md` step 0, user guide section 4 (allow-list, opt-out key, query binding, the honest limit that the gate is a workflow guarantee plus audit, not a sandbox), security section on the data classes read from the stores, `examples/config.env.example`, new `examples/vault-frontmatter.md`.

## [0.1.1] — 2026-09-05

### Added
- **Context-first gate.** New `runtime/src/context/` module with knowledge-store adapters (Obsidian vault, plain folder, JSONL shopping profile), `asa context:brief` and `asa context:note` commands, a local `context-brief.json`, and a hard gate: `asa search` and `asa basket:plan` stop unless a fresh brief for the same need exists (`--no-context "<reason>"` is audited).
- `AGENT_SETUP.md` — protocol for any AI agent to install, configure, update and uninstall the project for its user.
- `SECURITY.md`, `CONTRIBUTING.md`, `AGENTS.md`, `llms.txt`, `docs/warnings.md`.
- Website: https://agentic-shopping.flyreelstudio.eu (four languages).

### Changed
- README rewritten: answer-first summary, questions people ask their AI, seven-step how-it-works, context-first section, comparison with alternatives, proof of the first live purchase, quickstart for humans, paste-able block for AI agents, safety summary, status table, contact and collaboration block.
- Runtime user-facing strings default to English; Russian available with `ASA_LANG=ru`; parsers still accept Russian labels on read.
- Default private directory is platform-neutral (`~/.asa/private`); `ASA_PRIVATE_DIR` and `--private-dir` still override it.
- Checkout model gained the "select saved card" step (the default payment method on the checkout page can be a bank redirect that must be switched explicitly).
- Purchase history is appended by the runtime after an order is confirmed.

### Verified
- **First live end-to-end autonomous purchase** on Allegro.pl (2026-09-05): order under 50 zł, saved one-click card, free delivery through the loyalty programme, no bank challenge, no CAPTCHA. Driven by the agent session through the Claude in Chrome extension in the owner's own browser profile.

### Corrected
- The 2026-09-04 note that the browser extension "refuses purchases by policy" was wrong; a dedicated remote-debugging profile is no longer required.

## [0.1.0] — 2026-09-04

### Added
- Runtime v0.1 (Node 20, TypeScript, Playwright): byte-exact SHA-256 mandate checker, `MANDATE_REVOKED` kill-switch, `config.env` loader, append-only JSONL audit log with redaction and monthly redacted export, domain allowlist with bank hand-off, dedicated-profile browser channel, block-page detection, layered selector resolver with self-healing write-back, stepwise checkout with mandate gate and `HUMAN_CONFIRM`, search via marketplace API with browser fallback, mandate-based ranking, report and metrics.
- Mandate v1.1: per-item limit, `mandate:amend`, `mandate:sign`, one-time approvals with a signed ceiling.
- Smart! basket planner (`basket:plan`, `basket:approve`): per-seller grouping, free-delivery thresholds, complement tiers, one-message approval grammar.
- Shopping profile (`profile:check`): wishlist, purchase history, trusted and avoided sellers, do-not-buy list, PII check.
- Allegro.pl site skill (search and checkout flows, selectors verified on the live results page).

## [0.0.1] — 2026-08-31

### Added
- Initial public release: research-based documentation set (landscape, marketplaces, payments, execution stack, anti-bot policy, security, registry, mandate and site-skill specifications), mandate template, skill skeleton.
