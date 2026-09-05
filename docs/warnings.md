# What can go wrong — an honest list

Agentic Shopping Autopilot is alpha software that spends your money. This page is not legal advice and it is not exhaustive. **Anything not on this list can still go wrong; the project promises stops and logs, not outcomes.** Last reviewed: 2026-09-05.

## Money

- **A wrong item within your limits is yours.** The agent verifies seller, price, condition and cart lines before paying, but a mismatch can slip through. The mandate limits (per item, per order, aggregate) are your real protection; set them to what you can afford to lose to a bug.
- **There is no hard cap on your card.** The software enforces the mandate; the bank enforces nothing on its side unless you configure it. Consider a card limit in your banking app.
- **Duplicate orders.** The runtime never retries a declined or timed-out payment, but an unpaid duplicate cart can remain on the marketplace. Check "my orders" after any interrupted run.
- **Price changes between search and checkout**, auto-added services or insurance in the cart, and personal free-delivery thresholds that differ from the public ones. Any deviation from the approved plan is a stop, never a silent pay.
- **One-time approvals** above the limits are typed by you in chat; a signed ceiling bounds them. Do not pre-allow those commands in your agent harness.

## Marketplace account

- **Allegro terms of service** (edition of 2026-09-01, read from the primary source): art. 2.8 — automated solutions are used at the user's risk; art. 10.10 — extraction of Allegro data by bots or software is prohibited; art. 10.11 — use of bots and other programming tools in connection with Allegro is prohibited; art. 8 lets Allegro block such tools and suspend accounts. An AI agent driving your browser can fall under these clauses. **Possible outcome: temporary or permanent account restriction, loss of loyalty status, ratings and history.** The author accepted this risk for his own account; decide for yourself.
- **Buy-now-pay-later rails** score account and device behaviour. Agent sessions may raise fraud scores; community reports describe long blocks.
- **Re-login, two-factor prompts, "new device" warnings** are stop triggers. Wiping a browser profile loses the trusted-device binding and re-triggers bank and bot checks.

## Bank

- **3-D Secure / strong customer authentication is required by law periodically** (PSD2). The agent cannot and will not complete it; you get a push and a few minutes. Expect it more on first purchases, new devices and larger amounts. Measured frequency so far: one purchase, no challenge — a sample of one.
- Bank-transfer redirects and one-time codes (BLIK) are incompatible with autonomy; only a saved one-click card or an in-platform pay-later rail works.

## Browser and bot protection

- Marketplaces run bot protection (DataDome on Allegro). Fresh, headless or datacenter browsers are blocked almost instantly. The project **does not and will not bypass it**: a block page or CAPTCHA is a stop handed to you. Behavioural fingerprinting of agents keeps improving; "a real profile passes today" is a window, not a guarantee.
- The verified channel is the Claude in Chrome extension inside your own logged-in Chrome. A vendor update can change what the extension is allowed to click, overnight.
- Chrome updates can break the dedicated-profile channel (remote debugging) without warning.

## Site changes

- Selectors break silently when a site changes its markup. `selectors.yaml` carries `last_verified` dates and some entries marked `TODO-verify`; a broken step ends in a stop, and a repaired selector must be re-verified by a human.
- Product cards group several sellers' offers; quantity and variant pickers are only partially automated.

## Your knowledge store

- **Wrong facts in your notes become wrong purchases.** A stale size, an outdated printer model or a quantity norm from last year is trusted as fact. Keep the notes the agent reads current, and read the assumptions it prints.
- The context brief and the shopping profile are plain text on your disk (git-ignored). Addresses, locker codes, phone numbers and tax IDs are filtered out, but keep secrets out of the notes it reads, and never share `runtime/.state/`.

## Prompt injection

- Product titles, descriptions, seller messages and images are untrusted input. Defence in depth (redacted snapshots, action allowlist, domain allowlist, secrets outside the model context, stop triggers) reduces the risk; it does not make it zero.

## Model and vendor policies

- No vendor policy forbids purchases you authorised, but models refuse when consent is not visible in context. The mandate makes consent explicit; it does not guarantee that a future model version behaves the same.
- The project rejects "ignore your policy" style prompts by design. If a model refuses, the answer is a clearer mandate, not a jailbreak.

## Unpredictable

- Marketplace policy changes, bank velocity rules, extension permission changes, regional regulation of agent browsing, delivery and refund flows that are not automated, sellers who cancel or ship the wrong thing.

## When it goes wrong

1. Stop the agent (create `MANDATE_REVOKED` next to the mandate; close the browser tab).
2. Open the marketplace order page and check what was actually ordered and paid.
3. Contact the seller or open a marketplace dispute; the transaction is yours legally.
4. Freeze the card in your banking app if you suspect misuse.
5. Report the incident (redacted) so the stop triggers can be improved.

## Known limitations (2026-09-05)

| Area | Status |
|---|---|
| Live purchases | one real end-to-end autonomous payment (Allegro.pl, under 50 PLN, saved card, no bank challenge) |
| Runtime CLI vs live purchase | the purchase was driven through the browser extension by the agent session; the `asa checkout` steps did not execute that payment yet |
| Marketplaces | Allegro.pl only; OLX.pl planned (native escrow flow) |
| Payment rails | saved one-click card verified; in-platform pay-later not tested |
| Allegro API search | blocked until the maintainer's app is verified by Allegro; search runs in the browser |
| Operating systems | Windows 10 verified; macOS and Linux should work, unverified |
| Agents | Claude Code + Claude in Chrome verified; Codex, Cursor, Gemini CLI follow the same protocol, unverified |
