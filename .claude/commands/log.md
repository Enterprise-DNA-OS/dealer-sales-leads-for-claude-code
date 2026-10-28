---
description: Record a call, text, email, visit or note against a lead, and set the next step. The first outgoing contact sets the answer time.
---

1. Work out the lead (`lead <name>` if unsure), what happened, and the next step the salesperson promised.
2. Run `node scripts/leads.mjs log L-xxxx "what happened" --kind=call|sms|email|visit|note [--in] --next=<date> --action="what we will do" --json`.
3. Marketing (an offer, new arrivals, an event the person did not ask about) is logged with `--marketing`; the CLI refuses it for anyone who has not consented or has unsubscribed. Do not work around that.
4. Confirm in one line, including the answer time if this was the first contact.
