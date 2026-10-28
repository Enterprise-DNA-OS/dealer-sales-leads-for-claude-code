---
description: Draft the first reply to every lead still waiting for an answer, in the salesperson's voice, about the car they asked about. Drafts to drafts/, never sends.
---

1. Run `node scripts/leads.mjs response --json`, then `lead L-xxxx --json` for each one waiting.
2. For each, write a short text (under 300 characters) and, if there is an email, a short email: who you are, the car they asked about with one fact from the record (price, kilometres, the yard), and one clear next step (a time to come in, a call back). Use only what is in the record.
3. A reply to a person's own enquiry is not marketing. Do not add offers on other cars.
4. Write each to `drafts/reply-L-xxxx.md` with the mobile and email at the top. A person sends it, then logs it: `log L-xxxx "Sent first reply" --kind=sms`.
