---
description: Unsubscribes, marketing consent and letting old lost leads go. Keeps the database on the right side of the Privacy Act and the spam rules.
---

1. Someone asked to stop: `node scripts/leads.mjs unsubscribe C-xxxx`. Then remove them from any list kept outside this system.
2. Someone said yes to hearing about other cars: `consent C-xxxx express --source="what they said and where"`.
3. Old lost leads: `anonymise` lists contacts past the retention period (setting `retention_months`) with no purchase and no recent dealings. Show the list, ask for a yes, then `anonymise --yes`. Names, numbers, emails and licence details go; lead counts stay.
4. Finish with `compliance consent`, `compliance unsubscribe` and `compliance retention`.
