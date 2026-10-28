---
description: Draft a marketing message (new arrivals, an offer, an event) to the people who consented, and only them. Drafts to drafts/, never sends.
---

1. Run `node scripts/leads.mjs marketing-list --json` (`--site=` for one yard). Only these people may receive it.
2. Write the message with a working unsubscribe line ("Reply STOP to unsubscribe" for text, a clear unsubscribe link or reply for email) and the business name. Both are required (UEMA 2007 s 10 and s 11).
3. Write the message and the recipient list to `drafts/marketing-<date>.md`. A person sends it from their messaging tool.
4. After it goes, log it per person with `--marketing`, and action every unsubscribe the same day: `unsubscribe C-xxxx`.
