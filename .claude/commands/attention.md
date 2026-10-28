---
description: Everything on the sales floor that needs a person right now, worst first. A lead nobody owns or a car still out on a test drive comes before anything else.
---

1. Run `node scripts/leads.mjs attention --json`.
2. Present it worst first, grouped by area, in the floor's own words. Rank 1 items (a lead with nobody on it, a lead with someone who is away, a car out on a drive for hours) are the first job of the day: say so plainly.
3. For each group, say the one action that clears it: `assign L-xxxx`, call the customer and `log` it, `back <stock>`, `outcome L-xxxx showed|no_show`, `next L-xxxx <date> "..."`, re-appraise or extend the trade-in offer, book the delivery.
4. For the compliance lines, run `/compliance` rather than guessing what is behind them.
5. If the list is empty, say so in one line and stop.
