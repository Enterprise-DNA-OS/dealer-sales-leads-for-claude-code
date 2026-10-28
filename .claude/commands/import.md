---
description: Bring leads and stock across from AutoPlay (or any lead or stock spreadsheet). Dry run first; nothing is guessed.
---

1. Read `docs/replace-autoplay.md`: what to export, which columns map, what does not carry over.
2. Stock first, from the DMS: `node scripts/leads.mjs import stock stock.csv --dry-run --json`.
3. Leads: `import leads leads.csv --dry-run --json`. Read every problem out loud. A source or salesperson the CSV names but this system does not know is a setup question: add the source (`source-add`) or the person, never map it to the nearest guess.
4. Run it for real, then run it again: the second pass must create nothing (lead IDs are remembered). That is the idempotency check.
5. Present created, skipped and why, then run `/attention` and `/compliance`: the import is the first audit.
