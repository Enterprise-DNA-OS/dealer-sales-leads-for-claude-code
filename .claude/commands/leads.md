---
description: The open leads, filtered by stage, salesperson, yard or source. The pipeline without a board.
---

1. Run `node scripts/leads.mjs leads --json`, adding `--stage=`, `--to=`, `--site=`, `--source=` or `--all` to match what the operator asked.
2. Present a table: lead, customer, stage, car, who has it, next step. Group by stage when the list is long, newest first inside each stage.
3. Count by stage in one line at the top ("17 open: 4 new, 1 contacted, 5 with appointments, 2 after a test drive, 5 negotiating").
