---
description: The follow-up list. Overdue promises, leads gone quiet, no-shows nobody chased, appointments with no outcome, people who came back while we were quiet, and answered leads with no next step.
---

1. Run `node scripts/leads.mjs followups --json`.
2. Present it as the day's call list, one block per salesperson. Lead with "came back": someone enquiring again on a lead we let go quiet is the warmest call on the list.
3. For each line, name the next action and the command that records it: `log L-xxxx "..." --kind=call --next=+3 --action="..."`, `outcome L-xxxx no_show`, `lost L-xxxx --reason="..."` when it is truly dead.
4. Offer `/draft-followups` for the texts and emails.
