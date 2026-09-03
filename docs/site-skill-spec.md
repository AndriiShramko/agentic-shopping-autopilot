# Site-skill format specification v0.1 (SKILL.md + selectors.yaml + flows + smoke tests)

A *site skill* is the unit in which Agentic Shopping Autopilot packages everything an AI shopping agent needs to know about one marketplace: how to search, read a product page, fill the cart, run an autonomous checkout in which the AI agent pays inside a purchase mandate, and track the order. This page compares the packaging formats available in 2026, fixes the v0.1 folder layout and schemas, and describes how a new site is taught ("record a purchase, generalize, smoke test, PR"). The reference implementation is [`../skills/allegro.pl/`](../skills/allegro.pl/).

## Questions this page answers

- How do I package knowledge about a shop such as Allegro or OLX so that an AI shopping agent running in Claude Code or Codex can use it?
- Which format should a site skill use: SKILL.md (Agent Skills), an MCP server, AGENTS.md, agents.json, llms.txt or a recorded Playwright script?
- How does a site skill survive a site redesign, and when is a skill considered stale?
- How do I teach the autopilot a new marketplace and contribute it as a pull request?

**Evidence tags.** Claims are marked as [fact] (confirmed by a cited source), [vendor claim] (stated by the tool's maker, not independently verified), [reported] (taken from secondary reports; the primary source was not fetched) or [hypothesis] (the project's own design or conclusion, still to be validated). Sources and access dates are listed at the end.

## 1. Comparison of packaging formats

Context for 2026: Agent Skills (SKILL.md) became an open, cross-vendor standard. Anthropic published the specification as an open standard on 18 December 2025 (agentskills.io); support is declared by 46 platforms listed in the client showcase at https://agentskills.io (accessed 2026-09-03), including Claude Code, OpenAI Codex, GitHub Copilot, Cursor, Gemini CLI and VS Code [fact: agentskills.io]. Codex CLI loads skills from `~/.agents/skills/` (and from `.agents/skills` inside the repository) and names the open Agent Skills standard as its basis [fact: OpenAI Codex skills documentation]; the December 2025 start date is reported by itecsonline.com [reported]. This removes the main historical risk of the format: vendor lock-in on a single agent.

| Format | Works in Claude AND Codex | Versioning | Testability | Degradation on site redesign | Comment |
|---|---|---|---|---|---|
| **SKILL.md (Agent Skills)** | Yes, both (open standard, 46 platforms listed at agentskills.io) [fact] | Excellent: a folder in git, semver in frontmatter | Medium: the .md itself is not executable, but `scripts/` and tests live in the same folder, so the bundle is testable | Soft: natural-language instructions plus semantic selectors; the agent improvises when the page diverges | Best container: can hold selectors, scripts and recorded flows inside |
| **MCP server per site** | Yes, both (Claude natively; Codex supports MCP) [fact] | Code in git/npm, but a heavier release cycle | High: ordinary code, unit and e2e tests | Medium: deterministic code breaks silently and is fixed only by a release | Overkill as a per-shop format: N shops = N server processes; appropriate as a shared *runtime* (one browser/checkout MCP for all skills) |
| **AGENTS.md** | Codex native; Claude Code via a one-line `@AGENTS.md` import in CLAUDE.md [fact: Claude Code memory docs, CLAUDE.md imports] | git | Low: pure prose, nothing to run | Soft (same nature as SKILL.md) | A format for repository rules, not for packaging knowledge about a third-party site; no metadata, triggers or scripts. Lost to SKILL.md as the unit of distribution |
| **agents.json (Wildcard)** | Neither natively; needs an interpreter | JSON in git, strict schema (v0.1.0 on top of OpenAPI) [fact] | High: declarative contracts are validatable | Not applicable to browser flows: describes APIs only; if the shop has no public API the file is empty | Niche; useful as a *section* of a skill for sites with an API. The ecosystem stayed small [hypothesis, from the absence of wide-adoption traces] |
| **llms.txt** | Formally readable by any agent, but crawlers rarely request it | text | none | not applicable | Not a working channel: Google has reportedly ignored it since June 2026, and an Ahrefs study is reported to have found that 97% of llms.txt files have zero traffic and no correlation with citations [hypothesis; based on secondary reports (1clickreport.com, digitalapplied.com), the primary Google statement and Ahrefs study were not fetched]. At most an input for *auto-generating* a skill |
| **Recorded Playwright flow** (codegen / saved script) | Yes, both, as an executable artifact the agent runs from the shell | git | Excellent: it is the test | Hard: CSS/XPath selectors break first; silent false successes | Irreplaceable as a **smoke test** and as raw material for teaching; poor as the only carrier of knowledge |
| **Stagehand script** (act/extract/observe + cache) | A library callable from any agent via Node/Python; a runtime rather than a format | git | Good | Best among executable options: the resolved selector is cached, validated against the live page before execution, with LLM fallback on a miss; up to ~80% faster on repeat runs [vendor claim] | Ideal **executable layer inside** a skill: natural-language actions plus a selector cache = self-documenting and fast |
| **WebMCP** (the site publishes tools via `document.modelContext`) | Future: W3C Community Group Draft (Google and Microsoft); OpenAI + Chrome hackathon 25 Aug - 3 Sep 2026 [fact] | not yet | not yet | Zero (the site maintains the contract itself) | A skill must be able to **prefer** WebMCP or an API whenever the site offers them |

**Conclusion of the comparison** [hypothesis, high confidence]: no single format solves the problem. The optimum is a **composite**: SKILL.md as the standard container and "brain" (works in Claude Code and Codex out of the box), and inside it a machine-readable map of selectors and endpoints (YAML/JSON), Stagehand-like executable flows with a selector cache, and Playwright smoke tests. AGENTS.md and llms.txt are not carriers; agents.json and WebMCP are optional sections for the API channel.

## 2. Site-skill specification v0.1

[hypothesis, project design] A skill is a folder `skills/<domain>/` compatible with the Agent Skills standard:

```
skills/allegro.pl/
├── SKILL.md              # container: frontmatter + instructions for the agent
├── site.yaml             # machine-readable map of the marketplace
├── flows/                # step-by-step flows (markdown + executable steps)
│   ├── search.md
│   ├── product-page.md
│   ├── cart.md
│   ├── checkout.md
│   └── tracking.md
├── selectors.yaml        # selector map (semantic-first)
├── endpoints.yaml        # API endpoints if any (agents.json / OpenAPI subset)
├── scripts/
│   ├── smoke_search.spec.ts     # Playwright smoke tests (read-only)
│   ├── smoke_cart.spec.ts       # up to checkout, with cart cleanup
│   └── helpers.ts
└── CHANGELOG.md
```

The reference implementation in [`../skills/allegro.pl/`](../skills/allegro.pl/) currently ships the core subset: `SKILL.md`, `selectors.yaml` (with an `endpoints` section inside it), the five `flows/*.md` and `scripts/smoke_search.spec.ts`. The CSS layer of its selectors is filled in by the first recorded flow (see section 3).

### SKILL.md frontmatter (schema draft)

Values below are illustrative; the shipped allegro.pl skill has `version: 0.1.0` and `last_verified: null` until its first green smoke run.

```yaml
---
name: allegro-pl-shopping
description: "Buy goods on Allegro.pl: search, filters, cart, checkout, tracking. Use when buying on allegro.pl."
version: 0.1.0                  # semver: MAJOR = flow/UI change, MINOR = new flows, PATCH = selector fixes
metadata:
  site: allegro.pl
  regions: [PL]
  currencies: [PLN]
  languages: [pl, en]
  channel:                      # channel priority, top to bottom
    - {type: api, auth: oauth2, coverage: [search, bidding]}   # only if a public API exists; Allegro exposes no order-placement API for buyers, checkout is browser-only
    - {type: browser, engine: playwright, login: required}
  auth: {method: user-session, storage: local-profile, mfa: sms-possible}
  payment:
    methods: [card-on-file-oneclick, allegro-pay, blik-single-code]
    agent_allowed: [card-on-file-oneclick, allegro-pay]   # the user's existing saved methods only
    forbidden: [blik-single-code]                          # a human has to generate the one-time code
    escalation: "bank 3DS/SMS challenge -> notify the user and wait"
  anti_bot: {level: high, vendor: DataDome, on_challenge: "stop and escalate to the user; never retry, never bypass"}
  usage_policy: {profile: user-own-chrome, volume: "personal use, a few purchases per day", accounts: 1}
  terms: "what the marketplace terms say about bots, software tools and automated ordering"   # free text; cite article numbers; end with the edition and review dates (ISO 8601)
  mandate: required             # full purchase-mandate checklist before the pay button
  last_verified: null           # ISO 8601 date of the last green smoke run; null until the first one
  verified_by: ci|human
  maintainers: ["@AndriiShramko"]
  risk_tier: money              # money | account | read-only; sets review strictness in the registry
---
```

Field notes:

- `name` and `description` follow the Agent Skills standard; the description is the trigger text an agent matches against the user's request.
- `channel` is ordered: the agent prefers an API or WebMCP channel when the site offers one and falls back to the browser.
- `payment` reflects the project decision for the MVP: the agent pays only with payment methods the user has **already saved** in the marketplace account (one-click saved card via PayU, Allegro Pay). One-time BLIK codes are listed as forbidden because they are physically incompatible with autonomy: a human generates the code. The mandate limit is enforced by the agent and an append-only audit log, not by a card cap (see [payments.md](payments.md) and [mandate-spec.md](mandate-spec.md)).
- `usage_policy` describes personal-use volumes and an account-holder-operated profile (terms-risk hygiene, see [anti-bot-policy.md](anti-bot-policy.md)). "Human pace" means acting one action at a time, no parallel sessions, no request bursts and personal, not commercial, volumes; the agent does not simulate human input patterns and does not tune its behaviour to defeat detection. `anti_bot` holds only the challenge policy (`on_challenge`).
- `terms` records what the marketplace terms say, not a legal opinion. For Allegro: Allegro's Terms (Regulamin, edition effective 2026-09-01, read 2026-09-03) prohibit the use of bots and other software tools while using Allegro, in connection with using it or in order to use it (art. 10.11; the tool types listed there, such as traffic-generating tools, malware and attack tools, are examples, not the whole scope), prohibit the extraction (scraping) of Allegro data for reuse in one's own business or in other services (art. 10.10), state that automated solutions, in particular login-triggering software, are used at the user's own risk (art. 2.8), and let Allegro apply mechanisms that block such tools (art. 8) [fact: allegro.pl/regulamin, main text read in a logged-in browser session on 2026-09-03; attachments not checked]. Secondary reports describe this as a ban on automated ordering [reported: xyz.pl, 2025-09-15]; the primary text has no clause worded that way. Allegro offers no API for placing orders as a buyer. An AI agent driving the user's own browser may fall under art. 10.11. The project does not disguise the agent and does not attempt to defeat any platform control; its default completes payment inside the mandate; an optional human-confirm flag exists; each account holder decides and accepts the risk for their own account, with hygiene mitigations (a real logged-in Chrome profile, human pace as defined under `usage_policy` above, a few purchases per day, one account per marketplace: a separate test account only where the site permits automated testing). See [anti-bot-policy.md](anti-bot-policy.md) and [marketplaces.md](marketplaces.md).
- `risk_tier: money` makes the skill subject to the strictest review in the registry (see [registry.md](registry.md)).

### selectors.yaml: layered degradation

Selectors are resolved semantic-first, in three layers; a step that fails at one layer falls through to the next.

```yaml
search_input:
  role: {role: combobox, name: "Czego szukasz?"}   # layer 1: a11y role + accessible name (survives redesigns)
  css: "[data-role='search-input']"                # layer 2: data attribute / CSS
  fallback_nl: "the search box in the page header" # layer 3: natural-language description for act()-style resolution
add_to_cart:
  role: {role: button, name: "Dodaj do koszyka"}
  css: "button[data-analytics-click='add-to-cart']"
  fallback_nl: "the main add-to-cart button on the product page"
```

Rationale: Playwright MCP and Playwright Agents work from the accessibility tree rather than from screenshots, which makes role selectors the canonical, redesign-resistant layer [fact]. Flows reference selector ids (`add_to_cart`), never raw selectors, so a selector fix is a one-file PATCH.

### flows/*.md: step format

Every flow has the same skeleton: **preconditions -> steps (referencing selector ids) -> a verifiable postcondition invariant -> edge cases**.

```markdown
# flow: checkout
## Preconditions
- a valid purchase mandate is loaded; the cart contains only the approved items
## Steps
1. cart -> `cart_go_checkout`
2. delivery -> `delivery_option` (the option named in the mandate)
3. payment -> `payment_oneclick_card` or `payment_allegro_pay`
4. mandate gate: total, seller, delivery and item match the mandate -> `pay_button`
## Postcondition
- an order confirmation with an order id is visible; the total equals the mandate-approved total
## Edge cases
- item out of stock after add-to-cart: abort, report to the user (full list under "Mandatory edge cases" below)
```

Required flows:

| Flow | Covers |
|---|---|
| `search` | query -> filters -> sorting |
| `product-page` | variants (size/colour), availability, price, delivery |
| `cart` | add, remove, cart cleanup |
| `checkout` | address -> delivery -> payment -> **mandate gate** -> pay |
| `tracking` | order status, shipment number |

**Project decision on the checkout gate.** Autonomy means everything except challenges: the agent itself completes checkout and presses the pay button as long as the purchase is inside the mandate. The gate before the pay button is therefore a full mandate checklist (see [../examples/PURCHASE_MANDATE.template.md](../examples/PURCHASE_MANDATE.template.md)), not a human stop. A human is involved for the bank's own 3DS/SMS challenge (Strong Customer Authentication under PSD2, which the project treats as a feature, not an obstacle), for any CAPTCHA or anti-bot challenge, and for any deviation from the mandate. A "human confirms payment" mode is available as a config flag for users, or marketplaces, that require a human step before payment; the project default is autonomous completion inside the mandate, and each user accepts that choice for their own account (see the `terms` field note above and [anti-bot-policy.md](anti-bot-policy.md)).

Mandatory edge cases in every skill:

- item out of stock or withdrawn from sale: what the agent sees and what it does;
- variants: a mandatory size/colour choice before add-to-cart;
- free-delivery threshold; delivery unavailable in the region;
- pop-ups: cookie consent, newsletter, "add purchase protection";
- CAPTCHA / anti-bot: the skill must declare where it appears and prescribe escalation to a human, never a bypass. Legal background: Amazon's complaint against Perplexity alleged that its Comet agent accessed Amazon without identifying itself as an automated agent; a preliminary injunction (March 2026) was later overturned on appeal by the Ninth Circuit [fact: CNBC, Engadget] (details in [anti-bot-policy.md](anti-bot-policy.md)). Whatever the final outcome, the terms-of-service risk for unidentified agents is real [hypothesis]. The project never bypasses anti-bot, CAPTCHA or 3DS and uses no fingerprint spoofing, proxies, anti-detect browsers or headless farms; it identifies the agent honestly (Web Bot Auth) where the site accepts it (see [anti-bot-policy.md](anti-bot-policy.md)).

A skill may cover a deliberate subset of a marketplace. Project decision for OLX in the MVP: only the native escrow flow "Kup z Przesyłką OLX"; no chat or negotiation module (that is v2, with human escalation). See [marketplaces.md](marketplaces.md).

### Smoke tests (read-only, never pay)

| Test | What it checks | Hard rule |
|---|---|---|
| `smoke_search` | search returns at least N results, a product page opens, the price parses | read-only; scheduled only where the site permits automated testing, otherwise part of a maintainer's personal-use verification |
| `smoke_cart` | add and remove a cheap "canary" item | no checkout; the cart is cleaned up |
| `smoke_checkout_dry` | reaches the payment screen and **stops** | never pays in CI |

Every green run updates `last_verified`; a red run opens an issue and starts the healer (see section 3). Smoke runs follow the anti-bot policy (a real browser, no proxies or anti-detect tooling, any challenge = stop, never a retry) and the `usage_policy` volumes (personal use). Their frequency is set by the verification need described in section 3, not by the site's detection behaviour. Secrets (card data, cookies, OTP codes) never enter the LLM context, git or logs; test reports are redacted (see [security.md](security.md)).

### Semver policy and `last_verified` [hypothesis]

- **PATCH**: selector or text fixes. **MINOR**: a new flow or edge case. **MAJOR**: the site changed the structure of a flow (for example a new checkout); the agent must re-read the whole skill.
- `last_verified` older than 14 days: the client warns the user before using the skill; no green run for 60 days: the registry marks the skill `stale` and later archives it (see [registry.md](registry.md)). The underlying research note used 14 days for the stale mark as well; v0.1 deliberately separates the two thresholds: 14 days = client warning, 60 days = registry stale + archive.

## 3. Teaching a new site: record a purchase -> generalize into a skill -> smoke test -> PR

Verdict: the path works, every link in the chain exists as of 2026, and the glue is the project's own work [hypothesis, confirmed piecewise by facts].

1. **Record.** Tooling:
   - `playwright codegen` generates a script from the user's live session (a mature tool) [fact];
   - **browser-use / workflow-use**, "show, don't tell": record a flow, the tool filters out noise and generates a deterministic workflow with variables (it extracts form fields) and an LLM-agent fallback when a step fails; status is early development, "not for production" [fact + vendor claim];
   - **Stagehand cache**: the first agent run resolves natural-language actions into selectors and caches them; the cache is a ready selector map [vendor claim].
2. **Generalize.** An agent (Claude Code or Codex) receives the recording plus DOM / accessibility snapshots and generates `selectors.yaml` (role-first), `flows/*.md` and the parameterization (query, address and payment method become variables). This is exactly the Playwright Agents pattern: the **Planner** explores the application and writes a plan, the **Generator** turns the plan into executable tests while checking against the live site (Playwright v1.56) [fact]. The project reuses them or builds an equivalent.
3. **Smoke test.** Where the site's terms or an official sandbox permit automated testing, the generated smoke tests run against the live site in a fresh browser profile with a dedicated test account, which proves that the skill does not depend on the author's session and that no secrets leaked into the recording. Where the site's terms do not (Allegro: art. 10.11 of the Regulamin, edition effective 2026-09-01, prohibits bots and other software tools while using Allegro; see the `terms` field note in section 2), no automated smoke runs are scheduled; the maintainer verifies the skill as an ordinary account holder through personal-use searches and purchases from their own logged-in profile (see scheduled verification below); independence from the author's session is then shown by the sanitizer report and by a reviewer reading the recording, not by a fresh-profile run. In every case a sanitizer must strip PII, cookies and tokens from the recording **before** the commit.
4. **PR to the registry.** PR template: channel (API / browser), flows covered, log of a green smoke run, a redacted checkout screenshot, anti-bot and terms declaration. See [registry.md](registry.md).

The planned glue is a CLI: `skill record <url>` (record and generalize), `skill verify <site>` (run the smoke tests, update `last_verified`) and `skill publish` (fork + PR to the registry with the template above; see [registry.md](registry.md) and `../cli/`).

Scheduled verification and self-healing [hypothesis, project design]:

- Registry-CI scheduled smoke runs exist only for sites whose terms, an official sandbox or a public API permit automated testing. For a site whose terms do not (Allegro: art. 10.11 of the Regulamin, edition effective 2026-09-01, see the `terms` field note in section 2) the project schedules no automated runs. Such a skill is verified by a maintainer acting as an ordinary account holder who performs a personal-use search or purchase with the skill: the same activity the skill exists for, at personal volumes, under the same `usage_policy` hygiene and the same own-account risk acceptance as any user (never a throwaway account driven by automation, see step 3 above). The result is recorded as `verified_by: human`. The search check uses the official Allegro REST API where it covers the need. The project will request sandbox/API access for automated testing from the marketplace and moves the skill to CI verification once granted. A challenge during verification is a stop, never a retry. Registry CI validates only the package (schema, sanitizer, redaction) and records the maintainer-submitted green run. A datacenter/CI run against a site that does not permit automated testing is excluded on policy grounds (no headless farms; marketplace terms). The research note proposed a registry-CI cron (daily for top sites, weekly for the tail) across all skills; v0.1 narrows this to sites that permit automated testing or provide a sandbox.
- A red test starts a **Healer agent**: it analyses the failure trace, DOM snapshot and logs, re-resolves the selector (observe/act), patches `selectors.yaml` and **opens a PR** with the diff and a new green run. The same healer is built into Playwright v1.56 [fact]; self-healing is also declared by workflow-use [vendor claim].
- A maintainer merges a PATCH PR after two human approvals for `risk_tier: money` skills ([registry.md](registry.md)); auto-merge of bot PRs is allowed only for read-only skills and never for changes touching the checkout flow or `pay_button`. MAJOR changes are merged by hand only.
- Opt-in client telemetry ("skill X failed at step Y") triggers an unscheduled check. Project decision: per-purchase telemetry also records whether a bank challenge (3DS/SMS) occurred, because the field-measured challenge frequency on saved-card / Allegro Pay payments at the basket sizes the mandate allows is the first MVP metric: it determines how often the user is asked to confirm a purchase the agent has already checked against the mandate. Whether a transaction is exempted from SCA (low-value, TRA) is decided by the issuer and acquirer, not by the agent; the metric only measures how often the user is asked to confirm, it does not shape amounts or timing to avoid challenges.

## Conclusion

1. The container is **SKILL.md under the open Agent Skills standard**: the only format picked up natively by both Claude Code and Codex CLI [fact].
2. Inside it: a layered selector map (a11y role -> data attribute -> natural-language fallback), flows search -> checkout -> tracking with mandatory edge cases, a mandate gate before the pay button, Playwright smoke tests, semver plus `last_verified`.
3. The "new site in one evening" process: record a purchase (playwright codegen / workflow-use / Stagehand cache) -> LLM generalization into a skill -> secret sanitization -> smoke test (on a clean profile where the site permits automated testing, otherwise maintainer-run, see section 3) -> PR by template. Every link exists; the glue is the `skill record` / `skill verify` / `skill publish` CLI.
4. Maintenance: scheduled smoke runs where the site's terms permit them (otherwise maintainer verification as an ordinary account holder, unscheduled), plus a Healer agent that fixes selectors and sends PRs for human review (the Playwright v1.56 Healer pattern).
5. llms.txt and AGENTS.md are not skill carriers; agents.json and WebMCP are optional API sections that take priority over the browser channel.

## Related documents

- [architecture.md](architecture.md): how site skills, the runtime and the purchase mandate fit together
- [mandate-spec.md](mandate-spec.md) and [../examples/PURCHASE_MANDATE.template.md](../examples/PURCHASE_MANDATE.template.md): the purchase mandate the checkout gate checks
- [registry.md](registry.md): where skills live, review rules for `risk_tier: money`, staleness
- [payments.md](payments.md): PSD2 / SCA / 3DS and the saved-card / Allegro Pay rails
- [anti-bot-policy.md](anti-bot-policy.md) and [security.md](security.md): challenges, escalation, secrets handling
- [execution-stack.md](execution-stack.md): the browser runtime (Playwright, Stagehand, MCP) the skills run on
- [landscape.md](landscape.md) and [marketplaces.md](marketplaces.md): agentic commerce context, Allegro and OLX specifics

## Sources

All accessed 2026-08-31 unless stated otherwise.

- Agent Skills open standard, primary: https://agentskills.io (client showcase, accessed 2026-09-03); secondary: https://strapi.io/blog/what-are-agent-skills-and-how-to-use-them ; https://codex.danielvaughan.com/2026/05/05/agent-skills-open-standard-portable-skills-codex-cli-cross-agent/
- Codex CLI skills, primary: https://developers.openai.com/codex/skills/ (redirects to https://learn.chatgpt.com/docs/build-skills, accessed 2026-09-03); secondary: https://itecsonline.com/post/codex-cli-agent-skills-guide-install-usage-cross-platform-resources-2026
- Claude Code memory documentation (CLAUDE.md imports, `@AGENTS.md`): https://code.claude.com/docs/en/memory (accessed 2026-09-03)
- agents.json: https://docs.wild-card.ai/agentsjson/introduction ; https://github.com/wild-card-ai/agents-json
- llms.txt evidence: https://www.1clickreport.com/blog/llms-txt-evidence-2026 ; https://www.digitalapplied.com/blog/llms-txt-in-practice-adoption-evidence-2026
- Stagehand caching and v3: https://www.browserbase.com/blog/stagehand-caching ; https://www.browserbase.com/blog/stagehand-v3
- workflow-use: https://github.com/browser-use/workflow-use
- Playwright Agents (planner / generator / healer), primary: https://playwright.dev/docs/release-notes (v1.56, accessed 2026-09-03); secondary and the Playwright AI ecosystem: https://blog.nashtechglobal.com/playwright-test-agents-planner-generator-and-healer/ ; https://testdino.com/blog/playwright-ai-ecosystem
- WebMCP: https://zuplo.com/blog/what-is-webmcp ; https://www.datacamp.com/tutorial/webmcp-tutorial
- Amazon v. Perplexity: https://www.cnbc.com/2026/03/10/amazon-wins-court-order-to-block-perplexitys-ai-shopping-agent.html ; https://www.engadget.com/2230471/perplexity-has-successfully-overturned-amazon-injunction-on-its-ai-shopping-bot/
- Allegro Terms (Regulamin), primary: https://allegro.pl/regulamin (edition effective 2026-09-01; art. 2.8, 8, 10.10 and 10.11; main text read 2026-09-03 in a logged-in browser session, attachments not checked); secondary report (not primary text, cited as [reported] in section 2): https://xyz.pl/allegro-wprowadza-cicha-rewolucje-ktora-uderzy-w-konkurentow-i-ai-zidentyfikowalismy-wiele-naduzyc/ (2025-09-15; describes the terms as a ban on automated ordering); the full list of secondary reports is in [marketplaces.md](marketplaces.md)

---
Part of [Agentic Shopping Autopilot](../README.md) by Andrii Shramko — code Apache-2.0, docs CC BY 4.0. Contact and collaboration: see the repository README.
