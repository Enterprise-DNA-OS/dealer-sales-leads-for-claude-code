---
description: Record a new enquiry from a call, a walk-in, a forwarded email or a portal notification, and allocate it to the next free salesperson.
---

1. Pull the facts out of what the operator pasted or said: name, mobile, email, the car (stock number, rego or make and model), where it came from, the yard, trade-in, finance. Never guess a number or an address: ask.
2. Run `node scripts/leads.mjs new --name="..." --mobile="..." --email="..." --source=<code> --vehicle=<stock> [--site=] [--trade] [--finance] [--message="their words"] --json`. Add `--consent=express` only if they ticked a box or said yes to hearing about other cars.
3. If the result says `duplicate_of`, they already have an open lead: tell the salesperson who has it that this person came back, and do not start a second conversation.
4. Say who has it and offer the first reply: `/draft-replies`.
