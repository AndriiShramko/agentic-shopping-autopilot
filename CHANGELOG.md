# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project uses semantic versioning once it leaves alpha.

## [Unreleased]

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
