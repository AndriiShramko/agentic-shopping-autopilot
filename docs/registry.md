# Skill registry and supply-chain security

Agentic Shopping Autopilot is designed to distribute its site skills (Allegro, OLX and, later, any shop a user records) through a public registry, so that one command installs a skill into both Claude Code and Codex. Because a shopping skill drives an AI agent that pays with the user's real payment method, the registry is designed around supply-chain security first: every version will be scanned, sandboxed, signed and version-pinned, and a skill never sees payment data at all. This page describes where the registry lives, the incidents that shaped its threat model, the countermeasures, and how anyone can contribute a new site (registry status: planned for v1, see section 1).

## Questions this page answers

- How do I install a shopping site skill into both Claude Code and Codex with a single command?
- How does a registry of agent skills stop a malicious skill from stealing card data or redirecting a delivery?
- What happened in the postmark-mcp and ClawHub incidents, and what do they mean for an AI agent that pays?
- How do I publish a site skill I recorded, and who maintains it afterwards?

Evidence tags used below: **[fact]** - confirmed by a cited source; **[vendor claim]** - stated by the vendor, not independently verified; **[hypothesis]** - the project's own design or conclusion, still to be validated; **[reported]** - press reporting, not independently verified.

## 1. What the registry holds

A **site skill** is a folder in the open Agent Skills (`SKILL.md`) format: instructions for the agent, a layered selector map, step-by-step flows from search to tracking, smoke tests and a changelog (the reference skill currently ships the core subset, see [site-skill-spec.md](site-skill-spec.md) §2). The format is specified in [site-skill-spec.md](site-skill-spec.md); the reference implementation is [../skills/allegro.pl/](../skills/allegro.pl/) ([SKILL.md](../skills/allegro.pl/SKILL.md), [selectors.yaml](../skills/allegro.pl/selectors.yaml), [flows/](../skills/allegro.pl/flows/)).

The **registry** is where such folders are collected, reviewed, tested and installed from. Each skill declares a `risk_tier` (`money` | `account` | `read-only`) in its frontmatter, and the tier decides how strict the review is. A shopping skill that reaches checkout is always `risk_tier: money`.

Status: the public registry is a v1 milestone of the project (see the roadmap in the [README](../README.md)); this repository already uses the layout the registry will index.

## 2. Where the registry lives

Five hosting options were compared. The decisive requirement was "install with one command into Claude Code AND Codex", since Agentic Shopping Autopilot targets both agents.

| Option | One command in Claude Code AND Codex | Moderation / security | Discovery | MVP cost | Verdict |
|---|---|---|---|---|---|
| **Git monorepo of skills + install CLI** (the `vercel-labs/skills` model: `npx skills add owner/skill`) | Yes: the npx CLI installs a skill into 18+ agents, including Claude Code and Codex [vendor claim] | PR review, CODEOWNERS, CI smoke tests, signed tags | Medium (README plus a skills.sh-style listing) | Minimal | **Chosen for MVP** |
| **Claude Code plugin marketplace** (`/plugin marketplace add`, `marketplace.json` in git) | Claude Code only; Codex does not read `marketplace.json` [fact] | Own git repo | Limited | Low | **Do in addition**: the same repo serves as the `marketplace.json` source and as the npx target |
| **MCP Registry** (registry.modelcontextprotocol.io) | It is a registry of MCP servers, not skills; in preview since 2025-09-08, no GA yet [fact] | Namespace verification | Good | Medium | Only for the project's **runtime MCP server** (browser / checkout engine), not for skills |
| **npm / pip** | Delivers files, but does not place them into `~/.claude/skills` and `~/.agents/skills` without a post-install script, and a post-install script is itself a supply-chain risk | npm's registry-side checks did not catch postmark-mcp: it built trust over 15 clean versions and the backdoored v1.0.16 was found by researchers, not by the registry (section 3.1) | npm search | Medium | Not in MVP |
| **Catalogue website** (search, ratings, smoke status) | Not an install channel by itself; it points to the same install command | "verified" badges, last-check dates | Best, plus SEO / GEO reach | Highest | **Phase 2**, generated statically from the monorepo |

Sources for the table: Vercel changelog and skills.sh CLI docs; Claude Code plugin marketplace docs; MCP Registry preview announcement (all accessed 2026-08-31, see Sources).

### One command, both agents

"Pull the skill into both agents with one command" is already solved by the ecosystem: the Agent Skills standard is the same for Claude Code and Codex, and `npx skills add <owner/skill>` puts the skill into the right directories of both agents [vendor claim]. The project therefore only needs to be a git repository compatible with that CLI.

**Project decision:** be a plain git monorepo that works with `npx skills add`, and additionally ship a thin `install.sh` / `skill add <site>` CLI of our own, so that installation does not depend on a single vendor [hypothesis]. The same repository publishes a `marketplace.json`, so Claude Code users can also add it as a plugin marketplace.

## 3. Supply-chain security: a skill that spends money

### 3.1 Known incidents

All four incidents below are documented [fact]; together they define the threat model for a registry whose skills can complete an autonomous checkout.

1. **postmark-mcp (September 2025)** - the first confirmed malicious MCP server in the wild. An npm package cloned the official one, shipped 15 versions to build trust, and in v1.0.16 added a single line that BCC'd every email to an external address. About 1,500 downloads per week; an estimated ~300 organisations affected.
2. **ClawHub / OpenClaw (February 2026)** - the largest skill-registry incident to date. Koi Security audited 2,857 ClawHub skills and found **341 malicious**, 335 of them from one campaign ("ClawHavoc"); an independent researcher counted 386 over 1-3 February; Antiy Labs has historically catalogued **1,184** malicious skills. The skills posed as crypto tools (ByBit, Polymarket and others) and stole exchange API keys, wallet private keys, SSH keys and browser passwords; one author reached ~7,000 downloads. After the incident ClawHub enabled proactive scanning through VirusTotal.
3. **CVE-2025-6514, mcp-remote (July 2025)** - CVSS 9.6. Connecting to an untrusted MCP server gave remote code execution on the client machine (versions 0.0.5-0.1.15): the first documented client-side RCE triggered by a remote MCP server.
4. **GitHub MCP prompt injection (May 2025, Invariant Labs)** - a malicious issue in a public repository hijacks the agent and makes it leak data from private repositories. Recognised as an architectural problem with no simple fix; the only mitigation is least privilege.

### 3.2 Attack surface of a shopping skill

The incidents show three attack axes:

| Axis | Where the payload lives | Example |
|---|---|---|
| (a) Malicious code | Scripts inside the skill package (smoke tests, helpers, post-install hooks) | One added line that exfiltrates data, as in postmark-mcp |
| (b) Malicious natural-language instructions | The `SKILL.md` text itself: hidden directives, base64 or Unicode obfuscation | Instructions the agent obeys but a reviewer skimming the diff does not notice |
| (c) Prompt injection from content the skill reads | Shop pages, product descriptions, reviews, seller messages, order emails | The GitHub MCP case, transplanted to a marketplace |

For a skill that drives an AI shopping agent through checkout, the concrete threats are:

- swapping the delivery address for a drop address;
- leaking the card number or the logged-in session during checkout;
- a "hidden purchase": adding an extra item or a subscription to the cart;
- swapping the seller for the attacker's own listing;
- referral or affiliate links that skim the purchase.

### 3.3 Countermeasures in the registry

The design below is the project's own [hypothesis]; the tooling it relies on exists today [fact].

**Automatic scanning of every PR and every version.** Snyk `agent-scan` scans MCP servers and skills for prompt injection, hidden or obfuscated instructions and exfiltration, and supports Claude Code, Cursor, Gemini CLI and other agents; Cisco `skill-scanner` combines YARA rules, an LLM judge and dataflow analysis, with VirusTotal integration [vendor claim]. The registry runs one or both on every change, plus VirusTotal for any binary.

**Human review for `risk_tier: money`.** Two approvals are required. Reviewers diff the whole natural-language text of the skill, not only the code, because axis (b) lives in prose. Executable post-install hooks are banned outright.

**Sandbox run of every version.** Each version is executed in an isolated container as a package-level dynamic analysis that does not touch the live marketplace: the skill runs against a recorded replica of the site (HAR / fixture replay, or a mock server built from the maintainer's redacted recording) or against an official test environment where the site provides one, with fake payment data and a fake mandate. The network allowlist contains only the replay host (or the official test environment); any request to a domain outside it automatically rejects the version. Lesson from postmark-mcp: the backdoor added a `Bcc:` field to the payload sent through Postmark's own legitimate API (Snyk write-up), so a domain allowlist alone would not have caught it; Koi's risk engine flagged suspicious behaviour in v1.0.16 and its researchers then traced it to the Bcc line. The sandbox therefore also records outbound request payloads (recipients, delivery address, seller, totals) and diffs them against the fake mandate on the replay; any mismatch rejects the version. No live-marketplace traffic originates from registry CI. Live-site runs happen only as described in [site-skill-spec.md](site-skill-spec.md), section 3: scheduled smoke runs only where the site's terms, an official sandbox or a public API permit automated testing; for any other site, verification by the maintainer acting as an ordinary account holder from their own logged-in profile, at personal volume, recorded as `verified_by: human` (no headless farms, proxies or anti-detect tooling; see [anti-bot-policy.md](anti-bot-policy.md)).

**Signatures and pinning.** Git tags are signed (sigstore / cosign is the candidate tooling [hypothesis]). The client keeps a `skills.lock` file with a content hash per installed skill. Automatic updates are allowed only for PATCH versions published by the trusted CI bot; MINOR and MAJOR updates require the user's confirmation. Lesson from postmark-mcp: trust is accumulated over versions, so "a new version of a known skill" is the main attack vector.

**Author reputation and quarantine.** Verified namespaces (a domain or a GitHub organisation), account age and the history of green smoke runs feed a reputation signal. New authors are quarantined: their skills are not shown in search until a configurable quarantine period (length to be decided) has passed and a manual review is done. Lesson from ClawHavoc: 335 skills of one campaign used brand typosquatting, so skill names are checked against the list of known marketplaces for look-alikes.

### 3.4 Invariants on the client (defence in depth)

The registry can be bypassed - a user may install a skill from any folder - so the most important controls live in the runtime, not in the registry:

- **The skill never sees payment data.** The delivery address and the payment method are injected by the runtime; the skill has no access to the PAN, CVV, cookies or one-time codes, and none of them ever enter the model context, git or logs. In the MVP the runtime only triggers the user's existing saved payment method in the marketplace account (one-click saved card or Allegro Pay) and never types card details. See [payments.md](payments.md) and [security.md](security.md).
- **The purchase mandate is checked before the pay button.** Before paying, the runtime verifies the final total, the delivery address and the seller against the signed purchase mandate ([mandate-spec.md](mandate-spec.md), template: [PURCHASE_MANDATE.template.md](../examples/PURCHASE_MANDATE.template.md)). Any deviation stops the purchase and escalates to the user. The project default completes payment inside the mandate; a human-confirm mode is available as a configuration flag. Allegro's Terms (Regulamin, edition effective 2026-09-01, read 2026-09-03) prohibit the use of bots and other software tools while using Allegro (art. 10.11) and scraping of its data for reuse (art. 10.10), state that automated solutions are used at the user's own risk (art. 2.8), and let Allegro apply mechanisms that block such tools (art. 8). An AI agent driving the user's own browser may fall under art. 10.11 (a secondary report (xyz.pl, 2025-09-15) covers Allegro's tightened REST API key rules effective 2025-09-23 (max 5 keys, no sharing, a 50,000 PLN contractual penalty); a sentence in that article about a ban on unattended orders describes Shopify's anti-bot strategy, not Allegro's, so it is not used here as evidence about Allegro). The project does not disguise the agent and does not attempt to defeat any platform control; each account holder decides and accepts the risk for their own account. The agent acts only inside the user's own logged-in browser profile and at personal-use volumes. See the terms section of [anti-bot-policy.md](anti-bot-policy.md) and [marketplaces.md](marketplaces.md). The human is involved only for the bank's own PSD2 / SCA challenge (3DS or SMS), a CAPTCHA / anti-bot challenge (never bypassed, see [anti-bot-policy.md](anti-bot-policy.md)), or a deviation from the mandate.
- **Spending limits are enforced by the runtime and recorded in the audit log.** Per-mandate limits are enforced by the runtime and recorded in an append-only audit log, since the MVP uses the user's existing payment methods rather than a hard-capped virtual card.
- **Page content is data, not instructions.** Product descriptions, reviews and seller messages are never treated as commands (axis (c)).

The industry is moving the same way: the AP2 payment protocol, donated to the FIDO Alliance on 2026-04-28, is built around cryptographic mandates that record who authorised a payment [fact]. The project's mandate format is designed to map onto the AP2 Intent Mandate fields [hypothesis] (see [architecture.md](architecture.md) and [mandate-spec.md](mandate-spec.md)).

## 4. Contribution model

### 4.1 How a user shares a new site

1. `skill record <url>` - the user makes one purchase in their real browser; the agent generalises the recording into a local skill folder (details in [site-skill-spec.md](site-skill-spec.md)).
2. Local use and smoke tests on a clean browser profile; secrets, cookies and personal data are stripped before anything is committed.
3. `skill publish` - a fork and a pull request to the monorepo, using the PR template: channel used (API or browser), flows covered, a green smoke-test log, a redacted checkout screenshot, and a declaration of the site's anti-bot posture and terms.
4. Automated scan, sandbox run and review as described in section 3; merge. The author is recorded in the `maintainers` frontmatter field and in git history.

The target effort for adding a new site is one evening.

### 4.2 Licence and contributor agreement

- Code and skills: **Apache-2.0** [fact] (see [../LICENSE](../LICENSE)): patent protection, familiar to corporate contributors.
- Contributor sign-off: **Developer Certificate of Origin (DCO)** instead of a CLA, to keep the barrier low.
- Site descriptions (selectors, endpoints, flows) are largely factual, so the project treats them as code under Apache-2.0 rather than as documentation; one licence for all code and skill files avoids per-file disputes, while prose documentation stays under CC BY 4.0.
- Documentation and specifications: CC BY 4.0 (see the [README](../README.md)).

### 4.3 Maintainership and lifecycle

| Role | Responsibility |
|---|---|
| Site-skill maintainer (CODEOWNERS per domain) | The author of a site skill becomes its maintainer; merges PATCH fixes from the healer bot after green CI, reviews MINOR / MAJOR changes by hand |
| Core team | Owns the skill schema, CI, the security policy and the incident procedure |
| "Adopt-a-site" | Orphaned skills can be taken over by a new maintainer |

A skill with no green smoke run for 60 days is marked `status: stale` and then archived. Scheduled smoke runs, the healer and the `last_verified` field are described in [site-skill-spec.md](site-skill-spec.md).

### 4.4 Sustainability (open core) [hypothesis]

Open: the skill format, the registry, the CLI and the smoke tests. Candidate paid services:

1. **Hosted verification** - priority scheduled smoke runs, private skills for companies, an SLA on self-healing.
2. **Enterprise proxy with policies** - spending limits, a purchase audit log, DLP.
3. **"Verified skill" certification** for merchants that want to be agent-friendly.

Market signals are mixed: the merchant-side stack is being built quickly (Stripe Agentic Commerce Suite, 2025-12-11 [fact]), while OpenAI wound down consumer Instant Checkout (announced 2026-03-04/05, Digital Commerce 360 2026-03-06; fully wound down by 2026-03-24, CNBC) after low merchant and buyer adoption: it struggled to onboard merchants (CNBC, 2026-03-24) and press put first-month buyer trial at about 8% of US adult users [reported] (figures and sources in [landscape.md](landscape.md)). The project treats this as a caution signal on consumer demand and keeps the paid layer optional.

## 5. Summary and registry security checklist

**Distribution for the MVP:** a public git monorepo of skills plus an install CLI. It is compatible with two ready channels at once: `npx skills add` (18+ agents, including Claude Code and Codex) and the Claude Code plugin marketplace (same repo plus `marketplace.json`). A catalogue website is phase 2, generated statically from the repo. The MCP Registry is used only for the runtime MCP server. npm and pip are not needed.

**Registry security checklist:**

1. Automatic scan of every PR: `snyk/agent-scan` + `cisco/skill-scanner` + VirusTotal for binaries.
2. Sandbox run against a recorded replica / official test environment, fake payment data, no live-marketplace traffic from CI.
3. Two human approvals for `money`-tier skills; natural-language text reviewed as code.
4. Signed tags + `skills.lock` with content hashes; automatic updates only for PATCH.
5. Verified namespaces, quarantine for new authors, anti-typosquatting check against marketplace names.
6. Payment data and delivery address live only in the runtime; the skill never sees them. The runtime checks the mandate before paying; human confirmation of each payment is an optional flag (terms and account-risk note: section 3.4).
7. Scheduled smoke runs, `last_verified`, stale badges.
8. Incident procedure: a kill-switch per version (revocation in the index) plus notification of everyone who installed it.

## Related documents

- [architecture.md](architecture.md) - overall design of the AI shopping agent
- [site-skill-spec.md](site-skill-spec.md) - the site skill format, smoke tests, healer
- [mandate-spec.md](mandate-spec.md) - the purchase mandate
- [payments.md](payments.md) - payment rails, PSD2 / SCA / 3DS
- [security.md](security.md) - threat model and stop triggers
- [anti-bot-policy.md](anti-bot-policy.md) - honest anti-bot posture
- [marketplaces.md](marketplaces.md) - Allegro and OLX specifics
- [execution-stack.md](execution-stack.md) - runtime and browser stack
- [landscape.md](landscape.md) - agentic commerce protocols and market

## Sources

- Vercel changelog, skills CLI: https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem ; https://www.skills.sh/docs/cli (accessed 2026-08-31)
- Claude Code plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces (accessed 2026-08-31)
- MCP Registry preview: https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/ (published 2025-09-08; accessed 2026-08-31)
- postmark-mcp: https://web.archive.org/web/20260827163357/https://www.koi.ai/blog/postmark-mcp-npm-malicious-backdoor-email-theft (archived Koi write-up; the original URL now redirects to a product page) ; https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html ; https://snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails/ (2025-09; accessed 2026-08-31)
- ClawHub / ClawHavoc: https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/ ; https://www.esecurityplanet.com/threats/hundreds-of-malicious-skills-found-in-openclaws-clawhub/ ; https://www.termdock.com/en/blog/clawhub-malicious-skills-incident (2026-02; accessed 2026-08-31)
- CVE-2025-6514: https://jfrog.com/blog/2025-6514-critical-mcp-remote-rce-vulnerability/ (published 2025-07-09; accessed 2026-08-31)
- GitHub MCP prompt injection: https://invariantlabs.ai/blog/mcp-github-vulnerability (2025-05-26) ; https://devclass.com/2025/05/27/researchers-warn-of-prompt-injection-vulnerability-in-github-mcp-with-no-obvious-fix/ (2025-05-27) (accessed 2026-08-31)
- Scanners: https://github.com/snyk/agent-scan ; https://github.com/cisco-ai-defense/skill-scanner (accessed 2026-08-31)
- AP2 protocol: https://eco.com/support/en/articles/15192002-ap2-protocol-explained-google-s-agentic-commerce-standard-2026 (accessed 2026-08-31)
- Allegro Terms (Regulamin): https://allegro.pl/regulamin (edition effective 2026-09-01; primary text read 2026-09-03 in a logged-in browser session; art. 2.8, 8, 10.10, 10.11) ; secondary report on Allegro's tightened REST API rules effective 2025-09-23: https://xyz.pl/allegro-wprowadza-cicha-rewolucje-ktora-uderzy-w-konkurentow-i-ai-zidentyfikowalismy-wiele-naduzyc/ (2025-09-15; its ban-on-unattended-orders sentence describes Shopify, not Allegro)
- Agentic commerce market (Stripe Agentic Commerce Suite, OpenAI Instant Checkout closure): https://stripe.com/newsroom/news/agentic-commerce-suite (2025-12-11) ; https://www.digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/ (2026-03-06) ; https://www.cnbc.com/2026/03/24/openai-revamps-shopping-experience-in-chatgpt-after-instant-checkout.html (2026-03-24; accessed 2026-09-03) ; https://www.digitalapplied.com/blog/agentic-commerce-standards-ucp-acp-ap2-2026-merchant-guide (accessed 2026-08-31)

---
Part of [Agentic Shopping Autopilot](../README.md) by Andrii Shramko — code Apache-2.0, docs CC BY 4.0. Contact and collaboration: see the repository README.
