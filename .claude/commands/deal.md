---
description: Write a deal, record finance, deliver it, or cancel it. The gates check the PPSR on the trade-in, the cash limit and the credit authority.
---

1. Write it: `node scripts/leads.mjs deal L-xxxx --vehicle=<stock> --price=<dollars> [--trade=A-xxx] [--deposit=<dollars> --deposit-method=card|transfer|cash] [--balance=transfer|finance|card] --json`.
2. Finance: `finance D-xxx applied --consent --lender="..."` once the customer has signed the credit check authority, then `finance D-xxx approved|declined`.
3. Deliver: `deliver D-xxx`. It refuses finance that is not approved, a trade-in with no PPSR search, and NZ$10,000 or more in cash or cheque.
4. Off: `cancel D-xxx --reason="..."` puts the car back in stock and keeps the lead open.
5. Never suggest splitting a cash payment to get under the limit. Related payments count together under the law.
6. `deals` lists written deals; `npm run docs -- deal-summary` renders the sale summary.
