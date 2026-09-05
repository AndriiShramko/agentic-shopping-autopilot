# Frontmatter keys the context module reads

The runtime reads Markdown notes of an Obsidian vault (or any folder) only inside the allow-list and outside the
exclude lists (see `docs/user-guide.md`, section 4). Inside that scope the YAML frontmatter of a note tunes whether and
how the note is read. Nothing here changes what Obsidian does with the note.

## Opt a note out

```yaml
---
type: area
asa_context: no
---
# Contract with the landlord
This note is never read by `asa context:brief`, whatever the folder and the search terms.
```

`asa_context: no` (also `false`, `0`, `off`) is the per-note switch. The same effect comes from a tag:

```yaml
---
tags: [family]        # sensitive, private, health, family → never read
---
```

and from a lifecycle status:

```yaml
---
status: archived      # archived, done → never read (the note is history, not a current fact)
---
```

## Make a note count more

```yaml
---
type: area            # area, project → weight 1.2
tags: [home, shopping, equipment]   # shopping, asa, equipment, home → weight 1.3 (the larger of the two applies)
updated: 2026-06-01   # the date the brief shows and ranks by (also `modified`, `created`); beats the file mtime,
                      # which every git clone resets
status: active        # shown next to the snippet score, so the session can tell "owned" from "choosing"
---
```

Daily notes (`type: daily` or a `Daily/` path) weigh 0.8, maps (`type: map`) 0.7, index-like notes
(`AGENT_INDEX.md`, `README.md`, `_INDEX.md`, `INDEX-*.md`, `CHANGELOG.md`) 0.6 when they are inside the scope at all
(`**/*INDEX*` and `**/CHANGELOG*` are excluded by default).

## What the brief takes from the body

- every line that contains one of the search terms (word-boundary, case- and diacritic-insensitive, inflections by stem:
  `простыня` finds `простыни`, `prześcieradło` finds `prześcieradła`; sizes in any notation: `180×200`, `180 x 200 см`,
  `180х200` with a Cyrillic х);
- a table row as one snippet with the header cells attached as `columns` and the nearest heading as `heading`;
- at most `CONTEXT_MAX_PER_FILE` (5) lines per note, so one long note cannot crowd out the others;
- never a line that looks like a postal code, phone, parcel-locker code, NIP, IBAN, e-mail, card number, PESEL,
  passport number, date of birth or that contains a secret word (`password`, `пароль`, `hasło`, `token`, `api key`,
  `secret`, `PIN`) — such lines are dropped and only counted.

A note older than `CONTEXT_STALE_DAYS` (180) is still read but carries a `!stale` marker in the digest, so the session
can prefer a current line over an old one.
