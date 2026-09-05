# AGENT_SETUP.md — protocol for an AI agent installing Agentic Shopping Autopilot for its user

You are an AI agent (Claude Code, Codex, Cursor, Gemini CLI, Aider or similar) and a person asked you to install this project for them. Follow this file top to bottom. Everything here is shell commands and file edits; you need no API keys and no third-party services. Read it fully before running anything.

**Who does what.** You do all the technical work yourself. You ask the user only at the decision points in section 13. You never type card numbers, passwords or one-time codes anywhere, and you never store them. You report "installed" only when the self-check in section 14 is green.

## 0. Ground rules

1. Never commit or share `config.env`, `PURCHASE_MANDATE.md`, `runtime/.state/`, `audit-*.jsonl`, browser profiles or screenshots that show an address or a payment form.
2. The private folder (section 4) must live **outside any git repository** and outside any folder that syncs to a cloud drive or a chat transcript.
3. Do not pre-allow `asa override`, `asa mandate:*`, `asa basket:approve` or `asa checkout` in the agent harness's permission rules. Money commands are run one at a time, on purpose.
4. Write everything you produce for the user in the user's language; keep files in this repository in English.
5. If a step fails, fix the cause and rerun it. Do not skip it, and do not ask the user to run commands for you unless the step is physically theirs (logging into a website, a bank push).

## 1. Prerequisites check

```bash
node -v        # need v20 or newer
git --version
```

Also check with the user, in one message, the following (these are the decision points 1–3 in section 13):

- Which marketplace account they will use (the MVP supports **allegro.pl**) and that they are **already logged in** to it in their everyday Chrome, with **a payment card already saved** in that account.
- Which browser channel you will use: **A)** the Claude in Chrome extension inside the user's own Chrome (verified channel), or **B)** a dedicated Chrome profile started with `--remote-debugging-port=9222 --user-data-dir=<own dir>` where the user logs in once (alternative channel).
- The path to their **knowledge store** — an Obsidian vault or any folder of Markdown/text notes (section 5).

Verified operating system: Windows 10. macOS and Linux should work and are unverified; say so in your report if you are on one of them.

## 2. Clone and install

```bash
git clone https://github.com/AndriiShramko/agentic-shopping-autopilot.git
cd agentic-shopping-autopilot/runtime
npm install
npm test            # offline; expect every test to pass
npm run build       # produces dist/cli.js
```

Make `asa` callable. Either `npm link` in `runtime/`, or use `node <repo>/runtime/dist/cli.js` wherever this file says `asa`, or `npm run cli --` from `runtime/`. Confirm with `asa --help` (or `node dist/cli.js --help`) that the usage lines print.

## 3. Install the site skill for the agent that will shop

Copy `skills/allegro.pl` into the skills folder of the agent that will run purchases:

| Agent | Skills folder |
|---|---|
| Claude Code | `~/.claude/skills/allegro.pl/` |
| Codex CLI | `~/.codex/skills/allegro.pl/` |
| Cursor | `~/.cursor/skills/allegro.pl/` |
| Other | wherever that agent loads `SKILL.md` files (Agent Skills format) |

Do not edit `SKILL.md`; the runtime reads `selectors.yaml` from the repository copy.

## 4. Create the private folder and `config.env`

The runtime looks for the private folder at `~/.asa/private` by default, or at `ASA_PRIVATE_DIR`, or at `--private-dir`. Create it outside any repository:

```bash
mkdir -p ~/.asa/private/shopping-profile ~/.asa/private/measurements
cp ../examples/PURCHASE_MANDATE.template.md ~/.asa/private/PURCHASE_MANDATE.md
cp ../examples/config.env.example ~/.asa/private/config.env   # if the example exists; otherwise create the file
chmod 600 ~/.asa/private/config.env                           # on Windows: keep it in the user profile only
```

`config.env` accepts only the keys listed in `runtime/README.md`. Set at least:

```
MANDATE_PATH=<private>/PURCHASE_MANDATE.md
CONTEXT_STORES=obsidian:<path to the user's vault>;jsonl:<private>/shopping-profile
HUMAN_CONFIRM=1
SHOPPING_PROFILE_DIR=<private>/shopping-profile
```

Leave `ALLEGRO_CLIENT_ID` / `ALLEGRO_CLIENT_SECRET` empty (API search waits for marketplace app verification; the browser results page is used instead). Recipient details (`REF_*`) are captured later by `asa ref:capture` from the logged-in browser and are never typed by you.

Verify the folder is not inside a git repo: `git -C ~/.asa/private rev-parse 2>&1 | grep -q "not a git repository" && echo OK`.

## 5. Connect the knowledge store — context-first

This project's core rule: **before searching or choosing anything, the agent consults the user's knowledge store** and asks no question the store can answer.

1. Ask the user for the path to their notes (Obsidian vault, Logseq folder, a directory of Markdown/text files). Add it to `CONTEXT_STORES` as `obsidian:<path>` (Markdown with frontmatter) or `folder:<path>` (plain files). Several stores are separated by `;`.
2. Read-only, build the JSONL shopping profile from the notes (formats in `runtime/README.md` and `docs/user-guide.md`): `wishlist.jsonl`, `purchase-history.jsonl`, `sellers.json`, `do-not-buy.txt`. Fill only what the notes support; mark assumptions in the `source` field. **Never copy addresses, locker codes, phone numbers or tax IDs** into these files.
3. Run `asa profile:check` — it must not report PII.
4. Prove the gate works: `asa context:brief --need "test need" --terms "a,b"` must print a digest (or exit 3 with "no snippets" if the store is empty), and `asa search --source state` without a brief must exit 2 with the stop reason `context_missing`.

Archived notes and notes whose path contains a lock emoji (`🔒`) are excluded by hard-coded rules. Tell the user which folders you excluded.

## 6. Browser channel check

- **Channel A (extension):** open `https://allegro.pl` in the user's Chrome through the extension. Confirm the account name is visible in the header and there is no block page. Open the cart page once; it must render.
- **Channel B (dedicated profile):** start Chrome with `--remote-debugging-port=9222 --user-data-dir=<own folder>`, ask the user to log in once and browse two or three pages by hand, then run `asa browser:check` — it must report logged in and no block page.

If you see a block page or a CAPTCHA at any point: stop, tell the user, do not retry in a loop.

## 7. Draft and sign the mandate

Fill `PURCHASE_MANDATE.md` from the user's answers to the decision points 4–8 (limits per item, per order, aggregate and validity period; allowed categories; marketplaces; one-time approval ceiling). Then:

```bash
asa mandate:check --draft      # prints the hash and the line range it covers
```

Show the user the limits and the first eight characters of the hash. The user signs by replying in chat with `ok <hash8>` (or with amended values, which you apply with `asa mandate:amend` and re-check). Then:

```bash
asa mandate:sign --by "<user name> (chat)" --hash <hash8>
asa mandate:check                # must be green
```

Never sign on the user's behalf and never pre-fill the reply for them.

## 8. Dry run (no money)

```bash
asa run:start --command "dry run: <one item from the wishlist>" --mode mcp
asa context:brief --need "<the item>" --terms "<terms in the user's language and in Polish>"
asa search --source state        # in extension mode you feed offers from the results page into .state/
asa select --id <offer id> --category <category> --rationale "dry run"
asa checkout --step 1
```

Stop after step 1. Report what the brief found, what was ranked first and why, and confirm no order was placed.

## 9. First supervised purchase

Keep `HUMAN_CONFIRM=1`. Choose one cheap item well under the per-item limit, ideally something already in the wishlist. Walk the checkout steps while the user is beside the browser. The bank may ask for 3-D Secure on a first purchase or a new device — that step is the user's. After the order is confirmed, verify it on the marketplace's order page, then run `asa report`.

From the third successful purchase on, and only if the user says so, set `HUMAN_CONFIRM=0`.

## 10. Keep it updated

```bash
cd <repo>
git pull --rebase
cd runtime && npm install && npm test && npm run build
```

Then read `CHANGELOG.md` for breaking changes. Re-verify `selectors.yaml` after a marketplace change. Re-sign the mandate only if the changelog says the mandate format changed. Do this whenever the user asks for "the latest version" or at least monthly.

## 11. Share work back

If you fixed a selector, added a site skill or a knowledge-store adapter: fork, branch, follow `CONTRIBUTING.md` (English, no secrets, redaction checklist, DCO sign-off), open a pull request that describes the live verification without order numbers or account data.

## 12. Uninstall or revoke

- Immediate stop: create an empty file `MANDATE_REVOKED` next to `PURCHASE_MANDATE.md`.
- Uninstall: delete the private folder, the skill folder(s) and any harness allow-rules you added; remove the repository clone.
- If the user suspects misuse: freeze the card in the banking app first, then investigate the audit log.

## 13. Decision points — ask the user; everything else you decide

| # | Ask | Why it is theirs |
|---|---|---|
| 1 | Marketplace account and that a card is saved there | account ownership |
| 2 | Browser channel A or B | their browser, their login |
| 3 | Path to the knowledge store; folders to exclude | their private data |
| 4 | Per-item, per-order and aggregate limits | their money |
| 5 | Validity period of the mandate | their money |
| 6 | Allowed categories and marketplaces | their intent |
| 7 | One-time approval ceiling | their money |
| 8 | The signature reply `ok <hash8>` | consent must be theirs |
| 9 | Switching `HUMAN_CONFIRM` to 0 | their risk appetite |

## 14. Self-check before you report "installed"

All of these must be true and shown in your report:

- `npm test` green and `npm run build` green in `runtime/`.
- `asa mandate:check` green with the user's limits (not template placeholders).
- `asa profile:check` reports no PII; `CONTEXT_STORES` points at a real path; `asa context:brief` produced a digest for a sample need.
- `asa search` without a brief exits 2 (`context_missing`) — the gate is live.
- Browser channel confirmed logged in, no block page.
- A dry run reached `checkout --step 1` with no order placed.
- The user has read `docs/warnings.md` (send them the link and the five key points from README's safety section).

Report in the user's language: what you installed, the limits in the signed mandate, the stores connected, what you excluded, what you did not verify and why.
