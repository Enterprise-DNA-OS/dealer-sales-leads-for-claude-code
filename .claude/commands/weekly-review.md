---
description: The Monday sales meeting, written from four commands: what needs a person, speed to lead, where the leads came from and what they became, and the team.
---

1. Run four commands, `--json` each: `node scripts/leads.mjs attention`, `response --days=7`, `sources --days=30`, `team`. Add `deals` for the deliveries due.
2. Write the review in four short sections, prose plus small tables, nothing invented:
   - **Today's calls.** The attention list worst first, one action each. Anything unassigned or with someone away is the first line.
   - **Speed to lead.** Last week's share answered inside the target, by person and by source, and anyone still waiting now.
   - **Sources.** What each sent and sold over 30 days, and the spend per sale where there is spend.
   - **Deals.** Written and not delivered, finance waiting, deliveries booked this week.
3. End with at most five actions for the week, each one command or one phone call.
4. If the manager wants it on paper, `npm run view` renders the today, sources and team pages in the dealer's brand.
