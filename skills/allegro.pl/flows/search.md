# Flow: search
Preconditions: a valid mandate has been read; the criteria (query, budget, category) are known.
1. CHANNEL A (priority): API `GET /offers/listing` (query, category, price range, sort) → JSON of offers. If 403 (no verification) → channel B.
2. CHANNEL B: browser → `search_input` → query → `search_submit` → if needed `filter_smart`, price filter per the mandate.
3. Normalization of each offer: {id, title, price, shipping cost, Smart?, seller rating, number of sales, url}.
4. Ranking: (price+shipping) ↑, seller rating ≥98%, Smart preferred.
Postcondition invariant: ≥1 offer within the mandate limit; otherwise — report "not found within budget", no purchase.
Edge cases: 0 results → broaden the query with synonyms (1 attempt) → report; cookie consent popup → accept and continue.
