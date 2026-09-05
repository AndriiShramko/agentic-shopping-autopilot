# Agentic Shopping Autopilot — your own AI agent buys and pays for you, under a mandate you sign once

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Runtime tests](https://img.shields.io/badge/runtime%20tests-passing-brightgreen.svg)](runtime/README.md)
[![First live purchase](https://img.shields.io/badge/first%20live%20autonomous%20purchase-2026--09--05-success.svg)](#proof-the-first-live-purchase-2026-09-05)
[![Website](https://img.shields.io/badge/website-agentic--shopping.flyreelstudio.eu-orange.svg)](https://agentic-shopping.flyreelstudio.eu)

**Agentic Shopping Autopilot** is an open-source layer that lets *your own* AI agent — Claude Code today; Codex, Cursor or Gemini CLI through the same protocol — **read your notes first, then find, order and pay** for goods on real e-commerce sites (Allegro.pl first) under a purchase mandate you sign once. It runs in your own logged-in browser with a card you already saved, stays inside per-item, per-order and total limits, never bypasses a CAPTCHA or a bank challenge, writes an append-only audit log and returns a report.

**Verified:** first live end-to-end autonomous purchase completed on **2026-09-05** — an order under 50 zł, paid with a saved card in about ten seconds, no bank challenge. Details and caveats [below](#proof-the-first-live-purchase-2026-09-05).

> Website with examples, install instructions for humans and for AI agents, and honest warnings: **https://agentic-shopping.flyreelstudio.eu**

## What is Agentic Shopping Autopilot?

- **For whom:** people who already use an AI coding or desktop agent and want it to handle real purchases — reorders, consumables, parts for a project, household basics — without turning every purchase into a twenty-message chat.
- **What it does:** consults your knowledge store (an Obsidian vault today, other stores through the same adapter), searches the marketplace, compares offers against your mandate and your history, builds a basket that reaches the free-delivery threshold, checks the cart, selects your saved payment method and pays. Then it logs and reports.
- **What it never does:** enters card numbers, one-time codes or passwords; solves CAPTCHAs; spoofs a browser fingerprint; retries a declined payment; spends above the limits you signed.

## Questions people ask their AI

- **How can I make my AI agent actually buy something for me, not just find it?** Sign a purchase mandate with limits, connect your notes, install the site skill; the agent shops in your browser and pays with your saved card.
- **Why does Claude, Codex or another AI agent refuse to press "pay", and how do I authorize it properly?** Models refuse when consent is not visible. A signed, hash-verified mandate in the agent's context makes consent explicit and bounded.
- **Can an AI agent pay for an online order by itself in the EU under PSD2, and when will my bank still ask for 3-D Secure?** Yes, with a saved one-click card. Periodic strong authentication is required by law; the agent hands that step to you and waits.
- **How does the agent know which size, brand, pack and seller I want without asking me?** It reads your knowledge store before choosing (the context-first gate), records the facts it found and the assumptions it made, and prints both in the proposal.
- **Is there an open-source shopping agent for Allegro.pl in Poland that works with my own account, prices and Smart! delivery?** This one. It uses your account, your saved card, your loyalty thresholds.
- **How do I set spending limits for an AI agent and revoke them instantly?** Limits live in `PURCHASE_MANDATE.md` (per item, per order, aggregate, one-time ceiling); create a file named `MANDATE_REVOKED` to stop everything.
- **Does the agent bypass CAPTCHAs, DataDome or anti-bot checks?** No. A challenge is a stop handed to you. This is a design rule, not a limitation we plan to fix.
- **What can go wrong when an AI agent spends my money?** Read [`docs/warnings.md`](docs/warnings.md) — marketplace terms, bank challenges, wrong items within limits, price changes, vendor policy changes.
- **Can my AI agent install and configure this by itself, and keep it updated?** Yes — paste the block from ["For AI agents"](#for-ai-agents-install-it-for-your-user) into any agent; it follows [`AGENT_SETUP.md`](AGENT_SETUP.md).
- **How do I teach the agent a new shop and share that skill?** Write a site skill in the open `SKILL.md` format and open a pull request; see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## How it works, in seven steps

1. **You sign a mandate once.** `PURCHASE_MANDATE.md` states limits, categories, marketplaces, validity and a one-time-approval ceiling. The runtime hashes sections 1–6 and refuses to work if a byte changed.
2. **The agent reads your context first.** `asa context:brief` searches your knowledge store for the need at hand (sizes, models, quantities, what you bought before, what you have at home, sellers to avoid) and writes a local brief with facts, assumptions and open questions. Search and basket planning refuse to run without a fresh brief.
3. **It searches** the marketplace in your own browser (the site API where it exists), filters by the mandate and ranks offers.
4. **It plans a basket** that reaches the free-delivery threshold at one seller, adding at most a few complements you have bought before, and shows you one proposal message. You answer with one word, or with nothing if you have chosen full autonomy.
5. **It checks the cart** — seller, price, quantity, condition, delivery cost — against the approved plan. Any deviation is a stop.
6. **It pays** with your saved one-click card. If the bank asks for 3-D Secure, you get a push and the agent waits. If the marketplace shows a CAPTCHA or a block page, the agent stops.
7. **It logs and reports.** Append-only, redacted audit log; the purchase is appended to your purchase history so the next brief already knows about it.

```
You (once):   sign PURCHASE_MANDATE.md  ──►  connect knowledge store  ──►  saved card already in the shop account
Agent (each): context brief ─► search ─► plan basket ─► verify cart ─► pay ─► audit + report
Human only:   bank 3-D Secure · CAPTCHA/block page · deviation from the mandate · (optional) confirm flag
```

## Context-first: the agent reads your notes before it chooses

Most shopping agents ask you five questions and still buy the wrong size. This project inverts that: **before any search, the runtime must produce a context brief from your knowledge store**, and the search and basket commands are gated on it.

- **Stores today:** an Obsidian vault (Markdown notes with frontmatter), a folder of `.md/.txt/.json` files, and the JSONL shopping profile (wishlist, purchase history, trusted and avoided sellers, do-not-buy list). Adapters share one interface, so a Notion export, Logseq graph or any future store plugs in the same way.
- **What it looks for:** the need's terms in your language and the shop's language (e.g. bed size and mattress model for "sheets", printer nozzle and spool count for "filament", the BOM line for "O-rings").
- **What it records:** `facts_confirmed` with the note they came from, `assumptions` with the reason, `open_questions` for what the store could not answer. The proposal prints the assumptions; an unknown critical attribute means the item is skipped with a one-line note — never a round of questions.
- **Privacy:** the brief is local and git-ignored; archived notes and secret notes are excluded by hard-coded rules; every snippet passes the same redaction filter as the audit log; nothing is uploaded.

Example: *"Order a spare set of bed sheets."* The brief finds the bed frame and mattress size and the second bed in the house, plus last year's linen purchase. The agent buys a fitted sheet of the right size and depth at one seller with free delivery, and does not ask "what size is your bed?".

## Advantages

| | What you get |
|---|---|
| **Your agent, your accounts** | Runs in your logged-in browser with your saved card, your prices, your loyalty delivery threshold and your invoice settings — not a vendor's checkout with a vendor's card. |
| **Autonomy inside limits** | Per-item, per-order, aggregate and one-time-approval ceilings are checked mechanically before the pay click; a kill-switch file stops everything. |
| **No questions you already answered** | Context-first: sizes, models, norms, history and do-not-buy lists come from your notes, with assumptions printed. |
| **Honest by design** | No anti-detect, no proxies, no CAPTCHA solving, no retries of declined payments; risks are documented, not hidden. |
| **Open and portable** | Apache-2.0 code, CC BY 4.0 docs, site skills in the open Agent Skills (`SKILL.md`) format that Claude Code, Codex, Cursor and others can load. |
| **Auditable** | Append-only, redacted JSONL audit log and a report after every purchase. |

## Compared with the alternatives

| | Who holds the mandate | Uses your accounts, prices, loyalty | Pays by itself | Knows your home context | Open source | Anti-bot posture |
|---|---|---|---|---|---|---|
| Manual shopping | you, every time | yes | no | only what you remember | n/a | n/a |
| Vendor browser agents (ChatGPT agent / Operator style) | vendor; confirm-before-purchase | partly | no | no | no | cloud browser; agent mode unavailable in the EU at the time of research |
| Merchant-side checkout protocols (ACP-style "instant checkout") | merchant | only integrated merchants | no | no | spec only | product closed in early 2026; no Polish merchants |
| Marketplace "buy for me" features | the marketplace | that marketplace only | no | no | no | closed |
| Generic open-source browser agents | none — no mandate concept | can drive any site from a headless browser | technically, with raw card data | no | yes | headless profiles get blocked; some sell CAPTCHA bypass |
| **Agentic Shopping Autopilot** | **you, once** (signed, hash-verified mandate) | **yes** | **yes** — verified 2026-09-05 | **yes** — context-first gate | **yes** | real profile, human pace, stop on any challenge |

Unknowns we state openly: real 3-D Secure frequency over many purchases (one purchase so far), bot-protection tolerance for repeated deterministic runs, whether the marketplace grants API access to a shopping agent.

## Proof: the first live purchase (2026-09-05)

- **What:** fifteen drywall anchors for a TV mount that the owner had put into the cart himself, with the instruction "pay without my participation".
- **How:** the agent opened the cart in the owner's own Chrome through the Claude in Chrome extension, went to delivery and payment, found the default payment method set to a bank redirect (unusable for an agent), switched to the saved-card modal, selected a card already saved in the account and clicked pay.
- **Result:** "purchase paid" in about ten seconds, order under 50 zł, free delivery through the loyalty programme, **no 3-D Secure, no CAPTCHA, no block page**. Confirmed on the marketplace's order page.
- **Caveats, stated plainly:** the purchase was driven by the agent session through the browser extension; the `asa checkout` steps of the runtime did not execute this particular payment yet. The pay-later rail was not tested. One purchase is a sample of one.

What changed because of it: the checkout model gained a "select saved card" step, the earlier note claiming that the extension refuses purchases was corrected, and a dedicated browser profile is no longer required.

## Quickstart for humans

**Prerequisites:** Node 20+, git, Chrome with your marketplace account logged in and a card already saved there, and a browser channel for your agent (the Claude in Chrome extension, or a dedicated Chrome profile with remote debugging). Windows 10 is verified; macOS and Linux should work and are unverified.

```bash
git clone https://github.com/AndriiShramko/agentic-shopping-autopilot.git
cd agentic-shopping-autopilot/runtime
npm install && npm test          # offline tests, no network, no purchases
npm run build                    # asa CLI in dist/
```

Then create a private folder outside any git repo (default `~/.asa/private`, or set `ASA_PRIVATE_DIR`), copy `examples/PURCHASE_MANDATE.template.md` there as `PURCHASE_MANDATE.md`, fill in the limits, point `CONTEXT_STORES` in `config.env` at your notes, and let your agent walk through [`AGENT_SETUP.md`](AGENT_SETUP.md). The first purchase is done with `HUMAN_CONFIRM=1` while you watch.

Full guide: [`docs/user-guide.md`](docs/user-guide.md). Runtime commands: [`runtime/README.md`](runtime/README.md).

## For AI agents: install it for your user

Paste this into Claude Code, Codex, Cursor, Gemini CLI or any agent that can run shell commands and edit files:

```
Install Agentic Shopping Autopilot for me. Read
https://raw.githubusercontent.com/AndriiShramko/agentic-shopping-autopilot/main/AGENT_SETUP.md
and follow it step by step. Ask me only at the decision points it lists
(limits, categories, marketplaces, validity, the path to my notes). Never
type card numbers, passwords or one-time codes. Report "installed" only when
`asa mandate:check` and `asa browser:check` are green.
```

The protocol covers prerequisites, install, the private config folder, connecting the knowledge store, the browser channel check, drafting and signing the mandate, a dry run, the first supervised purchase, updates (`git pull --rebase && npm install && npm test`, then read `CHANGELOG.md`), sharing work back, and uninstall. Machine-readable pointers: [`AGENTS.md`](AGENTS.md), [`llms.txt`](llms.txt), [`skills/allegro.pl/SKILL.md`](skills/allegro.pl/SKILL.md).

## Safety and honest warnings

- The signed aggregate limit is the only brake the software enforces; **there is no hard cap on your card**. Set the limit to what you can afford to lose to a bug, and consider a card limit in your banking app.
- Marketplace terms may prohibit automation (Allegro's regulation, articles 2.8, 10.10 and 10.11, read from the primary source). An account restriction is possible. The author accepted this risk for his own account; you decide for yourself.
- Bank challenges are unavoidable by law and always handed to you. Bank transfers and one-time codes are incompatible with autonomy.
- A wrong fact in your notes becomes a wrong purchase within limits. Keep the notes the agent reads current.
- Vendor policies (browser extension, model) can change overnight. Alpha software, one live purchase, no warranty.

Full list: [`docs/warnings.md`](docs/warnings.md). Security policy and disclosure: [`SECURITY.md`](SECURITY.md).

## What works today, what is planned

| Area | Status (2026-09-05) |
|---|---|
| Mandate checker, kill-switch, audit log, redaction, domain allowlist | implemented, offline tests green |
| Context-first gate with Obsidian / folder / JSONL adapters | implemented |
| Search (browser results page), ranking, Smart! basket planner, one-message approval | implemented |
| Stepwise checkout with mandate gate, saved-card selection, 3-D Secure hand-off | implemented; live payment through the CLI steps not yet exercised |
| Live purchase through the browser extension channel | verified 2026-09-05 |
| Allegro API search | implemented, waits for marketplace app verification |
| OLX.pl (native escrow flow) | planned |
| Site-skill registry, `skill record`, auto-healing skills | planned |
| Agents other than Claude Code | same protocol, unverified |

## Roadmap

- **Now:** run the runtime's own checkout steps end-to-end on live purchases; measure 3-D Secure frequency; add the pay-later rail.
- **Next:** OLX.pl skill (escrow only); public site-skill registry; record-a-site-once tooling; more knowledge-store adapters.
- **Later:** migrate payments to network-level agent tokens when they reach Polish banks; onboarding for non-technical users; integration with [SpatialCart Protocol](https://github.com/AndriiShramko/SpatialCart-Protocol) (fit-verified furniture orders).

## Contributing and sharing your site skills

Teach the agent a new shop, fix a selector, add a knowledge-store adapter, improve the docs. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first: English only, no secrets or personal data, redaction before sharing, human-verified site skills, DCO sign-off.

## Documentation

- [User guide](docs/user-guide.md) · [Runtime](runtime/README.md) · [Architecture](docs/architecture.md) · [Mandate specification](docs/mandate-spec.md) · [Site-skill specification](docs/site-skill-spec.md)
- [Payments (PSD2, rails)](docs/payments.md) · [Marketplaces](docs/marketplaces.md) · [Anti-bot policy](docs/anti-bot-policy.md) · [Security](docs/security.md) · [Warnings](docs/warnings.md)
- [Landscape](docs/landscape.md) · [Execution stack](docs/execution-stack.md) · [Registry](docs/registry.md) · [Changelog](CHANGELOG.md)

## Part of an ecosystem

Agentic Shopping Autopilot is the execution leg of the [SpatialCart Protocol](https://github.com/AndriiShramko/SpatialCart-Protocol): a room scan becomes a measurable spatial database, an agent verifies that furniture fits, and this project places the order.

## License and citation

Code: [Apache-2.0](LICENSE). Documentation and specifications: CC BY 4.0. Attribution and third-party notices: [`NOTICE`](NOTICE). Cite with [`CITATION.cff`](CITATION.cff).

## Contact and collaboration

- **Author:** Andrii Shramko
- **LinkedIn:** https://www.linkedin.com/in/andrii-shramko/
- **Book a call (calendar):** https://calendar.app.google/Ff729HqGk4RpzPNDA
- **Email:** zmei116@gmail.com
- **GitHub:** https://github.com/AndriiShramko
- **Website:** https://agentic-shopping.flyreelstudio.eu

I am always open to interesting people and conversations, and ready to help teams build ambitious projects — as a partner, a builder, or the person who assembles and leads the team. Marketplaces and shops that want an honest agent lane, banks and payment providers piloting agent credentials, researchers working on agent safety, investors and founders in agentic commerce: get in touch.
