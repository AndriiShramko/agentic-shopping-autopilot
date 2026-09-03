# Architecture: build-vs-buy decisions and the MVP design

This page condenses the project's research phase (roughly 150 dated sources, consolidated on 2026-08-31; per-topic detail in the docs listed below) into one architecture: what an AI shopping agent can and cannot do autonomously on Polish marketplaces today, which building blocks are reused and which are written from scratch, and how the MVP is wired end to end. It ends with the project decisions that override earlier research conclusions, plus the design decisions and open questions the MVP has to measure.

**Questions this page answers**

- Can an AI shopping agent complete checkout and pay by itself on Allegro or OLX, and where does a human still have to step in?
- Why is a bank 3DS / SCA challenge unavoidable for an autonomous checkout under PSD2, and how does the architecture handle it?
- For an open-source agentic commerce autopilot, what should be reused (MCP servers, browser frameworks, mandate formats, the Agent Skills standard) and what has to be built from scratch?
- What is the MVP roadmap, and what is the first metric to measure before anything else?

## Detailed docs

- [landscape.md](landscape.md) — market map of agentic commerce products and open-source projects; niche check
- [execution-stack.md](execution-stack.md) — browser frameworks, why agents are slow, how to speed them up
- [marketplaces.md](marketplaces.md) — Allegro and OLX: buyer API, terms, anti-bot, flows to script
- [payments.md](payments.md) — payment architecture under PSD2 / SCA; what an agent can actually pay with in Poland
- [mandate-spec.md](mandate-spec.md) — why models refuse to pay and the purchase mandate that resolves it; template in [../examples/PURCHASE_MANDATE.template.md](../examples/PURCHASE_MANDATE.template.md)
- [site-skill-spec.md](site-skill-spec.md) and [registry.md](registry.md) — site-skill format v0.1, distribution, supply-chain rules; reference skill in [../skills/allegro.pl/](../skills/allegro.pl/) (`SKILL.md`, `selectors.yaml`, `flows/`)
- [anti-bot-policy.md](anti-bot-policy.md) and [security.md](security.md) — anti-bot posture, threat model, the seven stop triggers

## The thesis in one paragraph

The niche is **confirmed and empty**: "the user's own agent + shops without an agent checkout protocol + autonomous payment under a mandate" is not covered by the large vendors (the live products are US/CN-centric; OpenAI shut down Instant Checkout in 03.2026 (Digital Commerce 360, 2026-03-06; Forbes, 2026-03-10); ChatGPT agent mode was not generally available in the EEA at the time of research, 2026-08-31) nor by open source (there is no buyer-side autopilot with fiat payment, only reusable building blocks). But the original goal of "100% autonomous payment" runs into **two hard facts** [fact]: (1) PSD2 transaction counters make a periodic 3DS challenge unavoidable; (2) the bottleneck of every competitor is not payment but a reliable pass through checkout (bot detection, CAPTCHA). The realistic architecture is therefore **autonomy in everything except challenges**: the agent does everything itself, and the user receives a push notification for roughly ten seconds only on a 3DS challenge, a CAPTCHA, or a deviation from the mandate. This is consistent with the model vendors' usage policies as the project reads them (Anthropic's policy forbids unauthorized transactions, OpenAI's forbids automating high-stakes decisions without human review; the signed mandate records the user's authorization in advance and the post-purchase report supplies the review — see [mandate-spec.md](mandate-spec.md); both policies are linked in Sources) and technically achievable: 80-95% of purchases with zero human involvement [hypothesis — requires field measurement]. Separately, Allegro's Terms (Regulamin, edition effective 2026-09-01, read 2026-09-03) prohibit the use of bots and other software tools while using Allegro (art. 10.11) and scraping of its data for reuse (art. 10.10), and state that automated solutions are used at the user's own risk (art. 2.8). An AI agent driving the user's own browser may fall under art. 10.11, and Allegro offers no buyer API (a secondary report (xyz.pl, 2025-09-15) covers Allegro's tightened REST API key rules effective 2025-09-23 (max 5 keys, no sharing, a 50,000 PLN contractual penalty); a sentence in that article about a ban on unattended orders describes Shopify's anti-bot strategy, not Allegro's, so it is not used here as evidence about Allegro). The project does not disguise the agent and does not attempt to defeat any platform control; it states what the terms say, defaults to completing payment inside the signed mandate, ships a human-confirm flag, and leaves the decision and the account risk with each account holder (see "Top-5 risks" #1 and Sources).

## Build vs buy matrix

| Layer | Decision | What is used | Rationale (see doc) |
|---|---|---|---|
| Product search | **Buy (reuse) on Allegro; browser on OLX** | Allegro REST API (`/offers/listing`, after application verification) via the MIT-licensed `allegro-open-mcp-server` (268 tools); OLX: search in the user's own logged-in browser session via the OLX site skill (listing pages through URL parameters, human pace, no bulk extraction; see [marketplaces.md](marketplaces.md)). `olx-mcp` (MIT) is prior art, not reused in the MVP, because its data path is a non-public endpoint (open question 7). Browser search on either site reads only what the user's own session displays for that user's single purchase decision; extracting data for reuse is prohibited by Allegro's Terms (art. 10.10, 10.11) and, as reported, by OLX's terms, and browser search carries the same per-account acceptance as risk #1 | execution-stack.md, marketplaces.md, landscape.md: API search is 10-50x faster than DOM traversal; the Allegro building block already exists |
| Browser execution | **Buy + adapt** | Stagehand (MIT; selector cache + self-healing) or browser-use + workflow-use; attached to the user's real Chrome profile (Chrome DevTools MCP) | execution-stack.md, anti-bot-policy.md: the user's own logged-in session is the user's real identity — login, saved payment method and home IP come with it, and the agent never presents itself as anything else; deterministic replay = 1-2 min per repeat purchase |
| Payment | **Buy (bank rails, nothing new)** | Rail 1: the payment method **already saved** in the user's marketplace account — one-click saved card (PayU); Rail 2: Allegro Pay in the same session; bank 3DS/SMS challenge escalates to a push notification. Target rail for 2027: Visa Intelligent Commerce agentic tokens (apply to the pilot now; mBank/PKO/Revolut already in the pilot) | payments.md and project decision 2: no new cards or services; disposable cards are unsuitable (a disposable card cannot be saved in a shop account, so it does not fit one-click rails); the mandate limit is enforced by the agent plus an append-only audit log, not by a card hard-cap |
| Mandate | **Buy the format, implement locally** | Intent / Cart / Payment Mandate structure from AP2 (Apache-2.0, SDK available) as a local `PURCHASE_MANDATE.md` + SHA-256 / GPG + append-only audit log | mandate-spec.md, landscape.md: do not invent a protocol; the document skeleton is in [mandate-spec.md](mandate-spec.md) |
| Skill format | **Buy the standard** | `SKILL.md` (Agent Skills, open standard of 18.12.2025, native in both Claude Code and Codex) as the container: `selectors.yaml` (a11y role -> data attribute -> natural-language fallback), `flows/`, Playwright smoke tests, semver + `last_verified` | site-skill-spec.md: the only cross-vendor format; spec v0.1 in [site-skill-spec.md](site-skill-spec.md) |
| Registry | **Build (thin)** | Public git monorepo compatible with `npx skills add` and Claude Code's `marketplace.json`; a showcase website is phase 2 | registry.md: the "one command into both agents" channel already exists |
| Security | **Build (core of the product)** | Isolation of untrusted content, allowlist of actions and domains, secrets outside the LLM context (OS keychain + proxy keeper), redacted logs, OLX scam detector, seven stop triggers | security.md: the incidents (Comet/Scamlexity, postmark-mcp, ClawHavoc) prove this is the differentiator, not plumbing |
| Reporting | **Build (simple)** | Post-purchase report (item, amount, justification, remaining limit, link) + append-only JSONL log | mandate-spec.md: part of the mandate scheme |

## MVP architecture

```
User (once, ~15 minutes):
  signs PURCHASE_MANDATE.md (limits, categories, marketplaces, expiry, revocation)
  -> relies on a payment method ALREADY saved in the marketplace account
     (one-click saved card via PayU and/or Allegro Pay); no new card step
  -> the agent's browser profile is the user's real, logged-in Chrome profile
        |
Agent (Claude Code / Codex, every purchase):
  reads the mandate (SHA-256 check; MANDATE_REVOKED must be absent)
  -> site skill for Allegro / OLX (SKILL.md from the registry)
  -> SEARCH: Allegro API (seconds); OLX: listing pages in the
     user's own browser session (site skill)
  -> COMPARE and select by the mandate's criteria
  -> CHECKOUT: deterministic recorded flow in the user's real Chrome
     profile (Stagehand cache; the LLM decides only at branch points)
  -> PAY: one-click saved card / Allegro Pay on Allegro; on OLX the
     native escrow flow "Kup z Przesyłką OLX" up to payment, payment
     confirmed by the user in the MVP
  -> 3DS / CAPTCHA / deviation from the mandate -> push to the user (~10 s)
  -> AUDIT LOG + REPORT to the user; delivery tracking
Kill-switch: a MANDATE_REVOKED file (plus, out of band, freezing the
saved payment method in the bank app).
```

The agent itself presses the pay button on Allegro inside the mandate; on OLX the MVP expects the user's own confirmation at the payment step of the native escrow flow (project decision 2, iv). A "human confirms payment" mode exists only as an optional configuration flag, not as the default.

## Implementation status (2026-09-04)

The MVP runtime is implemented in [`../runtime/`](../runtime/README.md) as a step-wise CLI (`asa`) in Node 20 + TypeScript + Playwright. Two deliberate deviations from the build-vs-buy matrix above, both project decisions of 2026-09-03: (1) the browser execution layer is Playwright attached over the Chrome DevTools Protocol to a dedicated, headed Chrome profile on the user's machine (plus the Claude in Chrome extension in the user's own Chrome for flow recording and branch decisions) — Stagehand, browser-use and any separate LLM API key are not used, because the operator session (Claude Code or Codex) is already the LLM at branch points and the selector cache with self-healing is a few hundred lines of the project's own code; (2) the Allegro search channel is implemented from the public endpoint schema (`GET /offers/listing`, OAuth2 device flow) rather than by installing `allegro-open-mcp-server`. Everything else — the mandate format and SHA-256 pinning, the append-only redacted audit log, the domain allowlist with the 3DS hand-off, the saved-method-only payment rails, the stop triggers — is implemented as described on this page. Field observation recorded on 2026-09-04 from the maintainer's own logged-in profile: Allegro listing pages now group offers into product cards (`/produkt/<uuid>`) that show the price with the cheapest delivery ("z dostawą"); the runtime uses that figure as the mandate ceiling and reads the concrete offer id from the product page.

## Not in the MVP

- Anti-detect browsers, proxies, CAPTCHA bypass — out of scope permanently (see [anti-bot-policy.md](anti-bot-policy.md))
- AP2 as a network protocol — only its mandate format is used
- x402 / stablecoins — zero presence in Polish retail [fact]
- Chat-based negotiation on OLX without human escalation
- Mass-market user onboarding
- A showcase website for the registry
- Stripe Issuing — deferred to a future business-account (JDG) variant
- Purchases above 130 zł without readiness for a bank challenge

## Roadmap

- **MVP (4-6 weeks, one developer with AI agents):** Allegro site skill (API search + recorded checkout flow) -> payment rail A (existing saved card one-click / Allegro Pay) -> mandate + audit + report -> field measurement of 3DS/SMS challenge frequency (the key metric) -> OLX site skill (transactional flow, no chat) -> 20 real end-to-end purchases.
- **v1 (registry + community):** skills monorepo + install CLI + smoke CI + a Healer agent (repairs selectors, opens PRs) + registry security checklist (PR scanning, sandbox, two approvals for money-touching skills) + `skill record` ("a new site in an evening").
- **v2 (mass user + SpatialCart):** migration to Visa Intelligent Commerce agentic tokens at GA (mBank/PKO/Revolut; 2027 horizon) -> GUI mandate onboarding for non-technical users -> integration with SpatialCart Protocol (fit-verified furniture -> automatic purchase; linked from the repository README) -> OLX chat module.

## Top-5 risks and mitigations

1. **Marketplace account or Allegro Pay restriction.** Allegro's Terms (Regulamin, edition effective 2026-09-01, read 2026-09-03; see Sources) prohibit the use of bots and other software tools while using Allegro (art. 10.11) and scraping of its data for reuse (art. 10.10), state that automated solutions are used at the user's own risk (art. 2.8), and let Allegro deploy mechanisms that block such tools (art. 8). An AI agent driving the user's own browser may fall under art. 10.11, and Allegro gives no buyer API (a secondary report (xyz.pl, 2025-09-15) covers Allegro's tightened REST API key rules effective 2025-09-23 (max 5 keys, no sharing, a 50,000 PLN contractual penalty); a sentence in that article about a ban on unattended orders describes Shopify's anti-bot strategy, not Allegro's, so it is not used here as evidence about Allegro); Allegro uses DataDome, so agent traffic is subject to its challenges. OLX's terms likewise prohibit automated data extraction and block accounts for atypical activity ([marketplaces.md](marketplaces.md)); the same per-account acceptance applies. The project does not disguise the agent and does not attempt to defeat any platform control. The project default completes payment inside the mandate; an optional human-confirm flag exists; each account holder decides and accepts this risk for their own account. Hygiene, not evasion: the agent runs only in the user's own logged-in Chrome, one action at a time, at the volume a single person would generate; nothing is tuned to a detection threshold, and any challenge stops the run and is handed to the user ([anti-bot-policy.md](anti-bot-policy.md)). Watch for an official Allegro agent lane (Allegro has an app in ChatGPT since 05.2026 — selection in chat, checkout still on allegro.pl; Allegro Media).
2. **3DS challenges more frequent than expected**, turning "autonomy" into ping-pong. Mitigation: field measurement in the first week decides the default rail once; mandate caps stay whatever the shopping goal requires and are never lowered to dodge a challenge; the agent never selects a rail per transaction, never retries a challenged payment on another rail, and never splits an order; a challenge is always completed by the user.
3. **Prompt injection / scams on OLX** (in Guardio Labs' published "Scamlexity" test, 08.2025, Comet completed a purchase on a fake shop without confirmation). Mitigation: content isolation, domain allowlist, payment only inside the native escrow, seven stop triggers, secrets outside the LLM context.
4. **A 12-24 month niche window** (UCP (Google's Universal Commerce Protocol) and Visa will come to Europe; Allegro may open its own agent channel). Mitigation: build AP2-compatible, apply to the Visa pilot now, position as "the layer for everything that has no agent lane" — thousands of such sites will remain.
5. **Malicious skills in the registry** (ClawHavoc precedent: 341 items). Mitigation: payment data is injected by the runtime, never by a skill; scanning + sandbox + signatures + version pinning from day one.

## Project decisions (2026-08-31)

Where the research notes differ, this page is authoritative.

1. **Marketplace terms — the risk is accepted per account, not engineered around.** Allegro's Terms (Regulamin, edition effective 2026-09-01, read 2026-09-03; see Sources) prohibit the use of bots and other software tools while using Allegro (art. 10.11) and scraping of its data for reuse (art. 10.10), and state that automated solutions are used at the user's own risk (art. 2.8). An AI agent driving the user's own browser may fall under art. 10.11, and Allegro gives no buyer API (a secondary report (xyz.pl, 2025-09-15) covers Allegro's tightened REST API key rules effective 2025-09-23 (max 5 keys, no sharing, a 50,000 PLN contractual penalty); a sentence in that article about a ban on unattended orders describes Shopify's anti-bot strategy, not Allegro's, so it is not used here as evidence about Allegro). The project states what the terms say, does not disguise the agent and does not attempt to defeat any platform control; its default mode has the agent complete the payment inside the mandate; a human-confirm option exists as a config flag; each account holder decides and accepts the risk for their own account. The mitigations (the user's own logged-in profile, one action at a time, personal volume) stay as hygiene, not as a brake. The mandate already carries the user's affirmative consent; a second confirmation adds friction without adding authority, so it is offered as a flag rather than imposed as the default.
2. **Payment rails = the user's existing saved methods.** No new cards, no new services: the MVP pays with (a) the card already saved in the marketplace account (one-click via PayU) and/or (b) Allegro Pay. Virtual or disposable cards from other providers are not the recommendation; other users may still choose them. Consequences, stated honestly: (i) there is no per-card hard-cap, so the mandate limit is enforced only by the agent plus the append-only audit log (softer; accepted); (ii) one-time BLIK codes are physically incompatible with autonomy — a human generates the code in the bank app — so the agent uses a saved card or Allegro Pay instead; (iii) a bank 3DS/SMS challenge cannot be removed under PSD2 — the agent sends a push ("confirm in your bank app", ~10 s), which is the only remaining human step; (iv) OLX has no saved-method rail: the agent runs the native "Kup z Przesyłką OLX" escrow flow up to the payment step, and in the MVP the payment itself is expected to involve the user's own confirmation.
3. **The first MVP metric becomes more important, not less:** the field-measured frequency of bank challenges on the saved card / Allegro Pay at small amounts. It determines the real share of purchases with zero human involvement.

## Ten design decisions

1. **Autonomy = everything except challenges**, not 100%: PSD2 makes this a law of physics rather than a compromise; sell it as a safety feature.
2. **Mandate in the AP2 Intent Mandate format**, stored locally, with SHA-256 and a kill-switch — do not invent a protocol; take the skeleton from [mandate-spec.md](mandate-spec.md) as is.
3. **Checkout only in the user's real Chrome profile on the user's machine** — at once the honest-identity answer (the agent acts as the user, from the user's machine), the login and the saved payment method.
4. **Layered speed:** API search -> deterministic replay -> LLM only at branch points; target 4-6 min for a cold run, 1-2 min for a repeat purchase.
5. **MVP payment rail: the existing saved methods** (one-click saved card and/or Allegro Pay) — and measure the challenge frequency first, as the project's first metric.
6. **Skill format = `SKILL.md` (Agent Skills)** with `selectors.yaml` and smoke tests — the only standard that lives in both Claude Code and Codex.
7. **Reuse the building blocks:** `allegro-open-mcp-server` + Stagehand (`olx-mcp` is prior art only: its data path is a non-public endpoint, so the OLX skill searches in the user's own browser session instead); write to the maintainer of northcinder (an ideological twin: local-first, mandate per deal; 1.2k stars in two weeks, see [landscape.md](landscape.md)) about joining efforts rather than duplicating it.
8. **Registry = git monorepo + `npx skills add`** with a security checklist from day one; invariant: a skill never sees payment data.
9. **Apply to the Visa Intelligent Commerce pilot now** (developer.visaacceptance.com; pilot, access by application through a Visa representative) — mBank/PKO/Revolut are already in the pilot; this is the target rail for 2027.
10. **OLX in the MVP = only "Kup z Przesyłką OLX"** (escrow, no chat); chat negotiation is v2 with human escalation; anything outside the native checkout is forbidden, not merely risky.

Cross-cutting rules that hold across all ten: never bypass anti-bot, CAPTCHA or 3DS — no fingerprint spoofing, proxies, anti-detect browsers or headless farms; honest agent identification (Web Bot Auth) where accepted. Secrets (card data, cookies, OTP codes) never enter the LLM context, git or logs — OS keychain and the browser profile only; reports are redacted (see [security.md](security.md)).

## Ten open questions to measure in the MVP

1. **Real 3DS/SMS challenge frequency** on one-click Allegro with the saved card and on Allegro Pay at amounts below 130 zł — [hypothesis: 5-20%]; measure on 20+ purchases.
2. Will Allegro grant **application verification** for `GET /offers/listing` for a shopping-agent use case, and what happens if the project asks them directly about an agent-friendly channel?
3. **Challenge frequency in a normal logged-in session:** how many purchases per day complete without a CAPTCHA or verification prompt at human pace, one action at a time, one account — [hypothesis: personal volumes rarely see one]. The project does not tune to detectability: any challenge is a stop condition handed to the user; the agent never retries, rotates, or changes pace to avoid one (see [anti-bot-policy.md](anti-bot-policy.md)).
4. Does a **purchase mandate in context** remove the refusals of Claude / Codex at the payment step? Run the matrix of mandate wordings x models (the central hypothesis of the mandate research).
5. **Allegro Pay in an agent session:** how often does risk scoring demand an SMS, and does it flag an "atypical" device or behavior?
6. Does **one-click BLIK on a trusted device** work under an agent? One-time BLIK codes are out by design (a human generates the code); the trusted-device variant depends on the bank's velocity rules and needs empirical data.
7. **OLX search channel.** The MVP searches OLX through listing pages in the user's own browser session (site skill), which carries the same per-account acceptance as risk #1. The non-public JSON interface that `olx-mcp` relies on is not used; it is to be evaluated only after an OLX terms review.
8. **Quality of recording-to-skill generalization:** is "a site in an evening" real via Playwright codegen -> LLM -> smoke test? Try on 2-3 small Polish shops.
9. **Allegro's response to honest identification:** will DataDome admit an agent with a Web Bot Auth signature? The standard exists; Allegro's acceptance is not announced.
10. **Legal assessment for PL/EU:** the US line of cases on terms-of-service breaches (CFAA; Amazon v. Perplexity) does not transfer to Poland; what a user actually faces under Polish law — account closure, cancelled orders, civil liability — needs a Polish legal opinion.

## Sources

The consolidated research behind this page draws on roughly 150 dated sources; the per-topic source lists live in the detailed docs linked at the top of this page. Sources for the named-company facts stated on this page (links reused from the detailed docs; accessed 2026-08-31 unless dated otherwise):

- Allegro Terms (Regulamin), primary text: https://allegro.pl/regulamin — edition effective 2026-09-01 (header "Obowiązuje od 1 września 2026 r."), read in a logged-in Chrome session on 2026-09-03: art. 2.8 (automated solutions, in particular login-triggering software, are used at the user's own risk), art. 10.10 b.i (extraction / scraping of Allegro data, in particular with bots, for reuse in one's own business or in other services), art. 10.11 (bots and other software tools while using, in connection with using, or in order to use Allegro; the listed tool types are examples), art. 8 (Allegro may apply mechanisms blocking such tools). Secondary reports: XYZ (xyz.pl, Polish tech-news site) https://xyz.pl/allegro-wprowadza-cicha-rewolucje-ktora-uderzy-w-konkurentow-i-ai-zidentyfikowalismy-wiele-naduzyc/ (2025-09-15) ; upselli.pl https://upselli.pl/blog/zmiany-regulamin-allegro-kwiecien-2026 (April 2026 changes). The "orders without human participation" wording comes from such secondary reports; no clause with that wording, no "clause 4.1.e" on scraping and no "art. 14.1" on this topic exist in the primary text, so this page does not attribute them to the Regulamin
- DataDome on Allegro: https://datadome.co/customers-stories/from-awareness-to-resilience-allegros-journey-with-datadome-against-bots/
- Allegro app in ChatGPT (05.2026): https://media.allegro.pl/457629-allegro-uruchamia-apke-na-chatgpt-i-tworzy-nowy-standard-w-konwersacyjnym-e-commerceie
- OpenAI Instant Checkout shutdown (03.2026): https://www.digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/ (2026-03-06) ; https://www.forbes.com/sites/jasongoldberg/2026/03/10/why-openais-checkout-retreat-spells-trouble-for-its-commerce-strategy/ (2026-03-10)
- ChatGPT agent availability in the EEA: https://help.openai.com/en/articles/11752874-chatgpt-agent ; https://www.euronews.com/next/2025/01/24/openai-launches-first-ai-agent-operator-but-it-wont-be-coming-to-europe-yet (2025-01-24)
- Model vendor usage policies: Anthropic https://www.anthropic.com/legal/aup ; OpenAI https://openai.com/policies/usage-policies/ (edition of 2025-10-29); the project's reading is in [mandate-spec.md](mandate-spec.md)
- Visa Intelligent Commerce pilot (07.2026): developer.visaacceptance.com (pilot; access by application through a Visa representative) ; mBank press release (pl.media.mbank.pl, 07.2026) and the Visa "Agent Ready" bank list (visa.co.uk, 07.2026), as recorded in [payments.md](payments.md)
- Guardio Labs "Scamlexity" test of Comet (08.2025): https://www.bleepingcomputer.com/news/security/perplexitys-comet-ai-browser-tricked-into-buying-fake-items-online/ ; https://hackmag.com/news/scamlexity
- ClawHub / ClawHavoc (2026-02): https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/ ; https://www.esecurityplanet.com/threats/hundreds-of-malicious-skills-found-in-openclaws-clawhub/
- postmark-mcp (2025-09): https://www.koi.ai/blog/postmark-mcp-npm-malicious-backdoor-email-theft ; https://snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails/
- northcinder: https://github.com/cinderline/northcinder (1,218 stars, created 2026-08-17, read via the GitHub API on 2026-08-31; see [landscape.md](landscape.md))
- Open-source building blocks referenced by name: `allegro-open-mcp-server` (MIT), `olx-mcp` (MIT; prior art, not reused in the MVP), Stagehand (MIT), browser-use / workflow-use, AP2 (Apache-2.0), Agent Skills `SKILL.md` standard (18.12.2025)

---
Part of [Agentic Shopping Autopilot](../README.md) by Andrii Shramko — code Apache-2.0, docs CC BY 4.0. Contact and collaboration: see the repository README.
