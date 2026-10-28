# Dealer Sales Leads for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs doing now, the morning list | `/attention` |
| Who is waiting for a call back, speed to lead | `/response` |
| The day's call list, chasing, quiet leads | `/followups` |
| The pipeline, open leads by stage or person | `/leads` |
| Everything about one customer or lead | `/lead` |
| A new enquiry from a call, walk-in, email or portal | `/new-lead` |
| Someone is away, a lead has nobody, rebalance | `/allocate` |
| "I just called / texted / emailed ..." | `/log` |
| Book or record a visit, test drive, appraisal, delivery | `/book` |
| A test drive out or back | `/test-drive` |
| A trade-in valuation, the PPSR search, the offer letter | `/appraise` |
| Write, finance, deliver or cancel a deal | `/deal` |
| Close a lead as lost | `/lost` |
| Which lead sources work, cost per sale | `/sources` |
| How each salesperson is doing | `/team` |
| Which cars get interest, which do not | `/stock-interest` |
| Reply to the people waiting | `/draft-replies` |
| Follow-up texts and emails | `/draft-followups` |
| A marketing message (new arrivals, offers, events) | `/draft-marketing` |
| Unsubscribes, consent, old lost leads | `/privacy` |
| Are we compliant | `/compliance` |
| The Monday sales meeting | `/weekly-review` |
| Bring data across from AutoPlay or a spreadsheet | `/import` |
| Change a field, a stage, a rule, a setting | `/customise` |
| A new page to look at | `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run <cli> -- --help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Marketing goes only to `marketing-list`. A reply to a person's own enquiry is not marketing; an offer on a car they did not ask about is.
- Never work around a gate: no test drive without a licence sighted for this drive, no trade-in on a deal without a PPSR search, no NZ$10,000 or more in cash or cheque on one car, no finance application without the signed authority. Never suggest splitting a cash payment.
- Times are the yard's local time (setting `timezone`).
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off AutoPlay.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/autoplay
