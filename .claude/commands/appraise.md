---
description: Record a trade-in appraisal, the PPSR search on it, and the written offer to the customer.
---

1. Record it: `node scripts/leads.mjs appraise L-xxxx --rego= --year= --make= --model= --km= --offer=<dollars> [--condition="..."] [--valid=7] --json`.
2. Search the PPSR (ppsr.companiesoffice.govt.nz) on the rego or VIN, then record it: `ppsr A-xxx --clear` or `ppsr A-xxx --owing=<amount>`. The CLI will not put a trade-in on a deal without it.
3. `npm run docs -- trade-in-offer` renders the written offer in the dealer's brand. Draft the covering text to `drafts/`, never send.
4. `appraisals` lists open offers and when each expires.
