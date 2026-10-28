# The rule book /compliance checks

Seven rules, each with its source, what a breach looks like in the data, and where the CLI already refuses at the gate. `node scripts/leads.mjs compliance` runs them all; add a rule name to run one.

Nothing here is legal advice. It is the rule book the operator has pointed the system at, with sources, and the operator changes it to match their business. When the law moves, update the rule and the check together.

## 1. `consent` - marketing only to people who said yes

A commercial electronic message (a text or email promoting a car, an offer or an event the person did not ask about) is sent only with the person's consent: express (they said yes or ticked a box), or inferred from an existing business relationship. A reply to a person's own enquiry about the car they asked about is not marketing. **Source: Unsolicited Electronic Messages Act 2007 s 9 (New Zealand); Spam Act 2003 s 16 (Australia).**

Breach in the data: an outgoing activity marked marketing to a contact whose consent is `none`, or sent before consent was recorded. **Gate: `log --marketing` refuses for anyone without consent; `/draft-marketing` drafts only to `marketing-list`.**

## 2. `unsubscribe` - actioned within five working days, and nothing after

Every marketing message carries a working way to unsubscribe, and an unsubscribe request takes effect within five working days. **Source: Unsolicited Electronic Messages Act 2007 s 11 (New Zealand); Spam Act 2003 s 18 (Australia).** The five days live in the setting `unsubscribe_working_days`; public holidays are on the operator.

Breach in the data: a request (`unsubscribe_requested_at`) not actioned (`unsubscribed_at`) after five working days, or any marketing activity after the request. **Gate: `log --marketing` refuses for anyone who has asked; `consent` will not re-subscribe them unless they asked to hear from you again (`--resubscribed`).**

## 3. `licence` - a current licence sighted before every test drive

Nobody drives a car off the yard without the salesperson looking at a current driver licence for that class and recording the number and expiry. Driving without the appropriate licence is an offence, and most motor trade insurance policies make it a condition of cover on a demonstrator. **Source: Land Transport Act 1998 s 31; your insurer's demonstrator conditions.**

Breach in the data: a test drive with `licence_sighted` false, no licence number, no expiry, or an expiry before the day of the drive (only possible through import or a direct database write). **Gate: `drive` refuses without a licence number and expiry entered for this drive, and refuses an expired licence. A licence on file from last time is shown as a hint, never used silently. No force flag.**

## 4. `ppsr` - every trade-in searched before it goes on a deal

A finance company's security interest registered on the Personal Property Securities Register follows the car. A dealer who takes a trade-in with money owing and does not pay it out can lose the car or the money. **Source: Personal Property Securities Act 1999; the register is at ppsr.companiesoffice.govt.nz.**

Breach in the data: a written or delivered deal whose trade-in appraisal has no `ppsr_checked_on`. **Gate: `deal --trade=` refuses an appraisal with no search; `deliver` refuses too. Money owing found by the search becomes the payout on the deal and is added to the balance.**

## 5. `cash` - no car bought or sold for NZ$10,000 or more in cash

Since 11 May 2023 a person in trade must not buy or sell a motor vehicle for cash of NZ$10,000 or more, in one payment or several related payments (a cash deposit and a cash balance on the same car count together). Cheques count as cash for this rule. It is a flat ban: customer due diligence does not make it lawful. **Source: Anti-Money Laundering and Countering Financing of Terrorism Act 2009 s 67A; reg 5AC of the AML/CFT (Definitions) Regulations 2011; Department of Internal Affairs, "Prohibited cash transactions for specified high value goods".**

The limit is the law, so it is a constant in `scripts/leads.mjs`, not a setting anyone can raise. This rule is New Zealand's; Australia has no equivalent ban on car sales.

Breach in the data: a deal on or after 11 May 2023 where the cash or cheque deposit plus a cash or cheque balance reaches $10,000. **Gate: `deal` and `deliver` both refuse. No force flag.**

## 6. `credit` - the customer's authority before a finance application goes out

A finance application sends the customer's personal information to a lender, who runs a credit check on it. The dealer holds the customer's signed authority for that before it is sent. **Source: Privacy Act 2020, IPP 3 (telling the person what their information is for) and IPP 11 (limits on disclosure); the lender's own application terms, which ask for the applicant's signed privacy authority; the credit check itself is governed by the Credit Reporting Privacy Code 2020.**

Breach in the data: a deal with finance applied, approved or declined and no `credit_consent_at`. **Gate: `finance` refuses any status without the authority recorded (`--consent` records it at the moment it is signed).**

## 7. `retention` - lost leads let go

Personal information is kept no longer than it is needed for the purpose it was collected for. A person who asked about a car two years ago, never bought, and has had no dealings since, is not a customer. **Source: Privacy Act 2020, IPP 9.** The period lives in the setting `retention_months` (24 by default); the operator sets it to match their own privacy policy.

Breach in the data: a contact with only lost leads, no deal, and no activity for longer than the period. **The fix: `anonymise` lists them, `anonymise --yes` clears names, numbers, emails and licence details. Lead counts, sources and outcomes stay, so the reports still add up.**
