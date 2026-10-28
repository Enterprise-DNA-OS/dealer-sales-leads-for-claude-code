---
description: Speed to lead. Who is still waiting for a first answer right now, and how fast each salesperson and each lead source gets answered.
---

1. Run `node scripts/leads.mjs response --json` (add `--days=7` for this week only).
2. Lead with the people waiting now: name, car, how long, who has it. Anyone past the target (setting `response_target_minutes`) is the first line.
3. Then the speed table by salesperson and by source: share answered inside the target, the median, the slowest. Name the gap in one sentence ("Tauranga answers website leads in an hour; Hamilton in nine minutes").
4. Offer to draft the first replies for everyone waiting: `/draft-replies`.
