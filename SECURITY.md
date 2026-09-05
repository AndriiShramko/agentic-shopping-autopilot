# Security policy

Agentic Shopping Autopilot moves real money on your behalf. This page says what the project protects, what it does not, and how to report a problem. The long form lives in [`docs/security.md`](docs/security.md); the honest list of things that can go wrong is in [`docs/warnings.md`](docs/warnings.md).

## Supported versions

| Version | Status |
|---|---|
| `main` (0.1.x) | alpha — security fixes land here only |

There are no stable releases yet. Update with `git pull --rebase` and re-run the tests (see [`AGENT_SETUP.md`](AGENT_SETUP.md), section "Keep it updated").

## Threat model in ten lines

1. **Untrusted web content** (product titles, descriptions, seller messages, images) can carry prompt injection. The runtime treats every page as data: the model sees redacted accessibility snapshots, never raw HTML with instructions, and the domain allowlist plus the mandate decide what may happen next.
2. **Over-spend by mistake or manipulation** is bounded by the signed mandate: per-item, per-order, aggregate and one-time-approval ceilings are checked mechanically before the pay click.
3. **Wrong seller / wrong item** is mitigated by the cart verification step and the do-not-buy and avoid-seller lists, not eliminated.
4. **Credential theft**: card numbers, CVV, one-time codes and passwords are never typed by the agent and never stored by the project. Payment uses a card you already saved in the marketplace account.
5. **Data exfiltration**: the knowledge-store brief, the audit log and the shopping profile stay on your disk. Nothing is uploaded by the runtime.
6. **Bank challenges (3-D Secure)** are always handed to you; the runtime detects the bank domain and stops reading.
7. **Marketplace bot protection** is never bypassed. A block page or CAPTCHA is a stop, not a puzzle.
8. **Supply chain**: dependencies are pinned in `runtime/package-lock.json`; there are no third-party site skills yet; contributions require a Developer Certificate of Origin sign-off.
9. **Your own agent harness** is part of the trust boundary: never pre-allow `asa override` or `asa mandate:*` commands; keep allow-rules in uncommitted settings.
10. **Kill switch**: create the file `MANDATE_REVOKED` next to your mandate, and freeze the card in your banking app if in doubt. Both take seconds.

## What never leaves your machine

- card data, cookies, browser profile, one-time codes;
- the purchase mandate and its hash;
- `config.env` (recipient details are referenced as `REF_*` keys and redacted everywhere);
- the raw audit log, the context brief (`runtime/.state/context-brief.json`), the shopping profile files.

Only the redacted audit export (`asa audit:redact`) is meant for sharing, and even that should be reviewed before you post it.

## What the project does not protect against

- enforcement of marketplace terms of service against automation (see `docs/warnings.md`);
- wrong facts in your own notes (a wrong size in the vault becomes a wrong purchase within limits);
- a bug that spends money inside the mandate limits — the aggregate limit is your emergency brake, set it to what you can afford to lose;
- unknown classes of prompt injection;
- vendor policy changes in the browser extension or the model.

**There is no hard cap on your card.** The signed aggregate limit is the only brake the software enforces.

## Reporting a vulnerability

Email **zmei116@gmail.com** with the subject prefix `[ASA security]`. You will get an acknowledgement within 72 hours. Please do not open a public issue for anything that can move money or leak personal data; use email first and we will coordinate disclosure.

## Author

Andrii Shramko — [LinkedIn](https://www.linkedin.com/in/andrii-shramko/) · [GitHub](https://github.com/AndriiShramko)
