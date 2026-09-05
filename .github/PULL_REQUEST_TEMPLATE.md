# Pull request

## What and why

<!-- One paragraph. Link the issue if there is one. -->

## Type

- [ ] Site skill (new shop or fixed selectors)
- [ ] Runtime change (mandate / context gate / checkout / audit)
- [ ] Knowledge-store adapter
- [ ] Docs
- [ ] Tests / fixtures

## Verification

- [ ] `cd runtime && npm test` is green (attach the count)
- [ ] `npm run typecheck` is green
- [ ] Site-skill changes were verified by a human in a real logged-in browser on `YYYY-MM-DD` (channel: extension / dedicated profile) — no order numbers or account data in this PR
- [ ] Money-touching change: maintainer re-run requested

## Redaction checklist

- [ ] No `config.env`, `PURCHASE_MANDATE.md`, `runtime/.state/`, `audit-*.jsonl`, browser profiles or screenshots with addresses or payment forms
- [ ] No names, phone numbers, locker codes, tax IDs; sellers replaced with placeholders unless the seller is the point of the fix
- [ ] English only (marketplace UI strings quoted in their language where they are data)

## Sign-off

- [ ] Commits are signed off (`git commit -s`, Developer Certificate of Origin)
