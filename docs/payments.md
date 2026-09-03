# Payments: what an AI agent can actually pay with in Poland (PSD2, SCA, cards, Allegro Pay)

This page maps every payment instrument an AI shopping agent could realistically use for autonomous checkout on Polish marketplaces (Allegro, OLX) as of 2026-08-31, and explains why PSD2 Strong Customer Authentication (SCA / 3DS) makes a *periodic* human challenge unavoidable. It ends with the payment architecture the Agentic Shopping Autopilot project adopted for its MVP: the user's existing saved one-click card and/or Allegro Pay, with the purchase mandate limit enforced by the agent plus an append-only audit log rather than by a card hard cap.

Evidence tags: **[fact]** (with source and date), **[vendor claim]**, **[hypothesis]**, **[general knowledge]** (well-established mechanics with no single primary source), **[reported]** (a third party's estimate or account, not verified by the project). Research date: 2026-08-31. Related pages: [architecture.md](architecture.md), [mandate-spec.md](mandate-spec.md), [security.md](security.md), [marketplaces.md](marketplaces.md).

## Questions this page answers

- Can an AI agent pay for a purchase on Allegro or OLX by itself, without a human typing a card number or a BLIK code?
- When does PSD2 / SCA force a 3DS challenge, and can an AI shopping agent avoid or automate it?
- Are Visa Intelligent Commerce, Mastercard Agent Pay, AP2 or x402 usable for agentic commerce in Poland today?
- Which payment method should an autonomous shopping agent use in Poland, and how is the purchase mandate limit enforced?

## 1. Map of payment options for a user in Poland

### 1.1 Revolut — disposable (single-use) virtual cards
- A disposable card is destroyed after every payment and its number regenerates; maximum 5 payments per 24 h; it **cannot be saved in a shop account or used for repeat charges** — [fact] (help.revolut.com "My single-use virtual card isn't working"; techcrunch.com 22.03.2018; confirmed in current Revolut help, Aug 2026).
- Revolut 3DS is a push in the app with 5 minutes to confirm; 3DS cannot be switched off — [fact] (help.revolut.com "What is 3D Secure", 2026).
- **Conclusion for an agent:** a disposable card does not fit a "saved card in Allegro" scheme (the number changes). Usable only for one-off checkouts where the user is on hand for a possible 3DS push. Low autonomy.

### 1.2 Revolut — regular virtual card with a spending limit
- Each virtual card can carry its own monthly/weekly/daily spending limit; transactions above the limit are declined — [fact] (help.revolut.com "Setting a monthly spending limit", 2026).
- The card can be frozen/unfrozen in one tap and deleted instantly — [fact] (revolut.com/cards/virtual-card, 2026).
- "Trusted merchant" feature: if a payment was declined without 3DS, the merchant can be added as trusted — [fact] (help.revolut.com, 2026). This lowers the decline rate but does NOT disable 3DS.
- A 3DS challenge requires the user's phone (push in the Revolut app); the agent cannot pass it by itself — [fact] (help.revolut.com "What is 3D Secure", 2026: the challenge is a push to the Revolut app on the user's phone).
- Revolut is a participant in Visa's live European agentic-payments pilot (July 2026) — [fact] (see 2.3), i.e. a first candidate for "native" agentic payment once the programme becomes generally available.

### 1.3 Virtual / prepaid cards of Polish banks
- **PKO BP:** virtual card in IKO/iPKO with a changeable CVV — [fact] (zaradnyfinansowo.pl review 2025–2026; pkobp.pl).
- **ING:** virtual prepaid VISA topped up by transfer, top-up limit about 20 000 zł; the card balance is a hard spending ceiling — [fact] (zaradnyfinansowo.pl, 2025–2026).
- **mBank:** eKarta — a virtual card for online payments with its own separate balance — [fact] (zaradnyfinansowo.pl, 2025–2026).
- **Pekao:** card details in Pekao24, prepaid cards with a separate limit — [fact] (pekao.com.pl, 2026).
- 3DS in all Polish banks is a confirmation in the bank's mobile app or by SMS; it cannot be disabled (PSD2 requirement) — [fact] on the requirement (PSD2, Directive (EU) 2015/2366, art. 97; Commission Delegated Regulation (EU) 2018/389, the RTS on SCA), [general knowledge] on the app / SMS mechanics.
- **Advantage for an agent:** a prepaid card (ING / mBank eKarta) gives a "physical" limit equal to the loaded balance — the bank will not let the agent spend more, whatever the agent does. This is the strongest hard cap among card options.

### 1.4 Stripe Issuing
- Commercial issuing is available in the EEA (Poland included); **consumer issuing is US-only**. In Poland cards can be issued only to a business, including a JDG / sole proprietorship — [fact] (docs.stripe.com/issuing; support.stripe.com "How to Apply for Issuing", 2026).
- For a user who runs a business this is the most programmable option: `spending_controls` (amount and MCC category limits) and real-time authorization webhooks, so the agent's own code can approve or decline every authorization — [fact] (docs.stripe.com/issuing/how-issuing-works, 2026).
- Stripe Issuing delivers the 3DS one-time code by SMS to the cardholder's phone (e-mail is a US-only option; EU / UK cardholders must have a phone number on file) — [fact] (docs.stripe.com/issuing/3d-secure, 2026). The project treats every bank challenge as human-only: no OTP or challenge ever enters the agent's context or is handled by the agent (see [security.md](security.md)).
- Drawback: not for a non-technical user; requires a Stripe business account.

### 1.5 BLIK
- Classic BLIK: a one-time 6-digit code from the bank app, valid about 2 minutes — **fundamentally incompatible with agent autonomy**, because a live human generates the code in the banking app — [fact] (blik.com; rankomat.pl, 2026).
- **BLIK Płatności Powtarzalne** (recurring): Model A — automatic charges without user involvement (fixed amount / schedule); Model M — confirmation in the bank app every time. The first transaction is always authorized with a BLIK code — [fact] (blik.com/platnosci-powtarzalne; tpay.com/blog, 2026).
- Allegro is among the 100+ partners of BLIK recurring payments; since 2026 OpenAI subscriptions are paid this way too (8 banks) — [fact] (allegro.pl/kampania/blik; gsmmaniak.pl, 2026).
- One-click BLIK on Allegro: only after activation and **only on "trusted devices"**; from another device a confirmation in the bank app is required; PKO BP customers got it first — [fact] (blik.com press release; allegro.pl/kampania/blik, 2026).
- **Conclusion for an agent:** Model A is designed for fixed-amount subscriptions, not arbitrary purchases of varying amounts; one-click BLIK is bound to a trusted device, so it works only if the agent drives the browser/session on that device. Partial autonomy, dependent on the bank's velocity rules.

### 1.6 PayU / Przelewy24 / P24NOW
- PayU is Allegro's payment operator; the saved card ("PayU Express" / one-click) is stored at PayU (KNF licence) — [fact] (allegro.pl/pomoc; allegro.pl/kampania/plac-karta, 2026).
- PayU itself tries to apply SCA exemptions at authorization; on a soft decline it initiates a challenge and retries the authorization — [fact] (developers.payu.com/europe/docs/card-payments/threeds, 2026). The card issuer always has the final word.
- P24NOW (Przelewy24 + Santander Consumer) is NOT a virtual card but a revolving credit limit up to 10 000 zł / 54-day deferral / instalments (BNPL) — [fact] (przelewy24.pl/aktualnosci, 2026). Onboarding and confirmations go through the bank; it adds no value for an autonomous agent.

### 1.7 Allegro Pay
- Credit limit 500–4200 zł tied to the Allegro account; 30-day deferral (RRSO 0%) or instalments — [fact] (allegro.pl/metody-platnosci/allegro-pay; akredo.pl, 2026).
- Purchase confirmation is risk-scored per transaction: **often no confirmation at all**, sometimes an SMS code; biometrics can replace SMS in the app; there is a "do not require SMS" option (with the caveat "we may still ask sometimes") — [fact] (allegro.pl/pomoc "Allegro Pay FAQ"; cashless.pl "autoryzacja kodem z SMS-a nie zawsze potrzebna"; spolecznosc.allegro.pl, 2025–2026).
- **Conclusion for an agent:** inside a logged-in Allegro session the agent can usually pay with Allegro Pay in one click and will occasionally hit an SMS to the user's phone. The user's card is never exposed. This is not a "card against the whole internet" but a limit confined to Allegro — an ideal risk container for an MVP.

### 1.8 Card saved in the Allegro account (one-click)
- "Płać kartą jednym kliknięciem": the card is saved via PayU and later payments take one click with no bank login and no codes; it is activated explicitly and works **on trusted devices** — [fact] (allegro.pl/kampania/plac-karta; ehandel.com.pl, 2026).
- The issuing bank may request 3DS (SMS / app) on any transaction — [fact] (allegro.pl/pomoc "Jak zapłacić kartą").
- [hypothesis] (plausible, needs a field test): for a saved card on a trusted device and amounts below 100–200 zł the challenge fires rarely — PayU actively uses TRA / low-value exemptions, and the whole "one-click" proposition is built on the absence of codes. The PSD2 counters (5 transactions / 100 EUR cumulative, see 2.1) guarantee periodic challenges.

### 1.9 Google Pay / Apple Pay
- Require device unlock / biometrics on the user's device for every payment — [general knowledge] (FIDO / device-bound token mechanics). An agent without the user's physical device cannot complete the payment. Autonomy close to zero.
- 2026 nuance: in April 2026 Visa updated its rules to allow pass-through wallets in agentic transactions — [fact] (interaktywnie.com, 07.2026) — but this concerns future agentic rails, not today's Google Pay.

### 1.10 OLX
- Payment in "Kup z Przesyłką OLX": card, BLIK, Apple/Google Pay, fast transfer — [fact] (pomoc.olx.pl, 2026). OLX has no Allegro-grade "one-click on a saved card" (no public materials found; searched 08.2026).
- **Conclusion:** OLX has no saved-method rail. In the MVP the agent runs the native "Kup z Przesyłką OLX" escrow flow up to the payment step, and the payment step is expected to involve the user's own confirmation (card entry with a possible 3DS challenge, a BLIK code or a transfer authorisation all happen on the user's side, never from the agent's context). One-time BLIK codes cannot be produced by the agent. See [marketplaces.md](marketplaces.md).

## 2. PSD2 / SCA and the card-network programmes

### 2.1 When SCA is mandatory, and the exemptions
- SCA (two factors) is mandatory for payer-initiated electronic payments in the EEA — [fact] (PSD2 RTS, in force since 2019; ravelin.com SCA guide, 2025).
- **Low-value:** up to 30 EUR (about 130 zł) may go without SCA, BUT the issuer keeps counters: after 5 consecutive low-value transactions or 100 EUR cumulative, a challenge is mandatory — [fact] (pci-proxy.com "SCA Exemptions Under PSD2", 2025; docs.datatrans.ch).
- **TRA (Transaction Risk Analysis):** up to 100 / 250 / 500 EUR depending on the acquirer's / issuer's fraud rate — [fact] (ravelin.com, 2025). PayU one-click lives on TRA.
- **Trusted beneficiaries:** the user whitelists a merchant at the issuer — the exemption exists in the regulation, but Polish issuing banks practically offer no UI for it — [fact] on the regulation (pci-proxy.com, 2025), [hypothesis] on Polish practice (no Polish bank with this feature found, searched 08.2026; Revolut has the "trusted merchant" surrogate).
- **MIT (merchant-initiated):** out of SCA scope, but setting up the mandate (first transaction) requires SCA — [fact] (docs.datatrans.ch; developer.nexigroup.com, 2025). This is the legal basis of "sign once, charged automatically afterwards" (BLIK Model A, subscriptions).
- **Recurring fixed amounts:** SCA only on the first payment — [fact] (same sources).
- The issuer always has the final word: it may reject the exemption (soft decline) and demand a challenge — [fact] (developers.payu.com; checkout.com docs, 2026).

### 2.2 What this means for an agent
An autonomous agent with a saved card lives in an "exemption corridor": amounts below 30 EUR are almost always frictionless, up to about 100 EUR often frictionless via TRA, but **a periodic 3DS challenge cannot be eliminated** (counters plus the issuer's right to challenge). The MVP architecture therefore must have a "call the human" channel: a push to the user saying "confirm 3DS in your bank app". That is about 10 seconds of involvement per challenge, not involvement in every purchase.

**Bottom line (08.2026):** there is no fully autonomous, natively agentic payment rail available to an ordinary user in Poland: Visa (with mBank, PKO BP, Revolut) and Mastercard have run live agentic transactions in Europe, but for regular customers these remain pilots — hence the MVP relies on existing saved rails plus a human channel for challenges.

### 2.3 Visa Intelligent Commerce (VIC)
- Announced April 2025; in July 2026 Visa announced at the Payments Forum in Paris **live** (not test) agentic purchases at independent European merchants, backed by 30+ issuing banks — [fact] (visa.co.uk press release 3457328; paymentexpert.com, 02.07.2026; theindustryspread.com, 07.2026).
- **Poland is already inside:** mBank and PKO BP took part in the pilot; mBank completed the first transaction in Poland initiated by an AI agent; authentication via Visa Payment Passkeys; Revolut is on the list too — [fact] (pl.media.mbank.pl, 07.2026; bank.pl; isbtech.pl, 07.2026).
- "Visa Agentic Ready" programme: Visa's release lists issuers that "have completed live, agent-executed transactions" at participating merchants, including Barclays, BBVA, CaixaBank, Commerzbank, HSBC UK, ING, Klarna, Lloyds, **mBank**, Nationwide, **PKO Bank Polski** and **Revolut** — [fact] (visa.co.uk press release 3457328, 02.07.2026).
- For developers: Visa Acceptance Platform with Intelligent Commerce APIs, an MCP Server and an Agent Toolkit — **in pilot status, access by application through a Visa representative** — [fact] (developer.visaacceptance.com; corporate.visa.com "developer updates", 2026). The API includes enrol/tokenize of a customer's card for agentic transactions.
- Mechanics: agentic tokens bound to a mandate (limits, user instructions) — [vendor claim] (Visa Intelligent Commerce materials, 2026; exact page not recorded). "Mainstream adoption in 2026" — [vendor claim] (usa.visa.com press release "Visa and Partners Complete Secure AI Transactions, Setting the Stage for Mainstream Adoption in 2026", 18.12.2025); Visa's 08.04.2026 release on Intelligent Commerce Connect still describes it as "in pilot with select partners".
- **Bottom line:** an ordinary mBank / PKO / Revolut customer in Poland does NOT yet have the feature in the app (pilot only); a developer gets pilot access by application. GA horizon: end of 2026 – 2027.

### 2.4 Mastercard Agent Pay
- Announced April 2025; on 10.09.2025 Mastercard named Citi and U.S. Bank cardholders as the first to get Agent Pay and committed to enabling all US Mastercard cardholders by the 2025 holiday season (i.e. November 2025), with global rollout to follow — [fact] (mastercard.com press release, 10.09.2025).
- Europe: on 02.03.2026 Santander + Mastercard completed Europe's first live end-to-end agentic payment, processed through Santander's live payments infrastructure in a controlled environment (a pilot, not a commercial rollout); Worldline + ING + Mastercard ran a live payment in production; all European Mastercard issuers are enabled at network level — [fact] (Santander / Mastercard press release, 02.03.2026; Worldline / ING / Mastercard press release, 2026).
- March 2026 — Mastercard Agent Suite; 10.06.2026 — Agent Pay for Machines with 30+ partners (cards, stablecoins, layer-1 blockchains) — [fact] (investor.mastercard.com, 10.06.2026; fortune.com, 10.06.2026).
- Mechanics: Agentic Tokens built on card-on-file tokenization plus verifiable intent; the agentic transaction context is used in disputes; "agent registration + programmable spending rules" — [vendor claim] (mastercard.com/europe "Agent Pay", 2026).
- No Polish issuer has announced consumer availability of Agent Pay (searched 08.2026); network-level enablement has not yet surfaced as a feature a Polish cardholder can use — [fact] about absence (searched 08.2026).

### 2.5 Liability (both networks)
- [vendor claim]: an agentic transaction carries a cryptographic binding "user mandate – agent – token", which gives the issuer grounds for a chargeback review of "the agent bought the wrong thing"; the formal liability-allocation rules are not publicly finalized — as of 08.2026 no detailed public rulebooks were found — [fact] about absence (searched 08.2026). The risk of a wrong purchase in the MVP has to be closed by limits, not by hoping for the networks.

## 3. AP2, x402 and stablecoins

### 3.1 AP2 (Agent Payments Protocol, Google + 60 partners)
- Announced 16.09.2025; partners include Mastercard, PayPal, AmEx, Adyen, Worldpay, Coinbase — [fact] (cloud.google.com/blog, 16.09.2025).
- Model: three cryptographically signed mandates as W3C Verifiable Credentials — **Intent Mandate** (what to buy and within which bounds) -> **Cart Mandate** (approval of a specific cart) -> **Payment Mandate** (payment instruction) — [fact] (ap2-protocol.org; github.com/google-agentic-commerce/AP2, 2026).
- SDK: an official Python SDK in the repo (code/sdk/python/ap2), an open spec and a Google Codelab (Next'26) — [fact] (github.com/google-agentic-commerce/AP2, 2026).
- **Production acceptance:** only a handful of real merchants accept AP2 payments (mostly pilot integrations over Stripe / Coinbase rails); no Polish merchant or PSP (PayU, P24, Tpay) is on the partner list — [fact] about absence (AP2 partner list, checked 08.2026).
- **Assessment:** a working standard as a spec and SDK, but it is an agent-to-merchant protocol — Allegro and OLX do not accept it. In the MVP, AP2 is applicable only as an internal purchase-mandate format (intent / cart / payment), not as a payment rail. The project's mandate format is described in [mandate-spec.md](mandate-spec.md) and the template in [PURCHASE_MANDATE.template.md](../examples/PURCHASE_MANDATE.template.md).

### 3.2 x402 and stablecoins — a future branch
- x402 (Coinbase, May 2025; Foundation with Cloudflare): HTTP 402 plus stablecoins for machine payments; Stripe "Machine Payments" (preview) since 10.02.2026; integration with AP2 and Visa Trusted Agent Protocol (TAP) — [fact] (coindesk.com, 11.03.2026; Stripe / x402 announcements, 02.2026).
- Real volumes are tiny: CoinDesk estimated volumes at about $28k/day and characterised roughly half as test or inflated traffic — [reported] (coindesk.com, 11.03.2026).
- **Hypothesis: zero applicability in Polish retail today (no counter-evidence found).** Neither Allegro, nor OLX, nor any Polish PSP was found to accept stablecoins / x402 (searched 08.2026). The branch is parked until demand appears.

## 4. Payment schemes compared

The research compared four generic setups. Scheme C is adopted as MVP rail #2 (section 6); schemes A, B and D remain alternatives other users may pick for their own account.

General findings that apply to every card-based scheme:
- 3DS cannot be disabled on any card — [fact] (PSD2 art. 97; RTS (EU) 2018/389); one-click on a saved card is built on SCA exemptions and is usually frictionless — [fact] on the PayU mechanics, [hypothesis] on the frequency.
- A card saved for one-click must be a regular card, NOT a disposable one — a disposable card regenerates its number after every payment and cannot be saved at all — [fact], see 1.1.
- "Rarely" is not "never": the PSD2 counters (5 transactions / 100 EUR) guarantee a periodic challenge, so an escalation channel to the user is mandatory.
- What to expect: challenges are rarer below the 30 EUR low-value threshold and within TRA limits, and one-click works only on a device the user has trusted. The user activates one-click on their own device and browser profile (the same profile the agent later drives). The project never splits an order into smaller payments to stay under a threshold and never tries to influence issuer risk scoring; the trusted-beneficiary exemption is used only where the issuer itself offers it.

### 4.1 Scheme A — dedicated virtual card with a spending limit (e.g. Revolut) + one-click on Allegro
Create a regular virtual card, set a monthly limit; save it in the Allegro account and activate "płatność jednym kliknięciem" in the user's own browser profile that the agent later drives (one payment with a 3DS confirmation to bind it); the agent pays one-click and on a 3DS challenge notifies the user to confirm the push. Autonomy: high (about 80–95% of purchases without a human — [hypothesis], field test mandatory). Safety: high (card limit, one-tap freeze, card not linked to the main account). Simplicity: high.

### 4.2 Scheme B — maximum hard cap: prepaid virtual bank card
ING wirtualna karta prepaid / mBank eKarta loaded with exactly N zł, then as in scheme A; spending more than the balance is physically impossible. Autonomy: as A (3DS via the bank app; slightly more frequent challenges than Revolut — [hypothesis]). Safety: maximum. Simplicity: medium (bank account required; more setup steps in the bank app than in Revolut).

### 4.3 Scheme C — no card at all: Allegro Pay inside the session
Activate Allegro Pay (limit 500–4200 zł, one SMS); the agent works in the logged-in Allegro session and pays with Allegro Pay; risk scoring usually passes without confirmation, sometimes an SMS to the user; the user settles one Allegro Pay bill monthly. Autonomy: medium-high (SMS is unpredictable — [hypothesis]). Safety: high (limit confined to Allegro, no card exposed). Simplicity: maximum. Drawback: Allegro only, does not work for OLX; legally it is credit.

### 4.4 Scheme D — for a technical user with a JDG / company: Stripe Issuing
A card with programmatic `spending_controls` plus a real-time authorization webhook: the agent's code decides on every authorization. The only scheme where limits and rules are executed by code rather than a bank UI. Requires a business and an integration; the bank's 3DS challenge still goes to the human, as in every other scheme (see 1.4).

### 4.5 Horizon (6–12 months): Visa Intelligent Commerce through Polish banks
Watch for GA: when Agentic Ready reaches the consumer apps of mBank, PKO BP and Revolut (all three completed live agent-executed transactions in the July 2026 programme, see 2.3), the MVP should migrate to agentic tokens with native mandates (limit and categories at network level plus clarity on liability). Developer access to the Visa Acceptance pilot is by application. The project intends to apply for the Visa Acceptance developer pilot (developer.visaacceptance.com) now, ahead of GA, so the migration path is ready when Agentic Ready reaches Polish bank apps.

## 5. Summary table

| Payment method | Agent autonomy | What happens on 3DS / confirmation | Loss cap | Setup effort | Project verdict |
|---|---|---|---|---|---|
| Existing saved one-click card in the marketplace account (PayU) | High ([hypothesis]: rare challenges below 100–200 zł; PSD2 counters guarantee periodic ones) | Bank push / SMS to the user | Mandate limit enforced by the agent + audit log (no card hard cap) | None — already saved | **MVP default rail #1** |
| Allegro Pay (limit 500–4200 zł) | Medium-high | Sometimes an SMS to the user's phone | Limit confined to Allegro, no card | Minimal (about 5 min) | **MVP default rail #2**, Allegro only |
| Dedicated virtual card with limit (e.g. Revolut) + one-click Allegro | High (80–95%*) | Push to the user in the card app, about 10 s | Card limit N zł/month, one-tap freeze | Low (about 10 min) | Alternative other users may choose |
| Prepaid bank card (ING / mBank eKarta) | High | Push / SMS in the bank app | Hard cap = card balance | Medium | Alternative with the strongest hard cap |
| Revolut disposable card | Low | Not saveable, 5 payments/day | Minimal | Low | Not usable as a saved card |
| BLIK one-time code | Zero | A human is needed for every payment | — | — | Incompatible with autonomy |
| BLIK recurring (Model A) | High, but fixed subscriptions only | Code the first time, then automatic | Managed in the bank app | Low | Not for arbitrary purchases |
| Stripe Issuing (JDG / company) | Maximum (code approves authorizations) | SMS one-time code to the cardholder's phone (human-only, see 1.4) | Programmatic spending_controls | High (business + API) | Advanced alternative for business users |
| P24NOW | Low | Bank confirmations | Limit up to 10 000 zł | Medium | BNPL, gives no autonomy |
| Google Pay / Apple Pay | Close to zero | Biometrics on the device | — | — | Not usable |
| Visa Intelligent Commerce (mBank / PKO / Revolut) | Full by design | Passkey mandate instead of 3DS | Mandate: limit + categories at network level | Pilot, by application | Target architecture 2027 |
| AP2 mandates | — (Allegro / OLX do not accept) | — | Cryptographically signed mandates | SDK open | Internal mandate format only |
| x402 / stablecoins | — | — | — | — | Zero in Polish retail (no evidence found, 08.2026) |

\* estimate — [hypothesis], requires a field measurement of challenge frequency.

## 6. MVP payment architecture adopted by the project

Project decisions (final, 2026-08-31). They override any contrary conclusion in the research above.

1. **Rails = the user's existing payment methods already saved in the marketplace account.** Rail #1: the one-click saved card (PayU). Rail #2: Allegro Pay in the logged-in session. OLX has no saved-method rail: the agent runs the native "Kup z Przesyłką OLX" escrow flow up to payment, and in the MVP the payment step is expected to involve the user's own confirmation (see 1.10 and [marketplaces.md](marketplaces.md)). No new cards, no new services, no virtual or disposable cards are part of the recommendation — schemes A, B and D in section 4 remain alternatives other users may choose for their own account.
2. **Autonomy = everything except challenges.** The agent completes checkout and presses the pay button inside the purchase mandate (see the checkout flow of the Allegro site skill: [SKILL.md](../skills/allegro.pl/SKILL.md), [flows/checkout.md](../skills/allegro.pl/flows/checkout.md)). A human is involved only for the bank's own 3DS / SMS challenge (PSD2, unavoidable — see 2.2), a CAPTCHA / anti-bot challenge ([anti-bot-policy.md](anti-bot-policy.md)), or any deviation from the mandate. A "human confirms every payment" mode exists only as an optional config flag, not as the default.
3. **Challenges are a feature, not a bug.** Any 3DS / SMS challenge -> push to the user ("confirm in your bank app", about 10 seconds). The agent never bypasses or automates 3DS, CAPTCHA or anti-bot checks. One-time BLIK codes are excluded: a human generates the code, which is physically incompatible with autonomy.
4. **The mandate limit is enforced by the agent + an append-only audit log, not by a card hard cap.** Because the rail is an existing card or Allegro Pay, there is no bank-side cap dedicated to the agent; the purchase mandate ([mandate-spec.md](mandate-spec.md), [PURCHASE_MANDATE.template.md](../examples/PURCHASE_MANDATE.template.md)) carries the limit and every purchase attempt is logged. The per-item cap is a loss-limiting parameter derived from the shopping goal. Smaller amounts happen to see fewer challenges (see 2.1), but whether an exemption applies is decided by the issuer and acquirer; the project does not choose caps to steer that decision and never splits an order (see section 4).
5. **First and most important MVP metric: field-measured challenge frequency.** How often the bank fires a 3DS / SMS challenge on the saved card or Allegro Pay at small amounts determines the real share of purchases with zero human involvement. The 80–95% figure in section 4 is a hypothesis until this measurement exists.
6. **Secrets never enter the LLM context, git or logs.** Card data, cookies and OTP codes live only in the OS keychain / the real logged-in browser profile; reports are redacted. Details in [security.md](security.md). The agent runtime (Claude Code, Codex or another agent harness, see [execution-stack.md](execution-stack.md)) drives the user's own browser profile at human pace.
7. **Marketplace terms.** Allegro's Terms (Regulamin, edition effective 2026-09-01, read 2026-09-03 at https://allegro.pl/regulamin; main text only, attachments (Załączniki) and earlier editions not checked) prohibit the use of bots and other software tools while using Allegro, in connection with using it or in order to use it (art. 10.11; the listed tool types — traffic-generating, malicious and attack tools — are examples, not the whole scope), prohibit the extraction (scraping) of Allegro data for reuse in one's own business or in other services (art. 10.10 b.i), let Allegro apply mechanisms that block such tools (art. 8), and state that automated solutions, in particular login-triggering software, are used at the user's own risk (art. 2.8). The main text contains no clause that names orders placed "without human participation"; a secondary report (xyz.pl, 2025-09-15) covers Allegro's tightened REST API key rules effective 2025-09-23 (max 5 keys, no sharing, a 50,000 PLN contractual penalty); a sentence in that article about a ban on unattended orders describes Shopify's anti-bot strategy, not Allegro's, so it is not used here as evidence about Allegro (see [marketplaces.md](marketplaces.md)). Art. 10.11 (software tools used while using Allegro) is the clause most relevant to an AI agent driving the user's own browser, which may fall under it. Allegro offers no buyer purchase API. The project does not disguise the agent and does not attempt to defeat any platform control; its default completes payment inside the mandate, an optional human-confirm flag exists, and each account holder decides and accepts the risk for their own account. Operating rules: the user's own logged-in browser profile, human pace as a load-and-respect rule, one account per user. See [marketplaces.md](marketplaces.md).
8. **Horizon.** When Visa Intelligent Commerce reaches Polish bank apps, the project intends to migrate to agentic tokens with native mandates; the Visa Acceptance developer-pilot application is to be filed now, ahead of GA (see 4.5).

## Sources (URLs, access date 2026-08-31)

**Visa Intelligent Commerce / European pilot**
- https://www.visa.co.uk/about-visa/newsroom/press-releases.3457328.html (press release, 02.07.2026)
- https://paymentexpert.com/2026/07/02/visa-agentic-payments-merchants-eu/ (02.07.2026)
- https://theindustryspread.com/visa-agentic-payments-live-30-european-issuers/ (07.2026)
- https://pl.media.mbank.pl/463919-zakupy-na-zlecenie-ai-mbank-i-visa-maja-juz-za-soba-pierwsza-transakcje-zainicjowana-przez-agenta-ai (07.2026)
- https://bank.pl/mbank-i-pko-bp-w-gronie-europejskich-bankow-bioracych-udzial-w-eksperymentalnych-zakupach-z-agentem-ai-od-visa/ (07.2026)
- https://developer.visaacceptance.com/products/intelligent_commerce.html (pilot docs, 2026)
- https://corporate.visa.com/en/sites/visa-perspectives/innovation/visa-mcp-server-agent-acceptance-toolkit.html (2026)

**Mastercard Agent Pay**
- https://www.mastercard.com/news/europe/en/newsroom/press-releases/en/2026/worldline-ing-and-mastercard-complete-a-live-end-to-end-european-agentic-payment-in-production/ (2026)
- https://www.santander.com/en/press-room/press-releases/2026/03/santander-and-mastercard-complete-europes-first-live-end-to-end-payment-executed-by-an-ai-agent (02.03.2026; read 2026-09-03)
- https://www.mastercard.com/news/europe/en/newsroom/press-releases/en/2026/santander-and-mastercard-complete-europe-s-first-live-end-to-end-payment-executed-by-an-ai-agent/ (02.03.2026, Mastercard copy of the same release)
- https://investor.mastercard.com/investor-news/investor-news-details/2025/Mastercard-Unveils-New-Tools-and-Collaborations-to-Power-Smarter-Safer-Agentic-Commerce/default.aspx (10.09.2025; Citi / U.S. Bank first, all US cardholders by the 2025 holiday season; read 2026-09-03)
- https://www.mastercard.com/news/eemea/en/newsroom/press-releases/en/2026/march-2026/mastercard-launches-agent-suite-as-the-agentic-ai-era-reshapes-digital-commerce/ (03.2026)
- https://investor.mastercard.com/investor-news/investor-news-details/2026/Mastercard-Launches-Agent-Pay-for-Machines-to-Unlock-Super-Fast-Always-On-Payments/default.aspx (10.06.2026)
- https://www.mastercard.com/europe/en/business/artificial-intelligence/mastercard-agent-pay.html (2026)
- https://fortune.com/2026/06/10/mastercard-ai-payments-protocol-launch-agentic-finance/ (10.06.2026)

**PSD2 / SCA**
- https://www.pci-proxy.com/blog-posts/sca-exemptions-under-psd2-a-practical-guide-for-payment-teams (2025)
- https://www.ravelin.com/blog/sca-transaction-optimization-guide-exemptions (2025)
- https://docs.datatrans.ch/docs/psd2-compliance (2025)
- https://developers.payu.com/europe/docs/card-payments/threeds/introduction/ (2026)
- https://eur-lex.europa.eu/eli/dir/2015/2366/oj (PSD2, Directive (EU) 2015/2366, art. 97 on SCA) — [general knowledge] reference; canonical ELI URL, not re-fetched by the project
- https://eur-lex.europa.eu/eli/reg_del/2018/389/oj (Commission Delegated Regulation (EU) 2018/389, RTS on SCA and exemptions) — [general knowledge] reference; canonical ELI URL, not re-fetched by the project

**AP2 / x402**
- https://github.com/google-agentic-commerce/AP2 (2026)
- https://ap2-protocol.org/ (2026)
- https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol (16.09.2025)
- https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet (11.03.2026)

**Revolut / banks / Allegro / BLIK / PayU / OLX**
- https://help.revolut.com/en-US/help/card-payments-withdrawals/getting-started-with-card-payments/changing-card-security-settings/setting-a-monthly-spending-limit/ (2026)
- https://help.revolut.com/en-US/help/cards/card-issue/my-disposable-virtual-card-is-not-working/ (2026)
- https://help.revolut.com/help/card-payments-withdrawals/help-with-a-transaction/what-is-3d-secure-payment-authorisation/ (2026)
- https://www.revolut.com/cards/virtual-card/ (2026)
- https://zaradnyfinansowo.pl/wirtualna-karta/ (2025–2026)
- https://allegro.pl/kampania/plac-karta (2026)
- https://allegro.pl/kampania/blik (2026)
- https://allegro.pl/metody-platnosci/allegro-pay (2026)
- https://allegro.pl/pomoc/dla-kupujacych/allegro-pay/allegro-pay-najczesciej-zadawane-pytania-0K6dOBv7ohb (2026)
- https://www.cashless.pl/9883-allegro-pay-wyzszy-limit-zmiany-w-autoryzacji (2025–2026)
- https://www.blik.com/platnosci-powtarzalne (2026)
- https://tpay.com/blog/platnosci-powtarzalne-blik-modele (2026)
- https://www.przelewy24.pl/aktualnosci/nowa-metoda-platnosci-limit-p24now-od-przelewy24 (2026)
- https://pomoc.olx.pl/hc/pl/articles/360012241920 (2026)
- https://docs.stripe.com/issuing ; https://docs.stripe.com/issuing/3d-secure (3DS delivery by SMS / e-mail; read 2026-09-03) ; https://support.stripe.com/questions/how-to-apply-for-issuing (2026)
- https://allegro.pl/regulamin (Allegro Regulamin, edition effective 2026-09-01; main text read 2026-09-03 in a logged-in browser session; attachments (Załączniki) not checked)
- https://eco.com/support/en/articles/15192001-what-is-mastercard-agent-pay-ai-agent-commerce-protocol-in-2026 (Agent Pay overview, 2026 — general background only, not the source for the US rollout dates)
- https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.21961.html (Visa, 18.12.2025 — "Visa and Partners Complete Secure AI Transactions, Setting the Stage for Mainstream Adoption in 2026"; read 2026-09-03)
- https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22276.html (Visa, 08.04.2026 — Intelligent Commerce Connect, "in pilot with select partners"; does not carry the "mainstream adoption" quote)

**Cited inline by domain only** (the exact article URL was not recorded at research time; treat these citations as weaker than the URL-listed ones): interaktywnie.com (Visa pass-through wallets, 07.2026); isbtech.pl (mBank / Visa pilot, 07.2026); akredo.pl (Allegro Pay limits, 2026); ehandel.com.pl (Allegro one-click card, 2026); rankomat.pl (BLIK code validity, 2026); gsmmaniak.pl (OpenAI subscriptions via BLIK, 2026); spolecznosc.allegro.pl (Allegro Pay SMS authorization threads, 2025–2026); checkout.com docs (issuer soft declines, 2026); developer.nexigroup.com (MIT / SCA, 2025); pkobp.pl and pekao.com.pl (virtual / prepaid cards, 2026); techcrunch.com (Revolut disposable cards, 22.03.2018).

---
Part of [Agentic Shopping Autopilot](../README.md) by Andrii Shramko — code Apache-2.0, docs CC BY 4.0. Contact and collaboration: see the repository README.
