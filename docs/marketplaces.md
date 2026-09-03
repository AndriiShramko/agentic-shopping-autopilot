# Allegro.pl and OLX.pl from a buying agent's perspective: APIs, terms, flows

This page documents what an AI shopping agent can and cannot do on the two Polish marketplaces the project targets first, Allegro.pl (marketplace) and OLX.pl (classifieds): which official APIs exist for a buyer, how the native purchase flows work, what the platform terms and anti-bot stacks look like, and which channels the Agentic Shopping Autopilot MVP uses on each site. It is a research digest (access date 2026-08-31; Allegro's Regulamin re-read on 2026-09-03) with every claim tagged as [fact], [vendor claim], [hypothesis], [community reports] or [reported], followed by the project's final channel decisions for autonomous checkout under a purchase mandate.

## Questions this page answers

- Can an AI shopping agent buy something on Allegro through the official REST API, or is the API seller-only?
- Does OLX.pl have a buyer API, and how can an agent complete a purchase there with escrow protection?
- What do Allegro's and OLX's terms say about bots and automated purchasing, and how does this project handle that risk?
- Which channel does the MVP use on each marketplace, and at which exact step does a human have to step in?

## Method note

Direct access to several primary sources (developer.allegro.pl, developer.olx.pl, allegro.pl/pomoc, media.allegro.pl, datadome.co) was not available during the research; those are cited through search snippets, GitHub threads and secondary publications. The exception is Allegro's Terms (Regulamin): the edition effective 2026-09-01 was read directly at https://allegro.pl/regulamin in a logged-in browser session on 2026-09-03, and every reference to its articles on this page follows that text (main text; attachments were not checked). The OLX terms were not read directly. Tags: **[fact]** = verified against a source, **[vendor claim]** = a company statement or marketing, **[hypothesis]** = the project's own interpretation, **[community reports]** = user forum threads (not a platform statement), **[reported]** = a journalist's account. Where a source could not be fetched directly, the tag says so.

## 1. Allegro REST API through a buyer's eyes

### 1.1 What the API can do at all

- Allegro REST API is the only official API (the legacy WebAPI is switched off). Authorization is **OAuth 2.0 only**: authorization code and device flow for user tokens, client_credentials for resources not tied to a user. Since 2021-01-11 production enforces strict scope checks: no scope in the token means HTTP 403. [fact]
- Known scopes: `allegro:api:orders:read`, `allegro:api:orders:write`, `allegro:api:profile:read/write`, `allegro:api:sale:offers:read/write`, `allegro:api:billing:read`, `allegro:api:payments:read/write`, `allegro:api:bids`, `allegro:api:ratings`, `allegro:api:disputes`, `allegro:api:messaging`, `allegro:api:ads`, `allegro:api:campaigns`, `allegro:api:sale:settings:*`. Almost all of them are seller scopes. [fact]

### 1.2 What a buyer actually gets

| Capability | Via official API? | Notes | Tag |
|---|---|---|---|
| Offer search (`GET /offers/listing`, `GET /sale/products`, categories, parameters) | Formally yes | Returns `403 Access denied. Access available only for verified applications` until Allegro manually **verifies the application**; a steady stream of 403 complaints and verification requests through 2025 (GitHub issues #5643, #4667, #10902, #11788, #11792) | [fact] |
| Verification for a "buys on behalf of the user" shopping agent | Unknown | Verification is granted per declared use case; a buying agent is not a listed use case | [hypothesis] |
| Auction bids (`GET /bidding/offers/{offerId}`, `PUT /bidding/offers/{offerId}/bid`, scope `allegro:api:bids`) | Documented, but reported unavailable | The **only** buyer-side transactional operation documented in the API: read current price and end time, place a bid as the logged-in buyer. In March 2026 developers reported "Funkcja niedostępna" from the bid endpoint (GitHub issue #13148); verify before relying on it | [fact] for the documentation; [reported] for the outage |
| "Kup teraz" (buy now), cart, checkout, buyer payment | **No** | Community and Allegro maintainers have confirmed for years that a buyer gets only `licytacja` (bidding); GitHub discussion #5394 opened 2022-02 and was still open on 2026-08-20, when an Allegro maintainer replied that the question would be passed to the Moje zakupy team | [fact] |
| Buyer purchase history ("Moje zakupy") | **No** | No endpoint; the internal, undocumented endpoint the web UI uses for "Moje zakupy" is not covered by any OAuth scope and is officially unavailable; requested since 2022 (76+ votes), not delivered | [fact] |
| `GET /order/checkout-forms` | Seller-side | Despite the name, this lists orders received by a seller, not a buyer's checkout | [fact] |
| Unofficial MCP wrappers (e.g. "Allegro MCP Server": orders and watched items via a personal account, OAuth device flow) | Same limits | They hit the same API boundaries: little to read, nothing to buy | [fact] |

### 1.3 Allegro Pay, Allegro Smart, affiliate

- **Allegro Pay** (buy-now-pay-later / deferred payment) exists only in the web UI and mobile app; there is no API for a buyer to initiate a payment, and the `allegro:api:payments:*` scopes concern seller payouts. Allegro analyses "account, device and transaction behaviour; atypical activity leads to a temporary payment block". [fact]
- **Allegro Smart** is a free-delivery subscription bound to the buyer account; it is applied automatically at checkout in the UI and is not represented in the API. [fact]
- **Allegro Affiliate (Business)** is the official partner programme: CPS model, deep links, 24-hour cookie, last click; the REST API exposes `GET /affiliate/conversions/cps` (beta) for conversion exports. It is a "bring traffic, earn commission" channel, not a purchase channel. For an agent it is a fully legitimate way to build offer links and hand the user over to the Allegro UI. [fact]

### 1.4 Allegro x OpenAI (2026) and the Agentic Commerce Protocol

- On 2026-05-11 Allegro announced a strategic partnership with OpenAI: an AI assistant in the mobile app, a browser shopping-assistant pilot (with Google), and seller and marketing tools. [vendor claim]
- The **"Allegro" app inside ChatGPT** (an evolution of the Allegro GPT tested since December 2025) offers conversational search, product cards (price, photo, rating) and cart building; the **"Kup na Allegro" button redirects the user to Allegro** for payment and delivery choice. Checkout does **not** happen in ChatGPT. [fact]
- **Instant Checkout / ACP:** OpenAI launched Instant Checkout on the Agentic Commerce Protocol (with Stripe) in September 2025 and **wound it down: announced 2026-03-04/05 (Digital Commerce 360, 2026-03-06), fully wound down by 2026-03-24 (CNBC)** [fact]; Forbes (2026-03-10) reported low conversion (roughly one third of a click-out to the merchant site for Walmart) and tax, fraud-screening and stock-sync issues as the reasons [reported]; OpenAI moved to a discovery-first model: find in chat, buy at the merchant. [fact]
- **Conclusion on the ACP channel:** the Allegro x OpenAI partnership opened no programmatic purchase channel, neither for ChatGPT (checkout stays on allegro.pl) nor for third-party agents such as Claude Code and similar agents. Allegro has no public agent API or ACP endpoint. [fact as of 2026-08-31]. Google's Universal Commerce Protocol / Universal Cart and Perplexity Instant Buy do not include Allegro so far (no confirmation found). [hypothesis about the future]
- Allegro's Terms (Regulamin, edition effective 2026-09-01, read 2026-09-03 in a logged-in browser session) prohibit the use of bots and other software tools while using Allegro, in connection with using it, or in order to use it (art. 10.11; the tool types listed there are examples, not the whole scope), prohibit the extraction (scraping) of Allegro data for reuse in one's own business or in other services (art. 10.10), state that automated solutions, in particular login-triggering software, are used at the user's own risk (art. 2.8), and let Allegro apply mechanisms that block such tools (art. 8). [fact] Secondary reports (e.g. xyz.pl, 2025-09-15, which also covers the September 2025 tightening of the REST API rules) describe this as a ban on automated ordering; the primary text contains no clause that names orders placed without human participation. [reported] Allegro's own agent lanes (the ChatGPT app, the AI Assistant) stop at search and cart and redirect checkout to allegro.pl [fact], and DataDome challenges requests it classifies as automated with a 403 or a CAPTCHA [vendor claim]. The project does not try to get past any of these controls. It acts only inside the user's own logged-in session, stops on any DataDome or CAPTCHA challenge, and treats art. 10.11 as a terms question that each account holder decides and accepts for their own account (see 3.3).
- Allegro's own **"Allegro AI Assistant BETA"** is available only to users logged in to the mobile app, under its own terms of use; per the late-2025 announcement it did not handle payments. [fact]

For the wider agentic-commerce picture (AP2, ACP, Visa and Mastercard agent programmes) see [landscape.md](landscape.md).

## 2. OLX.pl

### 2.1 API

- The official **OLX Partner API** (developer.olx.pl / developer.olxgroup.com) is available only to approved partners: application, OLX verification, then an API key. Functions: publishing and managing listings (jobs, cars, electronics and other categories) and **messaging** (threads/messages: read threads, mark as read, reply in chat). It is a tool for sellers and integrators (e.g. Baselinker), not for buyers. [fact]
- **A buyer API (search, purchase, payment, buyer-side chat) does not exist.** There is no public search API either; an undocumented internal JSON endpoint is used by scrapers, without guarantees and with a blocking risk; the project does not use it. [fact about the absence of an official API]

### 2.2 Purchase flow with "Przesyłka OLX" (escrow)

Where the seller has enabled delivery (the **"Kup z Przesyłką OLX"** button), the purchase is a form flow and chat is **not** required. [fact]

1. On the listing page: "Kup" -> "Kup z Przesyłką OLX".
2. Form: buyer details, pickup point (InPost Paczkomat / Poczta / courier), payment by the methods OLX documents for this flow (card, BLIK, Apple/Google Pay, fast bank transfer; see [payments.md](payments.md) 1.10). The money goes to the **escrow account of the payment operator** (PayU), not to the seller.
3. The seller must confirm the sale **within 72 hours**, otherwise the money is refunded automatically.
4. Tracking in "Twoje przesyłki / Kupujesz".
5. After receipt: "Przedmiot jest OK" releases the money to the seller; "Mam problem" opens the "Pakiet Ochronny" protection (empty parcel, item not as described).

All five steps: [fact].

### 2.3 Where chat is required (v2, not in MVP)

- Chat is required when the seller has not enabled Przesyłka OLX (contact or pickup only), when bargaining is expected ("do negocjacji"), when condition or completeness must be clarified, or in categories without delivery (cars, real estate, bulky items). [fact]
- Mass or templated messages and suspicious links trigger automatic account blocking. [fact]
- **Project decision:** the MVP has **no chat or negotiation module**. Listings that require chat are skipped and reported to the user. Chat is planned for v2 with human escalation; the research suggests short, specific questions in Polish (examples, not a script: "Czy przedmiot jest jeszcze dostępny?", "Czy cena do negocjacji?", "Czy możliwa Przesyłka OLX?"), no links, one conversation at a time with no bulk outreach, each message written for that specific listing and shown to the user before it is sent, never taking the deal off-platform, every agreement shown to the user before confirmation, bargaining only within the user-set limit, and asking the seller to enable Przesyłka OLX once terms are agreed. [hypothesis / recommendation]

## 3. Anti-bot and risks

### 3.1 Allegro

- Allegro is protected by **DataDome**; the source for the deployment is DataDome's own customer case study (protection against scraping, credential stuffing, vulnerability scanning). [vendor claim, taken as sufficient evidence of the deployment]
- DataDome challenges requests it classifies as automated with a 403 or a CAPTCHA (DataDome's own product materials); when that happens this project stops and hands the step to the user. [vendor claim]
- Terms: Allegro's Regulamin (edition effective 2026-09-01, read 2026-09-03) prohibits the use of bots and other software tools while using Allegro, in connection with using it, or in order to use it (art. 10.11), prohibits the extraction (scraping) of Allegro data and information, in particular with bots, for aggregation and reuse in one's own business or in other services (art. 10.10), states that automated solutions, in particular login-triggering software, are used at the user's own risk (art. 2.8), and lets Allegro apply mechanisms or tools that block such bots and tools (art. 8). [fact] Secondary reports describe this as a ban on automated ordering; the primary text contains no clause that names orders placed without human participation. [reported] An AI agent driving the user's own browser may fall under art. 10.11. [hypothesis]
- Auction automation: third-party bid snipers exist and community threads report no enforcement against them on the main Allegro [community reports], although art. 10.11 covers bots generally [fact]; the official `PUT /bid` endpoint exists [fact] but was reported unavailable in 2026-03 (issue #13148; see 1.2); snipers are blocked on Allegro Lokalnie, and in "Kolekcje i antyki" bids above 1000 zł require SMS confirmation [community reports]. The project bids only through the official endpoint.
- **User risks:** (a) account block if Allegro treats the agent as a tool under art. 10.11, with atypical activity tracked by device and behaviour [fact for the tracking; the classification is a hypothesis]; (b) **Allegro Pay is the most sensitive node**: "atypical activity leads to a temporary payment block" [fact], community threads report long-term Allegro Pay blocks attributed by users to risk scoring [community reports; the scoring attribution is a hypothesis], and agent sessions with unusual fingerprints raise the fraud score [hypothesis]; (c) loss of rating and Smart benefits after cancellations of orders an agent placed by mistake [hypothesis]; (d) contractual exposure under the accepted terms, which each account holder assesses for their own account [hypothesis].

### 3.2 OLX

- No publicly named anti-bot vendor for olx.pl (unlike Allegro / DataDome); scrapers report IP blocks, rate limits and CAPTCHAs; an in-house OLX Group stack plus standard WAF mechanisms is likely. [fact about the absence of public attribution] [hypothesis about the stack]
- OLX terms are reported to prohibit automated data extraction; accounts are blocked for spam messages, mass actions, "podejrzane linki", multi-accounting (one account per email) and "atypical activity"; IP addresses are blocked automatically. [fact for the blocking reasons: pomoc.olx.pl] [reported for the extraction clause: secondary publications; the OLX regulamin was not read directly]
- **User risks:** account block (together with deal history and reputation), freezing of active Przesyłka transactions, automatic IP block, phone or document verification on appeal [fact]; plus money held in escrow in a disputed deal initiated by an agent [hypothesis about the scenario].

### 3.3 Paths available to an agent, and their status

1. **Official API.** Allegro: search (after application verification), auction bids, affiliate conversions. OLX: partner seller API only. [fact]
2. **Affiliate.** Allegro Affiliate (CPS): the agent legitimately monetises "found it, gave the link, the user bought it". OLX has no public affiliate programme of this type. [fact]
3. **Web Bot Auth** (Cloudflare + IETF, draft-meunier-web-bot-auth-architecture-05 dated 2026-08-18; an IETF WebBotAuth working group exists): cryptographic signing of agent requests (Ed25519, RFC 9421 HTTP Message Signatures, `Signature-Agent` header). Supported by Cloudflare, AWS WAF (November 2025), Akamai, Vercel; Anthropic, OpenAI and Perplexity agents sign their requests; it underpins Visa TAP and Mastercard Agent Pay. [fact about the standard] **But** neither Allegro's DataDome stack nor OLX has publicly announced accepting Web Bot Auth, so it is not yet a pass on these sites. [fact about the absence of announcements]
4. **Agent-friendly programmes.** Allegro's only approved agent channels are its own AI Assistant and the Allegro app in ChatGPT (checkout still on Allegro). Neither Allegro nor OLX has a programme for third-party agents. [fact as of 2026-08-31]
5. **The user's own browser.** The agent drives the user's ordinary logged-in session on the user's machine (real browser profile, the user's own machine and network connection, human pace). Allegro's Terms prohibit bots and other software tools while using Allegro (art. 10.11) and state that automated solutions are used at the user's own risk (art. 2.8); an AI agent driving the user's own browser may fall under art. 10.11, and secondary reports describe the terms as a ban on automated ordering. The project default completes payment inside the mandate; a `human-confirm` option exists; each account holder decides and accepts this risk for their own account (see the project position below). [hypothesis / risk assessment]

### Project position on the marketplace terms

Allegro's Terms (Regulamin, edition effective 2026-09-01, read 2026-09-03) prohibit the use of bots and other software tools while using Allegro (art. 10.11) and scraping of its data for reuse (art. 10.10), and state that automated solutions are used at the user's own risk (art. 2.8); secondary reports describe this as a ban on automated ordering. An AI agent driving the user's own browser may fall under art. 10.11. Allegro provides no buyer purchase API and OLX provides no buyer API at all. The project does not disguise the agent and does not attempt to defeat any platform control; it documents the terms and leaves the decision to each account holder:

- **Default behaviour:** the agent completes checkout and presses the pay button **inside the purchase mandate** (see [mandate-spec.md](mandate-spec.md) and [../examples/PURCHASE_MANDATE.template.md](../examples/PURCHASE_MANDATE.template.md)). A human is involved only for the bank's own 3DS/SMS challenge (PSD2 / SCA, unavoidable), a CAPTCHA or anti-bot challenge, or any deviation from the mandate.
- **Optional mode:** a `human-confirm` configuration flag makes the user press the final pay button; it exists for users who prefer it and is **not** the default.
- **Reading:** Allegro's art. 10.10 prohibits scraping its data for reuse, and OLX's terms are reported to prohibit automated data extraction. The project prefers the official Allegro API for search; in the browser it reads only the pages the user's own session displays, for that user's single purchase decision, with no storage beyond the audit log, no republication and no bulk crawling. The residual risk is the account holder's.
- **Responsibility:** each account holder decides and accepts this risk for their own account. The project does not bypass anti-bot, CAPTCHA or 3DS, does not spoof fingerprints, and uses no proxies, anti-detect browsers or headless farms (see [anti-bot-policy.md](anti-bot-policy.md)).
- **Hygiene mitigations:** a real, logged-in Chrome profile on the user's machine; human pace and a few purchases per day as load-and-respect rules, not as a way to stay unnoticed; one account; honest agent identification (Web Bot Auth) where a site accepts it.

## 4. Recommended MVP channels and scriptable steps

| Step | Allegro.pl | OLX.pl |
|---|---|---|
| Search | REST API `GET /offers/listing` after application verification; browser SERP as fallback, reading only what the user's own session displays (see "Reading" in the project position) | Listing pages in the user's browser via URL parameters, human pace, no bulk extraction (see "Reading" in the project position) |
| Selection | Agent ranks and picks within the mandate | Agent ranks and picks within the mandate; only listings with "Kup z Przesyłką OLX" |
| Checkout | User's real logged-in browser profile (Playwright/CDP) | User's real logged-in browser profile |
| Payment rail | Existing saved one-click card via PayU and/or Allegro Pay [hypothesis: availability and challenge frequency are the first MVP measurement, see "First MVP metric" below] | Native escrow flow (PayU escrow); no saved-method rail (see [payments.md](payments.md) 1.10) |
| Who presses pay | The agent, inside the mandate | The user, at the payment step. OLX has no saved-method rail: the agent runs the native "Kup z Przesyłką OLX" escrow flow up to the payment step; in the MVP that step involves the user's own confirmation (BLIK code, bank-transfer authorisation or card entry with a possible 3DS challenge, all on the user's side). Which methods the logged-in web checkout shows is recorded as an MVP field observation |
| Human involvement | Bank 3DS/SMS, CAPTCHA, mandate deviation | The same, plus the payment confirmation itself (BLIK code, bank-transfer authorisation or card entry), plus the post-delivery escrow decision |
| Chat / negotiation | n/a | None in MVP (v2 with human escalation) |
| Auctions | Official `GET /bidding/...` + `PUT /bid` | n/a |

### Allegro: hybrid "API for reading + the user's real browser for buying + agent pays inside the mandate"

Project decision: the channel is (1) search through the REST API after application verification, browser fallback; (2) purchase through Playwright/CDP on top of the user's own **existing** logged-in session on the user's own machine (the project never operates another account, another machine, a proxy or a modified browser, see [anti-bot-policy.md](anti-bot-policy.md)); (3) payment completed by the agent with the user's **already saved** methods (one-click card via PayU and/or Allegro Pay), with a human only on the bank's challenge; (4) auctions through the official bidding endpoints; (5) Allegro Affiliate links only in the hand-over flow (agent finds, user buys in the Allegro UI); whether the Affiliate terms permit commission on orders completed by the agent under a mandate is unverified [hypothesis], and the project does not claim it. No new cards or services are required. Virtual or disposable cards are a possible alternative, but the project does not recommend them. One-time BLIK codes are physically incompatible with autonomy (a human generates the code). The mandate limit is therefore enforced by the agent plus an append-only audit log, not by a card hard cap (see [payments.md](payments.md)).

Scriptable steps (the reference implementation lives in [../skills/allegro.pl/SKILL.md](../skills/allegro.pl/SKILL.md), [selectors.yaml](../skills/allegro.pl/selectors.yaml) and [flows/](../skills/allegro.pl/flows/); the format is described in [site-skill-spec.md](site-skill-spec.md)):

1. OAuth device flow, obtain a user token (scopes: `allegro:api:bids`, `allegro:api:profile:read`). The token lives in the OS keychain, never in LLM context, git or logs (see [security.md](security.md)).
2. Search: API listing (or the browser SERP) -> normalise offers (price, delivery, Smart, seller rating).
3. Rank against the mandate (limits, categories, delivery constraints) and pick the best match; anything outside the mandate is escalated to the user instead of guessed.
4. Browser: open the offer -> re-check price and availability -> "Dodaj do koszyka" / "Kup teraz".
5. Checkout: address from the account profile, delivery choice (Smart option when available), payment method = the saved one-click card or Allegro Pay already present in the account.
6. Pay: the agent verifies the final total against the mandate and presses **"Kupuję i płacę"** itself. If the bank raises a 3DS/SMS challenge, the agent pauses and hands exactly that step to the user, then resumes. With the optional `human-confirm` flag the user presses the button instead.
7. Post-purchase: tracking from email notifications (there is no "Moje zakupy" API) plus a redacted order screenshot in the append-only audit log and the purchase report.
8. Auctions: monitor `GET /bidding/...` and bid with `PUT /bid` according to the mandate's strategy (use the official endpoint; remember the SMS confirmation above 1000 zł in "Kolekcje i antyki").

**First MVP metric:** the field-measured frequency of bank challenges (3DS/SMS) on the saved card and on Allegro Pay at small amounts. It determines the real share of purchases completed with zero human involvement and is logged from day one.

Note the sensitivity of Allegro Pay (section 3.1): it is both an autonomy-friendly rail and the account's most fragile component, which is why the hygiene rules above are not optional.

### OLX: browser only, escrow-only flow, no chat module

Project decision: OLX has no API at all for a buyer, so the channel is the user's browser session, and deals are limited to **"Kup z Przesyłką OLX"** (PayU escrow, 72-hour seller confirmation, Pakiet Ochronny). OLX has no saved-method rail. The agent runs the native "Kup z Przesyłką OLX" escrow flow up to the payment step; in the MVP that step involves the user's own confirmation (BLIK code, bank-transfer authorisation or card entry with a possible 3DS challenge, all on the user's side; the documented methods are listed in [payments.md](payments.md) 1.10). Which methods the logged-in web checkout shows is recorded as an MVP field observation. Listings without delivery are out of MVP scope; chat and negotiation are v2 with human escalation.

Scriptable steps:

1. The user's logged-in session (the real browser profile, cookies stay inside it) on the user's own machine and network connection.
2. Search and filters through URL parameters -> parse listing cards (price, location, delivery badge).
3. Classification: "Kup z Przesyłką OLX" present -> transactional flow; absent -> skip and report (chat flow is v2).
4. Transactional: "Kup" -> form: buyer details, Paczkomat choice -> payment step. OLX has no saved-method rail: the agent completes everything up to the payment step and then hands that step to the user, whose own confirmation is expected in the MVP (BLIK code, bank-transfer authorisation or card entry with a possible 3DS challenge, all on the user's side; the documented methods are listed in [payments.md](payments.md) 1.10), and resumes once the payment is confirmed. Which methods the logged-in web checkout shows is recorded as an MVP field observation.
5. Wait for seller confirmation (72 h) -> track in "Twoje przesyłki".
6. Receipt: the escrow release ("Przedmiot jest OK" / "Mam problem") depends on physically inspecting the parcel, which the agent cannot do; the agent reminds the user and records the outcome in the audit log.
7. Hygiene: human pace, a few purchases per day, one account, no scraping bursts on the listing pages.

How these two channels plug into the shared runtime (mandate, audit log, kill switch, browser control) is described in [architecture.md](architecture.md) and [execution-stack.md](execution-stack.md); community-contributed site skills for other marketplaces are covered in [registry.md](registry.md).

## Conclusion

1. There is no programmatic **purchase** on Allegro through the official API and none is announced: a buyer gets auction bids (`PUT /bidding/.../bid`; documented, but reported unavailable in 2026-03, see 1.2) and, after manual application verification, offer search; "Kup teraz", checkout and payment are closed. [fact, GitHub and community threads 2022-2026]
2. The Allegro x OpenAI partnership (May 2026) produced an Allegro app in ChatGPT with search and cart, but checkout stays on allegro.pl; OpenAI wound down Instant Checkout (announced 2026-03-04/05, fully wound down by 2026-03-24; the ACP specification itself lives on); no channel for third-party agents was opened; in parallel Allegro's Terms (edition effective 2026-09-01) prohibit bots and other software tools while using Allegro (art. 10.11) and DataDome challenges requests it classifies as automated, so third-party agents get search only on Allegro's own lanes. The project does not try to get past any of these controls: it acts only inside the user's own logged-in session, stops on any DataDome or CAPTCHA challenge, and treats art. 10.11 as a terms question that each account holder decides and accepts for their own account (see 1.4 and 3.3).
3. OLX has no buyer API at all (the Partner API is seller-side: listings plus chat); a machine-driven purchase is possible only in the browser through "Kup z Przesyłką OLX" (PayU escrow, 72-hour seller confirmation, Pakiet Ochronny); everything else is chat.
4. MVP: Allegro is a hybrid (API search + the user's real browser + the agent paying with saved methods inside the mandate, human only on the bank's challenge); OLX is browser-only with the escrow flow, the user's own confirmation at the payment step, and no chat module. The asset to protect is the user's account and Allegro Pay: the user's own machine and network connection, native browser profile, human pace, one account, and an honest stance on terms and anti-bot rather than evasion.

## Sources

Access date for all sources: 2026-08-31, except https://allegro.pl/regulamin (edition effective 2026-09-01), read on 2026-09-03 in a logged-in browser session.

- https://developer.allegro.pl/documentation ; /about/ ; /tutorials/jak-obslugiwac-zamowienia-GRaj0qyvwtR (via search, 2026-08-31)
- https://developer.allegro.pl/news/scope-w-api-allegro-7Gzm9DLXPSX (via GitHub issue #3746)
- https://github.com/allegro/allegro-api/discussions/5394 (2022 -> 2026-08-20)
- https://github.com/allegro/allegro-api/issues/5643, #3746, #11752, #2480 (also #4667, #10902, #11788, #11792) ; https://github.com/allegro/allegro-api/issues/13148 (bidding endpoint "Funkcja niedostępna", March 2026)
- https://spolecznosc.allegro.pl/t5/dyskusje-kupujacych/api-dla-kupujacego-czy-mozna-pobierac-dane-o-zakupach-poprzez/td-p/973167 ; https://spolecznosc.allegro.pl/t5/dyskusje-kupujących/czy-instalowanie-botów-do-licytacji-jest-dozwolone/td-p/124181 ; https://spolecznosc.allegro.pl/t5/allegro-pay/dożywotnia-blokada-allegro-pay-po-rezygnacji-na-jakiej-podstawie/td-p/1172762 ; Allegro community forum threads 244728 ("Czy korzystanie z bota na licytacji jest dozwolone na Allegro?") and 263436 ("Snajper w Kolekcje i antyki powyżej 1000zł")
- https://allegro.pl/regulamin (Regulamin, edition effective 2026-09-01, read 2026-09-03; art. 2.8, 8, 10.10, 10.11) ; https://allegro.pl/programy-lojalnosciowe/allegro-affiliate ; https://allegro.pl/regulaminy/allegro-ai-assistant-beta-warunki-korzystania-g0BWD3BnqFE
- https://media.allegro.pl/457490-allegro-rozpoczyna-wspolprace-z-openai-i-wyznacza-nowe-standardy-innowacji-ai-w-e-commerce (2026-05-11) ; https://en.media.allegro.pl/457492-allegro-begins-collaboration-with-openai-to-set-new-standards-in-ai-driven-innovation-in-e-commerce (2026-05-11) ; https://media.allegro.pl/438127-allegro-wchodzi-na-chatgpt-najpopularniejsza-platforma-e-commerce-robi-kolejny-krok-w-swojej-ai-rewolucji (2025-12-04) ; https://interaktywnie.com/wielkie-zmiany-dla-sprzedajacych-i-kupujacych-na-allegro-chatgpt-zastepuje-wyszukiwarke/ (2026-05-13)
- https://openai.com/index/buy-it-in-chatgpt/ (2025-09) ; https://www.digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/ (2026-03-06) ; https://www.forbes.com/sites/jasongoldberg/2026/03/10/why-openais-checkout-retreat-spells-trouble-for-its-commerce-strategy/ (2026-03-10) ; https://www.cnbc.com/2026/03/24/openai-revamps-shopping-experience-in-chatgpt-after-instant-checkout.html (2026-03-24)
- Secondary reports on Allegro's terms (not primary text): https://xyz.pl/allegro-wprowadza-cicha-rewolucje-ktora-uderzy-w-konkurentow-i-ai-zidentyfikowalismy-wiele-naduzyc/ (2025-09-15; REST API rule tightening effective 2025-09-23 and a description of a ban on automated ordering) ; https://upselli.pl/blog/zmiany-regulamin-allegro-kwiecien-2026 (April 2026 amendments)
- https://www.cashless.pl/18066-allegro-chatGPT ; https://www.cashless.pl/18895-allegro-aplikacja-chat-gpt ; https://www.cashless.pl/17995-allegro-asystent-ai (2025-12 to 2026-05)
- https://lobehub.com/mcp/bilski311-allegro-mcp
- https://developer.olx.pl/artykuly/dostep-do-api ; https://developer.olxgroup.com/products ; https://pomoc.olx.pl/hc/pl/articles/360013434780 ; https://github.com/matasarei/olx-api-client-v2
- https://pomoc.olx.pl/olxplhelp/s/article/jak-działa-przesyłka-olx-V1-olx ; https://pomoc.olx.pl/hc/pl/articles/360012241920 ; https://blog.olx.pl/2020/11/26/sprzedawaj-z-dostawa-czyli-jak-dzialaja-przesylki-olx-instrukcja-dla-sprzedajacych/ (2020-11-26)
- https://pomoc.olx.pl/olxplhelp/s/article/komunikat-o-zablokowanym-koncie-V6-olx ; https://www.legalniewsieci.pl/aktualnosci/zablokowane-konto-na-olx-mogles-pasc-ofiara-oszustwa
- https://datadome.co/customers-stories/from-awareness-to-resilience-allegros-journey-with-datadome-against-bots/
- https://datatracker.ietf.org/doc/html/draft-meunier-web-bot-auth-architecture (draft 05, 2026-08-18) ; https://aws.amazon.com/about-aws/whats-new/2025/11/aws-waf-web-bot-auth-support
- Secondary sources also consulted (cited inline in the research digest, listed by domain): imazine.pl (2026-05-14) and omnichannelnews.pl (2026-05-11) on the partnership; tabletowo.pl and obserwatorlogistyczny.pl (2026-05-13) on the ChatGPT app; webinterpret.com, merchantcostconsulting.com, enterprisedna.co on the Instant Checkout shutdown; dataminers.pl on the OLX IP-block risk; rpms.pl and semcore.pl on the OLX terms; help.allegro.com on Smart; the Allegro Pomoc Allegro Pay FAQ; media.olx.pl.

---
Part of [Agentic Shopping Autopilot](../README.md) by Andrii Shramko — code Apache-2.0, docs CC BY 4.0. Contact and collaboration: see the repository README.
