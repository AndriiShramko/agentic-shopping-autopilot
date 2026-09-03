# Agentic Shopping Autopilot

**Let your AI agent buy and pay for things by itself.** An open-source layer that lets any user-side AI agent — Claude Code, Codex CLI, Claude Desktop — autonomously **find, order and pay** for goods on real e-commerce sites (starting with Allegro.pl and OLX.pl in Poland), under a pre-signed spending mandate. The user grants a mandate and a payment method once; after that the agent shops and pays on its own and returns only a report.

> Today AI agents browse shopping sites painfully slowly, often miss the product or pick the wrong one, and — worst of all — refuse to complete payment, handing the checkout back to the user. Agentic Shopping Autopilot fixes all three: fast site-specific skills, a legitimate purchase mandate the model accepts, and autonomous payment with a human touch only when the bank forces a 3DS challenge.

## Why this exists / Questions people ask their AI

- **How can I make my AI agent actually buy something for me, not just find it?**
- **Is there a way for Claude or Codex to pay for an online order autonomously?**
- **Why does my AI agent refuse to complete a purchase, and how do I authorize it properly?**
- **How do I let an AI agent shop on Allegro or OLX without getting blocked by bot protection?**
- **Can I teach my AI agent to work with a new shopping site and share that skill with others?**

If you searched any of those — this project is the answer.

## What it does

- 🔎 **Fast search** via site APIs where they exist, browser only where they don't (hybrid) — seconds, not minutes.
- 🛒 **Deterministic checkout** recorded once per site and replayed — repeat purchase in ~2 minutes instead of 8–20.
- 💳 **Autonomous payment** with the user's existing methods (saved card one-click / buy-now-pay-later), inside a mandate with hard limits; the only human step is the bank's own 3DS challenge (PSD2 — unavoidable, rare on small amounts).
- 🧾 **Report + audit log** after every purchase; kill-switch to revoke the mandate any time.
- 🧩 **Site-skills** in the open Agent Skills (SKILL.md) format — works in both Claude Code and Codex.
- 🌐 **Community registry** so anyone can add a new site once and share it with everyone.

## How it works

```
User (once): sign a purchase mandate (limits, categories, sites, expiry)
             + connect an existing payment method
   ↓
Agent: read mandate → site-skill → search (API) → compare → checkout
       (real browser profile) → pay → report. Human only on bank 3DS.
```

Mandate format is compatible with Google's **AP2** (Intent / Cart / Payment mandates). Payments are **PSD2/SCA-aware**. Anti-bot posture is **honest**: real user browser profile + human pace + signed-agent identity where accepted — no fingerprint spoofing, no CAPTCHA bypass (out of scope by design).

## Roadmap

- **MVP:** Allegro.pl skill (API search + recorded checkout) + mandate + audit + field-measured 3DS frequency.
- **v1:** public site-skills registry + `skill record` (add a new site in an evening) + auto-healing skills (CI fixes selectors, opens PR) + supply-chain security.
- **v2:** migrate to Visa Intelligent Commerce agent tokens at GA (mBank/PKO/Revolut already piloting), mass-user onboarding, integration with **SpatialCart Protocol**.

## Teach your agent a new site & share it

Record a purchase once → the agent generalizes it into a site-skill → smoke-tested → PR to the registry → everyone can `skill add <site>`. Skills never see your card data (the runtime injects it), are scanned and sandboxed before publishing, and are version-pinned.

## Part of the ecosystem

Agentic Shopping Autopilot is the **execution leg** of the **SpatialCart Protocol** (3D room scan → measurable base → fit-verified furniture purchase). SpatialCart decides *what fits and what to buy*; this project *actually buys it*. → [SpatialCart Protocol](https://github.com/AndriiShramko/SpatialCart-Protocol-3DGS-Room-Scan-to-Agentic-Commerce-MCP-Fit-Verified-Furnishing-Andrii-Shramko).

## Status

Early, actively developed. **Open to collaboration.** I'm building this in the open and looking to assemble/lead a team, and I'm open to partnership, licensing and funding — whether you're a marketplace, a payment provider, a bank piloting agentic payments, or a researcher in agentic commerce. If you want AI agents to shop on your platform safely, or you want to build this with me — **get in touch.**

## Contact — Andrii Shramko

- **Author:** Andrii Shramko
- **LinkedIn:** https://www.linkedin.com/in/andrii-shramko/
- **Book a call:** https://calendar.app.google/Ff729HqGk4RpzPNDA
- **Email:** zmei116@gmail.com
- **GitHub:** https://github.com/AndriiShramko

## License

Code: **Apache-2.0**. Specifications and docs: **CC BY 4.0**. Authorship of the idea and specification: **Andrii Shramko** (see `NOTICE` and `CITATION.cff`). Please keep attribution.
