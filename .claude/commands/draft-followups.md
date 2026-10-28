---
description: Draft follow-up texts and emails for the overdue, quiet, no-show and came-back leads. Drafts to drafts/, never sends.
---

1. Run `node scripts/leads.mjs followups --json`, then `lead L-xxxx --json` for each one.
2. Write one short message per lead that picks up from the last real contact in the history: the no-show gets a friendly rebook, the came-back gets "saw you were looking again", the quiet one gets one useful fact about the car. Never pretend a conversation happened that is not in the history.
3. No pressure lines, no fake deadlines, no offers on other cars unless the person has consented to marketing.
4. Write each to `drafts/followup-L-xxxx.md`. A person sends and logs it.
