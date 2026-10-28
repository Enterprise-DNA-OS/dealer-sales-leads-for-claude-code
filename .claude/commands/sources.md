---
description: What each lead source sent and what it turned into, from enquiry to appointment, test drive and sale, with the spend per sale.
---

1. Run `node scripts/leads.mjs sources --json` (default 90 days; `--days=30` for the month).
2. Present a table, then three sentences: the source that sells, the source that costs most per sale, the source that sends leads but no sales.
3. Spend comes from each source's monthly figure. If one is wrong or missing, fix it: `source-add <CODE> --name="..." --kind=portal --spend=<monthly>`.
4. Never call a source good or bad on fewer than ten leads; say the numbers are small.
