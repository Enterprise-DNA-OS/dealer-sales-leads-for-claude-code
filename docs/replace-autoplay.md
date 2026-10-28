# Moving off AutoPlay

AutoPlay does not publish a lead export format, and its help centre documents the ways leads come in (DMS or VMS push, dealer and brand CRMs, the Lead API, an enquiry email address, the iOS app and the web app) rather than a way to take them out. So the move works from whatever CSV you can get, and the importer is built to read common column names and report what it cannot place rather than guess.

## 1. Get your data out

- **Leads.** Ask AutoPlay support for an export of your leads and their status, or export the sales pipeline or closing report your account offers to CSV. If neither is available, the lead notification emails in your inbox and your portal accounts (Trade Me Motors and the others) hold the same people.
- **Stock.** Export the stock list from your DMS, not from AutoPlay: the DMS is the source of truth for the cars.
- **Your team and sources.** Add your yards, salespeople and lead sources first (ask Claude Code; `source-add` for each source with its monthly spend). The importer matches names against them.

## 2. Import stock, then leads, dry run first

```bash
node scripts/leads.mjs import stock stock.csv --dry-run
node scripts/leads.mjs import leads leads.csv --dry-run
```

The dry run changes nothing and lists every row it could not place. Fix the CSV or add the missing source or salesperson, run the dry run again, then run it without `--dry-run`. Running it twice creates nothing new: lead IDs are remembered.

## What maps

| Your CSV column (any of) | Becomes |
|---|---|
| Lead ID, Enquiry ID, ID, Reference | the lead's external reference (used to skip it on a second run) |
| Date, Received, Created, Enquiry Date | when it came in (DD/MM/YYYY or YYYY-MM-DD, with an optional time) |
| Name, or First Name and Last Name | the contact |
| Mobile, Phone, Email | the contact, and the duplicate check |
| Source, Lead Source, Channel | the lead source, matched by code, name or kind |
| Stock No, Stock Number | the car they asked about |
| Salesperson, Assigned To, Owner | who has the lead |
| Status, Stage | new, contacted, appointment, test drive, negotiating, sold or lost |
| Notes, Comments, Message | the first line of the lead's history |
| Lost Reason | why it was lost |
| Marketing Consent, Opt In | express consent when yes; otherwise none |

Stock: Stock No, Rego, VIN, Year, Make, Model, Variant, Body, Fuel, Odometer, Price, Site, Status, In Stock.

## What does not carry over

- **The conversation history.** Each imported lead gets one history line with its notes. Earlier calls, texts and emails stay in AutoPlay and your inboxes; keep an export for reference.
- **Answer times.** An imported lead that was already in progress is marked answered at its received time, so it does not show as waiting. Speed-to-lead numbers start from the day you switch.
- **Marketing consent.** Only an explicit yes in the export becomes consent. Everyone else starts at none, on purpose: if you cannot show where consent came from, do not market to them.
- **Test drives, appraisals and deals.** Start fresh from the switch date. Past deals live in your DMS.
- **The paid Lead API and the dealer email address.** New enquiries reach this system by a person (or Claude Code) entering them from the notification, or, in a version Enterprise DNA builds for you, by connecting your portals and inbox directly.

## Run both for a fortnight

Keep AutoPlay running while the floor works from here for two weeks. Compare the open lead count each morning. When they match and nothing has been missed, switch it off.
