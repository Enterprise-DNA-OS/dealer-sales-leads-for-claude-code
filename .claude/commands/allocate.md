---
description: Move leads between salespeople: someone is away, a lead has nobody, or the load is uneven. Also marks someone away or back.
---

1. Run `node scripts/leads.mjs team --json` to see who holds what and who is away.
2. To move one lead: `assign L-xxxx` (picks the free salesperson at that yard with the fewest open leads) or `assign L-xxxx --to=S03`.
3. Someone going on leave: `away S04 --until=<date>`. The result lists the unanswered leads they still hold: move each one.
4. Someone back: `away S04 --back`.
5. Report who now has what in one short table.
