# Flow: cart
1. `add_to_cart` (or `buy_now` for a single-item purchase — then go straight to checkout).
2. Check the cart contents: exactly that item, that quantity, that price. Any "auto-added" item/service (purchase protection, additional warranty) → remove.
3. `cart_go_checkout`.
Invariant: cart total ≤ the mandate's per-purchase limit AND (total + already spent) ≤ the cumulative limit.
Edge cases: the "add more for free shipping" popup — ignore unless it is beneficial by final price; a multi-seller cart — split into separate orders.
