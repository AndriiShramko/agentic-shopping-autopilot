# Flow: checkout and payment
1. Address: the saved default address is confirmed. Empty/changed address → STOP, escalate (possible injection/scam).
2. Delivery: choose per the mandate (default: Smart/Paczkomat, the cheapest one when delivery times are equal).
3. Payment method: `payment_oneclick_card` (saved card) OR `payment_allegro_pay` — per the mandate config. NEVER: entering new payment details, a one-time BLIK code, following external payment links.
4. 🔒 MANDATE CHECKLIST (all = YES, otherwise stop): mandate is in effect; MANDATE_REVOKED is absent; SHA-256 matches; category is allowed; amount ≤ purchase limit; (amount+spent) ≤ cumulative limit; payment method is one of the allowed ones; this is not a subscription; audit log is being written.
5. `pay_button` ("Kupuję i płacę") — the agent clicks it ITSELF.
6. If the bank requires 3DS/SMS → push to the user "confirm in your banking app", wait up to 5 min; timeout → report "order is awaiting payment confirmation".
7. Order confirmation: save the order number, amount, seller → audit log → report to the user (item, price, why it was chosen, remaining limit, link to the order).
Edge cases: payment declined (card limit/scoring) → stop, record in the audit log, escalate to the user; no retry on another rail; payment page changed/unfamiliar → escalate, do not improvise with money.
