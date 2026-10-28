---
description: Close a lead as lost, with the reason, so the monthly review can learn from it.
---

1. Confirm it is really lost: read `lead L-xxxx` first. A lead with a recent inbound message is not lost.
2. Run `node scripts/leads.mjs lost L-xxxx --reason="Bought elsewhere|Price|Finance declined|Stopped replying|..." --json`. Keep reasons short and reused so they count.
3. Future appointments are cancelled and any open trade-in offer is declined. Say so.
