---
description: Check the records against the rules a dealer's sales floor lives under (spam consent and unsubscribes, licence on test drives, PPSR on trade-ins, the cash ban, credit authority, privacy retention) and report breaches with the rule cited.
---

1. Read `docs/compliance.md`. Each rule has its source, what a breach looks like in the data, and where the CLI already refuses at the gate.
2. Run `node scripts/leads.mjs compliance --json` (add a rule name to run one: consent, unsubscribe, licence, ppsr, cash, credit, retention).
3. Report as a table: rule, count, the worst example, the source. Breached first, clean last.
4. For anything breached, draft the fix the operator can approve: action the unsubscribe, search the PPSR, record the credit authority once it is signed, run the anonymise list. Never edit history to make a breach disappear: a past breach stays on the record and the fix is what happens next.
5. If a rule in `docs/compliance.md` is out of date, say so and stop. Do not guess at law. The operator confirms the rule, then you update the doc and the check together.

Nothing here is legal advice. The doc records the rules the operator has told the system to enforce, with sources, and this command checks the data against them.
