# Contributing

Thank you for helping people's own AI agents shop safely. Contributions that matter most, in order:

1. **Site skills** — teach the agent a new shop (see `docs/site-skill-spec.md`).
2. **Selector fixes** — a marketplace changed its markup and a step broke.
3. **Knowledge-store adapters** — connect a new kind of notes store to the context-first module (`runtime/src/context/`).
4. **Docs and translations of docs** (English is the repository language; site UI strings are quoted in the site's language).
5. **Tests and fixtures** — synthetic pages under `runtime/tests/fixtures/`.

Everything else is welcome too. Open an issue first for anything that changes how money moves.

## Ground rules

- **English only** in prose, comments and commit messages. Marketplace UI strings (Polish, etc.) are quoted verbatim where they are data.
- **No secrets, no personal data, ever.** Before every push check that none of these are staged: `config.env`, `PURCHASE_MANDATE.md`, `runtime/.state/`, `audit-*.jsonl`, browser profiles, screenshots that show an address or a payment form. Run `git status` and read the diff.
- **Redact before sharing.** Use `asa audit:redact --month YYYY-MM` for logs; grep your files for names, phone numbers, locker codes, tax IDs; replace real sellers with placeholders unless the seller name is the point of the fix.
- **Never schedule automated runs against a live marketplace** from CI or a bot. Verification of a site skill is done by a human in their own browser (`last_verified` / `verified_by: human` in `SKILL.md`).
- **Tests stay green:** `cd runtime && npm test`. Add fixtures for anything that parses a page; raw pages go under the git-ignored `runtime/tests/fixtures/raw/`.
- **Sign your commits** with the Developer Certificate of Origin: `git commit -s`.

## Site-skill pull requests

1. Folder `skills/<host>/` with `SKILL.md` (frontmatter: `name` matching the folder, `description` that says what the skill does and when to use it, `license`, `last_verified`, `verified_by`), `selectors.yaml` (layered `role → css → nl`), `flows/*.md` and a smoke test.
2. The skill must respect the project's anti-bot policy (`docs/anti-bot-policy.md`): real user browser, human pace, stop on any challenge. PRs that add proxies, fingerprint spoofing or CAPTCHA solving are closed without review.
3. Describe in the PR what you verified live, on which date, with which channel (browser extension or dedicated profile). Never paste order numbers or account data.
4. Money-touching changes (checkout steps, pay click, mandate parser) need two approvals and a maintainer re-run from their own profile.

## Selector write-back

When the runtime's self-healing resolver fixes a selector at run time, it writes the new CSS to `selectors.yaml`. Commit only that diff with a dated comment; never commit `.state/` snapshots that were used to find it.

## Knowledge-store adapters

An adapter implements the `KnowledgeStore` interface in `runtime/src/context/store.ts` (`retrieve(query)` over local files, synchronous, no network). Add a synthetic fixture and a test that proves excluded paths (archive, secrets) are never read. Adapters that phone home are not accepted.

## Code of conduct

Be kind, be precise, assume good faith. Harassment of any kind is not tolerated.

## Contact

Andrii Shramko — [LinkedIn](https://www.linkedin.com/in/andrii-shramko/) · zmei116@gmail.com · [book a call](https://calendar.app.google/Ff729HqGk4RpzPNDA). Open to interesting people and to helping teams build ambitious projects.
