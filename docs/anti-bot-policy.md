# Anti-bot policy: the user's own browser, honest identification, no circumvention

Marketplaces block bots for real reasons, but the industry is moving from blanket blocking toward identifying agents. This page explains why stores block AI shopping agents, what is changing (signed agents, official agent lanes, the Amazon v. Perplexity case), where the line between legitimate and illegitimate automation runs, and the policy Agentic Shopping Autopilot commits to: the user's own browser profile, human pace, honest identification, and never bypassing a challenge.

Research snapshot: 2026-08-31. Evidence tags used below: **[fact]** (verifiable source with a date), **[vendor claim]** (marketing or self-description), **[reported]** (press or blog figure not independently verified), **[hypothesis]** (project conclusion that still needs verification).

## Questions this page answers

- Will Allegro or OLX treat my AI shopping agent as a bot, and what does this project do when they do?
- Is it legal for an AI agent to shop under my own account, and what does the Amazon vs Perplexity ruling mean for that?
- What is Web Bot Auth (a "signed agent"), and does this project use it?
- Which anti-bot tricks does Agentic Shopping Autopilot refuse to implement, and why?

## 1. Why stores block agents, and what is changing

### Why they block

- [fact] 47.9% of all AI-bot traffic on the Akamai network (July-December 2025) hit the commerce vertical; Akamai describes commerce as the epicenter of AI-bot attacks and agentic fraud (Akamai press release, 2026).
- [fact] DataDome counted about 1.2 billion requests from OpenAI crawlers alone in June 2025 (DataDome/TollBit via Businesswire, 2025-07-28).
- [hypothesis] Motives behind blocking, synthesized from the sources above: (a) server load and price scraping by competitors; (b) lost ad revenue and analytics, because an agent never sees banners; (c) fraud, since scalpers and credential-stuffing tools disguise themselves as "agents"; (d) loss of control over the customer experience and conversion.

### What is changing: identification instead of blanket blocking

- [fact] Cloudflare promotes **Web Bot Auth**: cryptographic signing of the agent's HTTP requests, based on RFC 9421 (HTTP Message Signatures). The agent signs its requests; the site verifies them against a published public key (Cloudflare "signed agents" blog; Cloudflare Verified Bots docs).
- [fact] The IETF formed a **WebBotAuth** working group (after a BoF at IETF 123) to standardize the mechanism (Stellagent overview, 2026).
- [fact] Since 1 July 2026 Cloudflare distinguishes a "verified bot" (one operator) from a "signed agent" (user-directed: thousands of users steer the same agent at different targets), exposed as a new Direct vs Intermediary access field (Cloudflare docs, 2026-07).
- [fact] AWS Bedrock AgentCore Browser supports Web Bot Auth (fewer CAPTCHAs) and works with AWS WAF, Cloudflare, HUMAN Security and Akamai (AWS docs, 2026).
- [vendor claim] DataDome positions "Agent Trust Management": instead of blocking every agent, separate legitimate from malicious ones, plus access monetization through a partnership with TollBit (Black Hat USA 2025).
- [vendor claim] Akamai calls for "agentic readiness": welcome legitimate AI while shutting down malicious bots; Akamai and Visa partner on identity and fraud controls for agentic commerce (Digital Commerce 360, 2025-12-17).
- [fact] Web Bot Auth is voluntary - an agent may simply not sign - so vendors keep behavioural detection as a fallback (Arcjet blog, 2026).

Status in this project (2026-08-31): Web Bot Auth is planned, not implemented in the MVP; neither Allegro nor OLX has announced that it accepts signed agents (see [marketplaces.md](marketplaces.md)). It appears as a roadmap item in section 3.

### The Amazon v. Perplexity case (the legal frame)

- [fact] November 2025: Amazon sent Perplexity a cease-and-desist over agentic shopping in the Comet browser, accusing it of disguising the bot as ordinary Chrome and of circumventing technical blocks (Amazon alleges that a block imposed in August 2025 was worked around within 24 hours) (CNBC, 2026-03-10).
- [fact] March 2026: the district court granted Amazon a preliminary injunction; on 4 August 2026 the **Ninth Circuit vacated it** in a published opinion (Amazon v. Perplexity, No. 26-1444), finding Amazon unlikely to succeed on its CFAA (Computer Fraud and Abuse Act) and California CDAFA claims: when a user directs Comet, the traffic comes from the user's own computer, so the user, not Perplexity, accesses Amazon's servers. This is a likelihood-of-success finding at the preliminary-injunction stage, not a merits holding; the court expressly limited its holding to CFAA/CDAFA "access", said it does not address other contexts such as tort claims, and remanded the case to the district court (Ninth Circuit opinion, 2026-08-04; Engadget, 2026-08-04; eMarketer, 2026-08-05).
- [hypothesis] (legal, EU/Poland) This is a US interlocutory ruling; there is no comparable EU case law yet, but the logic carries over: an agent acting under the user's account with the user's consent is a contractual matter (account suspension and possible civil claims) rather than the criminal "unauthorized access" theory. This still requires legal review under PL/EU law and is not covered here.

Two lessons the project takes from the case: acting as the user's own hands, with traffic from the user's own machine and login, is the defensible posture, and disguising the agent as a human browser while racing to defeat blocks is exactly what Amazon alleges in its complaint against Perplexity. This project does the first and never the second.

### Official agent lanes: who is already agent-friendly

- [fact] OpenAI wound down Instant Checkout (buying inside ChatGPT, launched September 2025) — announced 2026-03-04/05 (Digital Commerce 360, 2026-03-06), fully wound down by 2026-03-24 (CNBC) — in favour of the **Agentic Commerce Protocol (ACP)**: discover in AI, buy on site (Digital Commerce 360, 2026-03-06; CNBC, 2026-03-20 and 2026-03-24). [reported] Press coverage attributed the decision to weak uptake (about 30 Shopify merchants, fewer than 200k Walmart products).
- [reported] Walmart measured that checkout inside ChatGPT converted roughly 3x worse than a handoff to walmart.com, while ChatGPT delivered roughly 2x the new-customer rate compared with search (digitalapplied, 2026).
- [fact] **Shopify Agentic Storefronts** opened to all eligible US merchants in March 2026: 5.6 million stores can connect to ChatGPT, Copilot and Gemini in one step (Enterprise DNA, 2026).
- [fact] (critical for the MVP) **Allegro launched an official app in ChatGPT (May 2026)** in partnership with OpenAI: search, comparison, advice, OpenAI-Allegro account linking and a handoff to purchase on Allegro; free, no subscription (media.allegro.pl, 2026-05; spidersweb.pl, 2026-05; obserwatorlogistyczny.pl, 2026-05-13). Allegro itself is moving toward agentic commerce, and the final checkout stays on allegro.pl.
- [fact] Payment networks are building rails for agents: **Mastercard Agent Pay** (announced 2025-04-29; Agentic Tokens on top of MDES, a token bound to agent + merchant + consent policy; first live agentic transaction 2025-09-29) and **Visa Intelligent Commerce / Intelligent Commerce Connect + Trusted Agent** (Mastercard press release, 2025-04-29; TechInformed, 2026). See [payments.md](payments.md).
- [hypothesis] (synthesis of the items above) Agent-friendly venues as of 2026-08: Allegro (ChatGPT app), Shopify merchants (Agentic Storefronts / ACP), Walmart (ACP / Sparky), Etsy, PayPal merchants (Perplexity "Buy with Pro"), Instacart (ChatGPT). Closed to third-party agents: Amazon (litigation against Perplexity; its own Rufus and "Buy for Me"). **OLX.pl** is neutral: a Partner API exists, but no buyer-side agent lane is announced; to be verified with OLX. In the MVP the project uses only OLX's native escrow flow "Kup z Przesyłką OLX" (see [marketplaces.md](marketplaces.md)).

The broader market picture is in [landscape.md](landscape.md).

## 2. The spectrum of practices: from white to black

| Level | Practice | Shade | Project stance |
|---|---|---|---|
| 0 | Official API or agent lane | White | Use wherever a buyer-side channel exists; monitor Allegro and OLX for one |
| 1 | The user's logged-in session in the user's own browser on the user's own machine | White-grey | **Project default** |
| 2 | Cloud browser that identifies itself to anti-bot vendors via a partnership | Grey | Not in the MVP; tolerable only if the session identifies itself honestly (Web Bot Auth) and the login belongs to the user |
| 3 | Anti-detect browsers, residential proxies, fingerprint spoofing | Black | **Out of scope forever** |

### Level 0 - official API / agent lane (white)

- [fact] The Allegro REST API covers the full seller cycle: listings, orders, payments, shipping, invoices (help.allegro.com). No buyer-side purchase API appears in Allegro's public developer documentation as of 2026-08-31 [fact about the documentation]; whether ACP / ChatGPT-app contracts cover it is unknown [hypothesis].
- [fact] The OLX Partner API (developer.olx.pl) covers posting and managing ads, internal messages and OLX Delivery (Przesyłki OLX) integration; OAuth with Client ID / Secret issued through the Developer Portal. Also seller-oriented.
- [reported] In September 2025 (effective 2025-09-23) Allegro tightened its REST API rules: a maximum of five API keys per account, no sharing of keys with other entities, a contractual penalty of 50,000 PLN per breach, and the right to refuse API access without giving reasons (xyz.pl, 2025-09-15). [fact] Allegro's Terms (the Regulamin, hereafter "Allegro ToS"; edition effective 2026-09-01, read 2026-09-03) prohibit bots and other software tools while using Allegro (art. 10.11) and let Allegro apply mechanisms that block such tools (art. 8); Allegro's help pages describe when an account may be suspended or its functionality limited (Allegro Pomoc); that page does not itself name bots or automation, and the bot rule is in art. 10.11 of the Regulamin.

### Level 1 - the user's own browser (white-grey, the project default)

The agent is the user's "hands": a local Chrome profile, the real home-network IP, real cookies, actions at human pace, and the user can watch at any time. [fact] (US, interlocutory) When it vacated Amazon's preliminary injunction (2026-08-04), the Ninth Circuit found Amazon unlikely to succeed on its CFAA claim because the traffic of a user-directed agent comes from the user's own computer (see section 1). [fact] The Allegro ToS state that automated solutions, in particular login-triggering software, are used at the user's own risk (art. 2.8); an AI agent driving the user's own browser may also fall under the ban on bots and other software tools in art. 10.11 (see "What the marketplace terms say" below).

In this project a site skill (see [site-skill-spec.md](site-skill-spec.md) and the reference skill [../skills/allegro.pl/](../skills/allegro.pl/)) is executed by the user's own agent runtime - Claude Code, Codex or another MCP-capable host - attached to the user's existing browser profile. Cookies stay in that profile and never enter the agent's files, the model context, git or logs (see [security.md](security.md) and [execution-stack.md](execution-stack.md)).

### Level 2 - cloud browser that identifies itself to anti-bot vendors via a partnership (grey)

- [vendor claim] Some cloud-browser vendors offer sessions that identify themselves to anti-bot vendors through a commercial partnership, so the anti-bot vendor recognizes the session as a declared agent. Acceptable only if the session identifies itself honestly (Web Bot Auth) and the login belongs to the user. Not used in the MVP; no such product is named or linked on this page.

### Level 3 - anti-detect stack (black, out of scope)

- [fact] Circumvention tooling exists - patched automation builds, anti-detect browsers, TLS and canvas fingerprint spoofing - and this page deliberately links to none of it. Using it is deliberate circumvention of technical protection - the behaviour Amazon alleges in its suit against Perplexity (masquerading as Chrome, defeating a block within 24 hours; CNBC, 2026-03-10). An open-source project that ships anti-detect loses any claim to being ethical and exposes its users to bans. This project neither documents nor implements it.

### What the marketplace terms say, and how the project handles it

**Project decisions.** Allegro's Terms (Regulamin, edition effective 2026-09-01, read 2026-09-03 in a logged-in browser session) prohibit the use of bots and other software tools while using Allegro, in connection with using it, or in order to use it (art. 10.11; the tool types listed there - traffic-generating, malware and attack tools - are examples, not the whole scope), prohibit scraping of Allegro data for reuse in one's own business or in other services (art. 10.10), state that automated solutions, in particular login-triggering software, are used at the user's own risk (art. 2.8), and let Allegro apply mechanisms that block such tools (art. 8). No clause naming orders placed "without human participation" was found in the primary text, so that wording is not attributed to the Regulamin here; a secondary report (xyz.pl, 2025-09-15) covers Allegro's tightened REST API key rules effective 2025-09-23 (max 5 keys, no sharing, a 50,000 PLN contractual penalty); a sentence in that article about a ban on unattended orders describes Shopify's anti-bot strategy, not Allegro's, so it is not used here as evidence about Allegro. An AI agent driving the user's own browser may fall under art. 10.11. Allegro publishes no buyer-side purchase API in its public developer documentation (as of 2026-08-31). See also [marketplaces.md](marketplaces.md), section 1.4. The project states this plainly and leaves the decision to each account holder:

- The project default completes checkout and payment inside the purchase mandate the user has signed (see [mandate-spec.md](mandate-spec.md)).
- A human-confirm ("human confirms payment") mode is available as an optional configuration flag.
- Each account holder decides and accepts the risk for their own account. The agent acts under the user's login, and the user is the accountable party.
- Operating rules: a real, logged-in Chrome profile on the user's machine; one action at a time and personal (not commercial) volumes as load-and-respect rules, not as a way to stay unnoticed; one account; honest agent identification (Web Bot Auth) where a site accepts it.

The project does not obscure what the terms say, does not disguise the agent and does not attempt to defeat any platform control; it documents the terms and leaves the decision to each account holder.

### How often does a legitimately operating personal agent hit challenges?

- **Supports:** [fact] The FP-Agent study (arXiv 2605.01247, 2026) found that AI browsing agents run in real browsers and are hard to tell apart by browser fingerprint: Cloudflare detected only 1 of 7 agents. A real profile, a home IP and real cookies present nothing synthetic to detect: no datacenter IP, no forged fingerprint.
- **Partially refutes:** [fact] the same FP-Agent study detects all 7 agents by behavioural fingerprints - typing timings, scrolling and mouse movement distinguish agents from humans and from each other. [vendor claim] Fingerprint.com advertises commercial AI-agent detection (Fingerprint docs). [reported] Amazon says it identified and blocked Comet traffic at scale (CNBC, 2026-03-10).
- **Verdict** [hypothesis]: a personal agent in a real profile on a home IP presents nothing synthetic to detect, so it currently meets few challenges; FP-Agent-class behavioural detection will spread, and the project does not rely on going unnoticed. Every challenge is a stop condition handed to the user; honest identification (Web Bot Auth) will be enabled once implemented and where a site accepts it; human pace is a load-and-respect rule (section 3, items 2 and 5), not a way to evade behavioural analytics. The challenge count is recorded to measure user friction, not detectability.

The project treats this as a hypothesis to keep re-testing in the field: every CAPTCHA or anti-bot challenge is recorded in the append-only audit log next to bank 3DS / SMS challenges; how often the bank challenges a purchase made under the mandate on the user's saved card or Allegro Pay at small amounts is the first MVP metric (see [payments.md](payments.md)).

## 3. Project policy

1. **Official channel first.** Today neither Allegro nor OLX offers a buyer-side channel for third-party agents (the Allegro ChatGPT app is OpenAI's own surface and hands the purchase to allegro.pl; both Partner APIs are seller-side). The moment either platform opens one, it replaces browser automation for the operations it covers. The project monitors both.
2. **Default execution = the user's local browser:** the user's Chrome profile, login, IP and machine. The agent is the user's hands, acting at human pace, meaning one action at a time, no parallel sessions, no request bursts and personal, not commercial, volumes; the agent does not simulate human input patterns.
3. **Honest identification where it is accepted.** Roadmap: implement Web Bot Auth / signed agents (RFC 9421) and enable signing on sites that recognize it (status 2026-08-31: planned, not implemented in the MVP; see section 1). Never forge the User-Agent.
4. **Hard "never" list (not in the repository):** anti-detect browsers, fingerprint spoofing, residential or rotating proxies, automatic CAPTCHA bypass or CAPTCHA-solving services, headless farms, parallel scraping, input-pattern simulation (mouse jitter, typing cadence, randomised timing) whose purpose is to defeat behavioural detection. A CAPTCHA or anti-bot challenge means stop and hand over to the user.
5. **Respect for the platform:** honour rate limits and robots policies for logged-out access, no mass catalogue scraping; cache instead of hammering.
6. **Transparency and accountability:** the user is informed that actions run under their account and that a ban risk exists (the Allegro ToS prohibit bots and other software tools while using Allegro, art. 10.11, and let Allegro block them, art. 8); the agent's action log is available to the user.
7. **Quarterly review:** the landscape (Web Bot Auth adoption, agent lanes, behavioural detection) changes faster than the code.

### Out of scope forever

Regardless of how the landscape moves, the following will never be part of Agentic Shopping Autopilot, its site skills or its registry (see [registry.md](registry.md)):

- fingerprint spoofing of any kind (TLS, canvas, navigator or other);
- CAPTCHA-solving services or automatic CAPTCHA bypass;
- proxies - residential, rotating or datacenter - used to hide the user's real network;
- anti-detect browsers and patched "stealth" automation builds;
- headless browser farms and parallel scraping sessions;
- input-pattern simulation (mouse jitter, typing cadence, randomised timing) whose purpose is to defeat behavioural detection.

A site skill submitted to the registry that contains any of these is rejected on review.

### How this fits autonomy and challenges

**Project decisions.** Autonomy means everything except challenges. The AI shopping agent completes checkout and presses the pay button on its own inside the purchase mandate (template: [../examples/PURCHASE_MANDATE.template.md](../examples/PURCHASE_MANDATE.template.md)). A human is involved only for:

- the bank's own 3DS / SMS challenge (PSD2 / SCA - unavoidable; how often the bank challenges a typical purchase made under the mandate is the first MVP metric, see [payments.md](payments.md)). The agent never splits, sizes, times or routes purchases to fall under an SCA exemption, and never enters an OTP or 3DS response; every challenge is completed by the account holder in the bank's own channel. The metric exists only to estimate user friction;
- a CAPTCHA or anti-bot challenge, a forced logout or a re-authentication request;
- any deviation from the mandate.

The agent never tries to solve, skip or automate any of these. The full list of stop triggers, the threat model and the handling of secrets live in [security.md](security.md); the overall design is in [architecture.md](architecture.md).

## Sources

All URLs accessed 2026-08-31 unless a later date is given. The Amazon v. Perplexity rulings are US case law and do not transfer to PL/EU automatically.

- Akamai press release: https://www.akamai.com/newsroom/press-release/akamai-research-commerce-becomes-the-epicenter-for-ai-bot-attacks-and-agentic-fraud-in-2026 (2026)
- DataDome / TollBit via Businesswire: https://www.businesswire.com/news/home/20250728685477/en/ (2025-07-28)
- Cloudflare blog, signed agents: https://blog.cloudflare.com/signed-agents/
- Cloudflare docs, Verified Bots: https://developers.cloudflare.com/bots/concepts/bot/verified-bots/ (2026-07)
- Stellagent, Web Bot Auth / IETF overview: https://stellagent.ai/insights/web-bot-auth-cloudflare-ietf (2026)
- AWS docs, AgentCore Browser Web Bot Auth: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-web-bot-auth.html (2026)
- DataDome, Agent Trust Management: https://datadome.co/agent-trust-management/agentic-commerce-security/
- Digital Commerce 360, Akamai + Visa: https://www.digitalcommerce360.com/2025/12/17/akamai-visa-partner-fraud-prevention-agentic-commerce/ (2025-12-17)
- Arcjet blog, AI agent identification: https://blog.arcjet.com/user-agent-strings-to-http-signatures-methods-for-ai-agent-identification/ (2026)
- CNBC, Amazon court order vs Perplexity: https://www.cnbc.com/2026/03/10/amazon-wins-court-order-to-block-perplexitys-ai-shopping-agent.html (2026-03-10)
- Ninth Circuit opinion, Amazon v. Perplexity, No. 26-1444: https://cdn.ca9.uscourts.gov/datastore/opinions/2026/08/04/26-1444.pdf (2026-08-04)
- Engadget, injunction overturned: https://www.engadget.com/2230471/perplexity-has-successfully-overturned-amazon-injunction-on-its-ai-shopping-bot/ (2026-08-04)
- eMarketer, Perplexity Comet ruling: https://www.emarketer.com/content/perplexity-comet-amazon-ai-shopping-agents-ruling (2026-08-05)
- Digital Commerce 360, OpenAI checkout shift: https://www.digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/ (2026-03-06)
- CNBC, OpenAI agentic shopping: https://www.cnbc.com/2026/03/20/open-ai-agentic-shopping-etsy-shopify-walmart-amazon.html (2026-03-20) ; CNBC, ChatGPT shopping after Instant Checkout: https://www.cnbc.com/2026/03/24/openai-revamps-shopping-experience-in-chatgpt-after-instant-checkout.html (2026-03-24)
- digitalapplied, discover in AI, buy on site: https://www.digitalapplied.com/blog/ai-agentic-commerce-discover-in-ai-buy-on-site-2026 (2026)
- Enterprise DNA, ACP / Walmart Sparky: https://enterprisedna.co/resources/news/openai-agentic-commerce-protocol-walmart-sparky/ (2026)
- media.allegro.pl, Allegro + OpenAI: https://media.allegro.pl/457490-allegro-rozpoczyna-wspolprace-z-openai-i-wyznacza-nowe-standardy-innowacji-ai-w-e-commerce (2026-05)
- spidersweb.pl, Allegro ChatGPT app: https://spidersweb.pl/2026/05/allegro-chatgpt-aplikacja-zakupy-sztuczna-inteligencja.html (2026-05)
- obserwatorlogistyczny.pl, ChatGPT shopping on Allegro: https://obserwatorlogistyczny.pl/2026/05/13/chatgpt-zrobi-zakupy-na-allegro-sprawdz-jak-to-dziala-wideo/ (2026-05-13)
- Mastercard press release, Agent Pay: https://www.mastercard.com/us/en/news-and-trends/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai.html (2025-04-29)
- TechInformed, Visa agent payments: https://techinformed.com/visa-opens-one-integration-for-ai-agent-payments/ (2026)
- help.allegro.com, what the Allegro API is for: https://help.allegro.com/en/sell/a/what-you-can-use-the-allegro-api-for-k1wRoVjb9fj
- OLX Partner API docs: https://developer.olx.pl/api/doc
- xyz.pl, Allegro REST API rule changes (effective 2025-09-23): https://xyz.pl/allegro-wprowadza-cicha-rewolucje-ktora-uderzy-w-konkurentow-i-ai-zidentyfikowalismy-wiele-naduzyc/ (2025-09-15)
- Allegro Terms (Regulamin), edition effective 2026-09-01: https://allegro.pl/regulamin (read 2026-09-03 in a logged-in browser session; art. 2.8, 8, 10.10, 10.11)
- Allegro Pomoc, account suspension rules: https://allegro.pl/pomoc/dla-kupujacych/regulamin-allegro/kiedy-mozemy-zawiesic-twoje-konto-lub-ograniczyc-jego-funkcjonalnosc-VEB4O7l3GHo
- FP-Agent study, arXiv 2605.01247: https://arxiv.org/abs/2605.01247 (2026)
- Fingerprint.com docs, AI agents: https://docs.fingerprint.com/docs/ai-agents

---
Part of [Agentic Shopping Autopilot](../README.md) by Andrii Shramko — code Apache-2.0, docs CC BY 4.0. Contact and collaboration: see the repository README.
