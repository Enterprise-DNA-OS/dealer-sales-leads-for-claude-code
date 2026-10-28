---
description: Book a visit, a test drive, an appraisal or a delivery, and record how it went afterwards.
---

1. Book: `node scripts/leads.mjs book L-xxxx --at="+2 10:30" --kind=visit|test_drive|appraisal|delivery [--by=S03] --json`. Times are the yard's local time.
2. Afterwards: `outcome L-xxxx showed|no_show|cancelled`. A no-show gets a follow-up the same day: offer `/draft-followups`.
3. To see the diary: `appointments --days=7`, or `appointments --past` for what happened.
