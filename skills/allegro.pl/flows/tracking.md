# Flow: tracking
1. Allegro has no purchase-history API → sources: the "Moje zakupy" page in the session + email notifications (if mailbox access is connected).
2. Check the status: once a day until "delivered"; the shipment number and the Paczkomat go into the report to the user.
3. "Delivered" → final entry in the audit log, close the item in the report.
Edge cases: the seller has not shipped within 3 days → notify the user (opening a dispute is for a human only); a review request → skip (not the agent's job).
