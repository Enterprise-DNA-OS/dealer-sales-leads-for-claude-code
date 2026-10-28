<h1 align="center">Dealer Sales Leads for Claude Code</h1>

<p align="center">
  <strong>The open-source car dealer sales lead system (enquiries, allocation, test drives, appraisals, follow-up and deals) that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your AutoPlay data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=autoplay">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/autoplay?utm_source=github&utm_medium=readme&utm_campaign=autoplay">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-autoplay">Instead of AutoPlay</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Dealer Sales Leads for Claude Code does the job you pay AutoPlay for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the AutoPlay dashboard cannot.

AutoPlay publishes no price. Its own sales FAQ says pricing is shaped around the yard's setup, its lead sources and its team size, and its help centre says the Lead API carries extra charges (autoplay.co.nz/support, checked 28 October 2026). So the bill grows with every salesperson and every lead source you add, on top of the DMS you already pay for.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=autoplay).

It covers the sales floor between the enquiry and the delivery: lead sources and what they cost, allocation to the next free salesperson, speed to first answer, every call, text and email, appointments and no-shows, test drives with the licence sighted, trade-in appraisals with the PPSR search, and written deals with deposit and finance. It is for New Zealand and Australian franchised and used car dealers with one to five yards. Stock, workshop and accounts stay in your DMS.

### Ten questions it answers that the dashboard does not

1. Who is waiting for a first answer right now, and who has them? (`response`)
2. What share of each salesperson's leads were answered inside 15 minutes, and what is their median? (`response`, `team`)
3. Which customers enquired again while their lead had gone quiet? (`followups`)
4. Which no-shows has nobody been back in touch with? (`followups`)
5. What did each lead source cost per car sold this quarter, and which one sold nothing? (`sources --days=90`)
6. Which cars get enquiries but no test drives, and which get no enquiries at all? (`stock`)
7. Which trade-in offers expire this week on leads still open? (`attention`, `appraisals`)
8. Which test drives went out with no licence on record? (`compliance licence`)
9. Which deals have finance applied with no credit authority, or a trade-in with no PPSR search? (`compliance credit`, `compliance ppsr`)
10. Who may we send the new arrivals email to, and who must we leave off? (`marketing-list`)

### Your first hour: ten things to ask for

1. "Set up our two yards, Hamilton and Tauranga, and our six salespeople."
2. "Add Trade Me Motors as a lead source at $1,800 a month, and our website at $600."
3. "Make our answer target ten minutes, not fifteen."
4. "Import our stock list from the DMS export in Downloads."
5. "Import our leads from the AutoPlay export, dry run first."
6. "Who is still waiting for a call back?"
7. "Josh is on leave until Monday. Move his new leads."
8. "Draft first replies for everyone waiting."
9. "Give me the Monday sales meeting."
10. "Add a field for the customer's preferred contact time." (`/customise`)

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/dealer-sales-leads-for-claude-code.git
cd dealer-sales-leads-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`, or just ask "who is still waiting for a call back?"

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that needs a person now, worst first |
| `/response` | Who is waiting for a first answer; speed to lead by person and source |
| `/followups` | Overdue promises, quiet leads, no-shows, came-backs, missing next steps |
| `/leads` | The open leads by stage, salesperson, yard or source |
| `/lead` | The whole story of one lead or customer |
| `/new-lead` | Record an enquiry and allocate it; repeat enquiries are linked, not duplicated |
| `/allocate` | Move leads; mark someone away or back |
| `/log` | Record a call, text, email or visit and the next step |
| `/book` | Book a visit, test drive, appraisal or delivery; record the outcome |
| `/test-drive` | A drive out with the licence sighted, and the car back in |
| `/appraise` | A trade-in appraisal, its PPSR search and the written offer |
| `/deal` | Write, finance, deliver or cancel a deal, through the gates |
| `/lost` | Close a lead as lost with the reason |
| `/sources` | What each lead source sent, sold and cost per sale |
| `/team` | Load, answer speed and results per person |
| `/stock-interest` | Enquiries, test drives and days in stock per car |
| `/draft-replies` | First replies for everyone waiting, to `drafts/` |
| `/draft-followups` | Follow-up texts and emails, to `drafts/` |
| `/draft-marketing` | A marketing message to the people who consented, to `drafts/` |
| `/privacy` | Unsubscribes, consent, and letting old lost leads go |
| `/compliance` | The records against seven rules, each with its source |
| `/weekly-review` | The Monday sales meeting from four commands |
| `/import` | Leads and stock from AutoPlay or any spreadsheet, dry run first |
| `/customise` | Change a field, a stage or a rule in plain words |
| `/new-view` | A new read-only page for `npm run view` |

`npm run view` renders the today, sources and team pages as HTML in your brand (`brand.json`). `npm run docs` renders the test drive record, the trade-in offer and the vehicle sale summary for every record.

## Instead of AutoPlay

Export what you can from AutoPlay (leads and their status) and your DMS (stock), then:

```bash
npm run leads -- import stock stock.csv --dry-run
npm run leads -- import leads leads.csv --dry-run
```

The importer reads common column names, reports every row it cannot place, and remembers lead IDs so a second run creates nothing. What maps and what does not carry over: [docs/replace-autoplay.md](docs/replace-autoplay.md). The rules the system enforces, with sources: [docs/compliance.md](docs/compliance.md).

## Architecture

```
dealer-sales-leads-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Dealer Sales Leads for Claude Code for your business, migrates your AutoPlay data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=autoplay)
- Read more: [enterprisedna.co/omni/instead-of/autoplay](https://enterprisedna.co/omni/instead-of/autoplay?utm_source=github&utm_medium=readme&utm_campaign=autoplay)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
