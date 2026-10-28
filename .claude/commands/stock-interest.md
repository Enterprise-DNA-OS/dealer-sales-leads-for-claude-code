---
description: The cars in stock and the interest in each: enquiries, open leads, test drives and days in stock. Which cars get asked about and never driven, and which get nothing.
---

1. Run `node scripts/leads.mjs stock --json` (`--site=` for one yard).
2. Name three groups: asked about but never test driven (the advert or the price is doing its job, the follow-up is not), no enquiries in 30 days or more (the listing or the price), and on hold (a deal is written).
3. Stock comes from the DMS. Refresh it with `/import` (stock) when it is out of date.
