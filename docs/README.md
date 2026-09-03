# Documentation

Specifications and research digests behind Agentic Shopping Autopilot. Docs are licensed CC BY 4.0; code and skills are Apache-2.0 (see the repository [README](../README.md)).

## Recommended reading order

1. [architecture.md](architecture.md) — start here: what is reused, what is built, how the MVP is wired, the project decisions.
2. [mandate-spec.md](mandate-spec.md) — why AI agents refuse to pay and the purchase mandate that resolves it (template: [../examples/PURCHASE_MANDATE.template.md](../examples/PURCHASE_MANDATE.template.md)).
3. [payments.md](payments.md) — what an agent can actually pay with in Poland under PSD2 / SCA.
4. [site-skill-spec.md](site-skill-spec.md) and [registry.md](registry.md) — the skill format and how skills are distributed safely (reference skill: [../skills/allegro.pl/](../skills/allegro.pl/)).
5. [anti-bot-policy.md](anti-bot-policy.md) and [security.md](security.md) — the lines the project never crosses, the threat model and the stop triggers.
6. [marketplaces.md](marketplaces.md), [execution-stack.md](execution-stack.md), [landscape.md](landscape.md) — background research: Allegro/OLX specifics, browser-agent speed, the market map.

## Index

| Doc | What it answers |
|---|---|
| [architecture.md](architecture.md) | Can an AI shopping agent complete checkout and pay by itself on Allegro or OLX, where a human still steps in, what is reused vs built, the MVP roadmap and the first metric to measure. |
| [mandate-spec.md](mandate-spec.md) | Why Claude / Codex refuse to pay, what Anthropic's and OpenAI's policies actually require, and how a pre-signed purchase mandate provides affirmative consent in advance. |
| [payments.md](payments.md) | Every payment instrument an agent could use in Poland (saved card one-click, Allegro Pay, BLIK, virtual cards, Visa / Mastercard agent programmes), why 3DS / SCA challenges are unavoidable, and the MVP payment architecture. |
| [site-skill-spec.md](site-skill-spec.md) | The site-skill format v0.1: `SKILL.md` frontmatter, `selectors.yaml` layered selectors, `flows/`, smoke tests, semver — and how to teach the agent a new site in an evening. |
| [registry.md](registry.md) | Where site-skills live, one-command install into Claude Code and Codex, and the supply-chain security rules for skills that touch money. |
| [anti-bot-policy.md](anti-bot-policy.md) | Why stores block agents, what is changing (signed agents, agent lanes, Amazon v. Perplexity), and the policy: the user's own browser, honest identification, no circumvention. |
| [security.md](security.md) | Threat model: prompt injection from store pages and sellers, OLX scam patterns and the built-in detector, credential and log hygiene, and the stop triggers where the agent must call a human. |
| [marketplaces.md](marketplaces.md) | Allegro.pl and OLX.pl from a buying agent's perspective: buyer-facing APIs, terms, anti-bot stacks, native purchase flows and the channels the MVP uses. |
| [execution-stack.md](execution-stack.md) | Why generic browser agents take 8-20 minutes per purchase and miss, and the layered stack (API search, deterministic recorded checkout, LLM only at branch points) that targets a 1-2 minute repeat purchase. |
| [landscape.md](landscape.md) | The agentic commerce market map as of 2026-08-31 (OpenAI, Google, Visa, Mastercard, PayPal / Perplexity, Amazon, Alibaba, InPost, Allegro, OLX) and the open-source prior art, with evidence levels. |

---
Part of [Agentic Shopping Autopilot](../README.md) by Andrii Shramko — code Apache-2.0, docs CC BY 4.0. Contact and collaboration: see the repository README.
