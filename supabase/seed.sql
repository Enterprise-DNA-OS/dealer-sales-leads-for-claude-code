-- Demo data: Riverside Motor Group, a fictional used and new car dealer with two yards (Hamilton and
-- Tauranga), seven people on the floor, eight lead sources and about thirty leads in every state:
-- answered in four minutes and still unanswered after fifty, quiet for nine days, a no-show nobody
-- chased, a car still out on a test drive, a trade-in with no PPSR search, finance applied for with no
-- credit consent, and three lost leads old enough that the privacy rule says let them go.
-- Every time is relative to now, so the demo always reads like this week. Coded rows skip what is
-- already there; the activity history loads once (the demo_seeded marker).

insert into settings (key, value, note) values
  ('timezone', 'Pacific/Auckland', 'The yard''s time zone. Today, due dates and appointment times use it.'),
  ('business_name', 'Riverside Motor Group', 'Your trading name, used on drafts and documents.'),
  ('response_target_minutes', '15', 'A new lead should hear from a person inside this many minutes.'),
  ('quiet_days', '7', 'An open lead with no call, text, email or visit for this many days is quiet.'),
  ('appraisal_valid_days', '7', 'How long a trade-in offer stands by default.'),
  ('deal_delivery_days', '7', 'A written deal not delivered after this many days is flagged.'),
  ('retention_months', '24', 'Lost leads with no other dealings for this long are anonymised (Privacy Act 2020, IPP 9).'),
  ('unsubscribe_working_days', '5', 'An unsubscribe must be actioned within this many working days (UEMA 2007 s 11).')
on conflict (key) do nothing;

insert into sites (code, name, city) values
  ('HAM', 'Riverside Motors Hamilton', 'Hamilton'),
  ('TGA', 'Riverside Motors Tauranga', 'Tauranga')
on conflict (code) do nothing;

insert into staff (code, full_name, role, site_id, email, mobile, takes_leads, max_open_leads, away_until)
select x.code, x.name, x.role, si.id, x.email, x.mobile, x.takes, x.cap, case when x.away is null then null else biz_today() + x.away end
from (values
  ('S01', 'Aroha Ngata', 'sales_manager', 'HAM', 'aroha@riversidemotors.example', '021 555 0101', false, 0, null::int),
  ('S02', 'Ben Carter', 'salesperson', 'HAM', 'ben@riversidemotors.example', '021 555 0102', true, 25, null),
  ('S03', 'Priya Nair', 'salesperson', 'HAM', 'priya@riversidemotors.example', '021 555 0103', true, 25, null),
  ('S04', 'Josh Turner', 'salesperson', 'HAM', 'josh@riversidemotors.example', '021 555 0104', true, 25, 3),
  ('S05', 'Mele Tupou', 'salesperson', 'TGA', 'mele@riversidemotors.example', '021 555 0105', true, 25, null),
  ('S06', 'Daniel Kim', 'salesperson', 'TGA', 'daniel@riversidemotors.example', '021 555 0106', true, 25, null),
  ('S07', 'Fiona Grant', 'business_manager', 'HAM', 'fiona@riversidemotors.example', '021 555 0107', false, 0, null)
) x(code, name, role, site, email, mobile, takes, cap, away)
join sites si on si.code = x.site
on conflict (code) do nothing;

insert into lead_sources (code, name, kind, monthly_spend_cents) values
  ('TM', 'Trade Me Motors', 'portal', 180000),
  ('WEB', 'Our website', 'website', 60000),
  ('FB', 'Facebook Marketplace', 'social', 40000),
  ('OEM', 'Brand website referrals', 'oem', 0),
  ('WALK', 'Walk-in', 'walk_in', 0),
  ('PHONE', 'Phone', 'phone', 0),
  ('REF', 'Referral', 'referral', 0),
  ('REP', 'Repeat customer', 'repeat', 0)
on conflict (code) do nothing;

insert into vehicles (stock_no, rego, vin, year, make, model, variant, body, fuel, odometer_km, price_cents, site_id, status, in_stock_on)
select x.stock, x.rego, x.vin, x.yr, x.make, x.model, x.variant, x.body, x.fuel, x.km, x.price, si.id, x.status, biz_today() - x.days
from (values
  ('24101', 'PQR101', 'JTMRWRFV10D100101', 2021, 'Toyota', 'RAV4', 'GX Hybrid', 'SUV', 'hybrid', 41200, 3899000::bigint, 'HAM', 'in_stock', 34),
  ('24102', 'MZC202', 'JM0KF4W7A00102202', 2019, 'Mazda', 'CX-5', 'GSX', 'SUV', 'petrol', 68900, 2999000, 'HAM', 'in_stock', 61),
  ('24103', 'RNG303', 'MPBUMFF50LX103303', 2020, 'Ford', 'Ranger', 'XLT', 'ute', 'diesel', 72400, 4499000, 'HAM', 'in_stock', 22),
  ('24104', 'CRL404', 'JTNKU3JE60J104404', 2018, 'Toyota', 'Corolla', 'GX', 'hatch', 'petrol', 88100, 1899000, 'HAM', 'in_stock', 95),
  ('24105', 'KSP505', 'KNAPU81BMN7105505', 2022, 'Kia', 'Sportage', 'LX', 'SUV', 'petrol', 23900, 3699000, 'HAM', 'on_hold', 18),
  ('24106', 'SWF606', 'JS2ZC83S0H6106606', 2017, 'Suzuki', 'Swift', 'GLX', 'hatch', 'petrol', 74300, 1399000, 'HAM', 'in_stock', 47),
  ('24107', 'OUT707', 'JMFXDGF7WLZ107707', 2020, 'Mitsubishi', 'Outlander', 'PHEV VRX', 'SUV', 'plug-in hybrid', 52800, 3299000, 'HAM', 'in_stock', 12),
  ('24201', 'HLX801', 'MR0FA3CD800201801', 2021, 'Toyota', 'Hilux', 'SR5', 'ute', 'diesel', 58700, 4899000, 'TGA', 'on_hold', 29),
  ('24202', 'CRV902', 'MRHRW2850KP202902', 2019, 'Honda', 'CR-V', 'Sport', 'SUV', 'petrol', 61500, 2799000, 'TGA', 'on_hold', 40),
  ('24203', 'LEF103', 'SJNFAAZE0U6203103', 2016, 'Nissan', 'Leaf', '30kWh', 'hatch', 'electric', 81900, 1199000, 'TGA', 'in_stock', 73),
  ('24204', 'MGZ204', 'LSJW74U99NZ204204', 2022, 'MG', 'ZS EV', 'Excite', 'SUV', 'electric', 19800, 2999000, 'TGA', 'in_stock', 9),
  ('24205', 'GLF305', 'WVWZZZAUZJW205305', 2018, 'Volkswagen', 'Golf', 'TSI Comfortline', 'hatch', 'petrol', 69300, 1999000, 'TGA', 'in_stock', 56),
  ('24090', 'TUC090', 'KMHJ381ABKU090090', 2019, 'Hyundai', 'Tucson', 'Elite', 'SUV', 'petrol', 54200, 3199000, 'HAM', 'sold', 70),
  ('24091', 'AQA091', 'NHP100009109100', 2015, 'Toyota', 'Aqua', 'S', 'hatch', 'hybrid', 96400, 1599000, 'HAM', 'sold', 88),
  ('24092', 'FCS092', 'WF0PXXGCHPKA92092', 2019, 'Ford', 'Focus', 'Titanium', 'hatch', 'petrol', 47100, 2199000, 'HAM', 'sold', 66),
  ('24093', 'MZ3093', 'JM0BP2H7A00093093', 2020, 'Mazda', 'Mazda3', 'GTX', 'hatch', 'petrol', 39800, 2699000, 'TGA', 'sold', 81),
  ('24094', 'JAZ094', 'JHMGR3850KS094094', 2019, 'Honda', 'Jazz', 'RS', 'hatch', 'petrol', 42300, 1799000, 'TGA', 'sold', 92)
) x(stock, rego, vin, yr, make, model, variant, body, fuel, km, price, site, status, days)
join sites si on si.code = x.site
on conflict (stock_no) do nothing;

insert into contacts (code, full_name, mobile, email, suburb, marketing_consent, consent_at, consent_source, unsubscribe_requested_at, unsubscribed_at, licence_no, licence_expires_on)
select x.code, x.name, x.mobile, x.email, x.suburb, x.consent,
       case when x.consent = 'none' then null else now() - x.consent_age end, x.csrc,
       case when x.unsub_req is null then null else now() - x.unsub_req end,
       case when x.unsub_done is null then null else now() - x.unsub_done end,
       x.lic, case when x.lic_days is null then null else biz_today() + x.lic_days end
from (values
  ('C-0101', 'Gary Simmons', '027 400 0101', 'gary.simmons@example.com', 'Hillcrest', 'inferred', interval '33 months', 'Enquiry', null::interval, null::interval, null::text, null::int),
  ('C-0102', 'Lisa Ward', '027 400 0102', 'lisa.ward@example.com', 'Rototuna', 'inferred', interval '32 months', 'Enquiry', null, null, null, null),
  ('C-0103', 'Ken Moana', '027 400 0103', null, 'Frankton', 'inferred', interval '31 months', 'Enquiry', null, null, null, null),
  ('C-0104', 'Hemi Walker', '027 400 0104', 'hemi.walker@example.com', 'Chartwell', 'inferred', interval '30 days', 'Enquiry', null, null, null, null),
  ('C-0105', 'Sophie Grant', '027 400 0105', 'sophie.grant@example.com', 'Te Rapa', 'none', interval '0 days', null, null, null, null, null),
  ('C-0106', 'Tom Fraser', '027 400 0106', 'tom.fraser@example.com', 'Mount Maunganui', 'inferred', interval '60 days', 'Enquiry', null, null, null, null),
  ('C-0107', 'Anna Lee', '027 400 0107', 'anna.lee@example.com', 'Flagstaff', 'express', interval '30 days', 'Ticked the box on the test drive form', null, null, 'DL100107', 900),
  ('C-0108', 'Rangi Parata', '027 400 0108', 'rangi.parata@example.com', 'Ngaruawahia', 'express', interval '45 days', 'Ticked the box on the website enquiry', null, null, 'DL100108', 1200),
  ('C-0109', 'Jess Moore', '027 400 0109', 'jess.moore@example.com', 'Papamoa', 'express', interval '60 days', 'Asked to hear about new stock', null, null, 'DL100109', 700),
  ('C-0110', 'Peter Young', '027 400 0110', 'peter.young@example.com', 'Bethlehem', 'express', interval '200 days', 'Bought from us', interval '12 days', null, null, null),
  ('C-0111', 'Kate Hall', '027 400 0111', 'kate.hall@example.com', 'Greerton', 'express', interval '300 days', 'Bought from us', interval '20 days', interval '20 days', null, null),
  ('C-0112', 'Mark Hughes', '027 400 0112', 'mark.hughes@example.com', 'Huntington', 'express', interval '20 days', 'Ticked the box on the Trade Me enquiry', null, null, 'DL100112', 1500),
  ('C-0113', 'Wiremu Hapi', '027 400 0113', null, 'Dinsdale', 'inferred', interval '50 days', 'Walked in', null, null, 'DL100113', 400),
  ('C-0114', 'Olivia Chen', '027 400 0114', 'olivia.chen@example.com', 'Rototuna', 'inferred', interval '12 days', 'Enquiry', null, null, null, null),
  ('C-0115', 'Sam Patel', '027 400 0115', 'sam.patel@example.com', 'Hamilton East', 'express', interval '8 days', 'Ticked the box on the website enquiry', null, null, null, null),
  ('C-0116', 'Grace Kim', '027 400 0116', 'grace.kim@example.com', 'Otumoetai', 'inferred', interval '9 days', 'Enquiry', null, null, 'DL100116', 1100),
  ('C-0117', 'Liam Murphy', '027 400 0117', 'liam.murphy@example.com', 'Glenview', 'inferred', interval '4 days', 'Enquiry', null, null, null, null),
  ('C-0118', 'Ella Thompson', '027 400 0118', 'ella.thompson@example.com', 'Te Awamutu', 'express', interval '3 days', 'Brand website opt-in', null, null, null, null),
  ('C-0119', 'Noah Wilson', '027 400 0119', 'noah.wilson@example.com', 'Welcome Bay', 'inferred', interval '6 days', 'Enquiry', null, null, null, null),
  ('C-0120', 'Ruby Davis', '027 400 0120', 'ruby.davis@example.com', 'Nawton', 'inferred', interval '7 days', 'Enquiry', null, null, null, null),
  ('C-0121', 'Jack Taylor', '027 400 0121', 'jack.taylor@example.com', 'Fairfield', 'express', interval '10 days', 'Ticked the box on the website enquiry', null, null, 'DL100121', 800),
  ('C-0122', 'Mia Robinson', '027 400 0122', 'mia.robinson@example.com', 'Tauriko', 'inferred', interval '5 days', 'Enquiry', null, null, 'DL100122', 1300),
  ('C-0123', 'Leo Martin', '027 400 0123', null, 'Melville', 'inferred', interval '14 days', 'Phoned in', null, null, null, null),
  ('C-0124', 'Isla Brown', '027 400 0124', 'isla.brown@example.com', 'Claudelands', 'express', interval '15 days', 'Ticked the box on the website enquiry', null, null, 'DL100124', 1000),
  ('C-0125', 'Ethan Clark', '027 400 0125', 'ethan.clark@example.com', 'Brookfield', 'inferred', interval '16 days', 'Enquiry', null, null, 'DL100125', 600),
  ('C-0126', 'Zoe White', '027 400 0126', 'zoe.white@example.com', 'Matua', 'express', interval '18 days', 'Referred by Jess Moore, asked for updates', null, null, 'DL100126', 1400),
  ('C-0127', 'Henry Scott', '027 400 0127', 'henry.scott@example.com', 'St Andrews', 'inferred', interval '6 minutes', 'Enquiry', null, null, null, null),
  ('C-0128', 'Lucy Walker', '027 400 0128', 'lucy.walker@example.com', 'Judea', 'inferred', interval '50 minutes', 'Enquiry', null, null, null, null),
  ('C-0129', 'Ari Ngata', '027 400 0129', null, 'Pukete', 'none', interval '0 days', null, null, null, null, null),
  ('C-0130', 'Chloe Evans', '027 400 0130', 'chloe.evans@example.com', 'Cambridge', 'express', interval '20 minutes', 'Brand website opt-in', null, null, null, null)
) x(code, name, mobile, email, suburb, consent, consent_age, csrc, unsub_req, unsub_done, lic, lic_days)
on conflict (code) do nothing;

-- Leads. age = how long ago it arrived, resp = how long until a person answered (null: nobody has).
insert into leads (code, contact_id, source_id, site_id, vehicle_id, wanted, has_trade, wants_finance, received_at,
                   assigned_to, assigned_at, first_response_at, stage, lost_reason, next_action, next_action_on, closed_at)
select x.code, c.id, src.id, si.id, v.id, x.wanted, x.trade, x.fin, now() - x.age,
       s.id, case when s.id is null then null else now() - x.age + interval '1 minute' end,
       case when x.resp is null then null else now() - x.age + x.resp end,
       x.stage, x.lost, x.na, case when x.na_days is null then null else biz_today() + x.na_days end,
       case when x.closed is null then null else now() - x.closed end
from (values
  ('L-1001', 'C-0101', 'TM', 'HAM', null::text, 'Ute under 30k', false, true, interval '33 months', 'S02', interval '7 minutes', 'lost', 'Bought elsewhere', null::text, null::int, interval '32 months'),
  ('L-1002', 'C-0102', 'WEB', 'HAM', null, 'Small hatch for a first car', false, false, interval '32 months', 'S03', interval '12 minutes', 'lost', 'Stopped replying', null, null, interval '31 months'),
  ('L-1003', 'C-0103', 'PHONE', 'HAM', null, 'Diesel SUV', true, false, interval '31 months', 'S02', interval '5 minutes', 'lost', 'Price', null, null, interval '30 months'),
  ('L-1004', 'C-0104', 'TM', 'HAM', '24102', null, false, false, interval '30 days', 'S03', interval '9 minutes', 'lost', 'Bought elsewhere', null, null, interval '20 days'),
  ('L-1005', 'C-0105', 'FB', 'HAM', '24106', null, false, true, interval '45 days', 'S02', interval '26 minutes', 'lost', 'Finance declined', null, null, interval '35 days'),
  ('L-1006', 'C-0106', 'WEB', 'TGA', '24203', null, true, false, interval '60 days', 'S06', interval '11 minutes', 'lost', 'Price', null, null, interval '50 days'),
  ('L-1007', 'C-0107', 'TM', 'HAM', '24092', null, false, false, interval '32 days', 'S03', interval '4 minutes', 'sold', null, null, null, interval '25 days'),
  ('L-1008', 'C-0108', 'WEB', 'TGA', '24093', null, true, true, interval '48 days', 'S05', interval '17 minutes', 'sold', null, null, null, interval '40 days'),
  ('L-1009', 'C-0109', 'REF', 'TGA', '24094', null, false, false, interval '62 days', 'S06', interval '3 minutes', 'sold', null, null, null, interval '55 days'),
  ('L-1010', 'C-0112', 'TM', 'HAM', '24090', null, true, false, interval '20 days', 'S02', interval '6 minutes', 'sold', null, null, null, interval '10 days'),
  ('L-1011', 'C-0113', 'WALK', 'HAM', '24091', null, false, false, interval '50 days', 'S03', interval '1 minute', 'sold', null, null, null, interval '40 days'),
  ('L-1012', 'C-0114', 'TM', 'HAM', '24101', null, false, true, interval '12 days', 'S03', interval '4 minutes', 'contacted', null, null, null, null),
  ('L-1013', 'C-0115', 'WEB', 'HAM', '24103', null, true, false, interval '8 days', 'S02', interval '12 minutes', 'appointment', null, 'Call to confirm Saturday''s visit', -3, null),
  ('L-1014', 'C-0116', 'FB', 'TGA', '24204', null, true, false, interval '9 days', 'S06', interval '35 minutes', 'negotiating', null, 'Firm up the trade-in number', 1, null),
  ('L-1015', 'C-0117', 'TM', 'HAM', '24107', null, false, false, interval '4 days', 'S03', interval '8 minutes', 'appointment', null, 'Visit booked', 1, null),
  ('L-1016', 'C-0118', 'OEM', 'HAM', '24105', null, false, true, interval '3 days', 'S02', interval '3 minutes', 'appointment', null, 'Test drive booked', 2, null),
  ('L-1017', 'C-0119', 'WEB', 'TGA', '24205', null, false, false, interval '6 days', 'S05', interval '95 minutes', 'appointment', null, null, null, null),
  ('L-1018', 'C-0120', 'TM', 'HAM', '24104', null, false, true, interval '7 days', 'S02', interval '22 minutes', 'appointment', null, null, null, null),
  ('L-1019', 'C-0121', 'WEB', 'HAM', '24103', null, true, true, interval '10 days', 'S03', interval '6 minutes', 'test_drive', null, 'Send the finance numbers', 1, null),
  ('L-1020', 'C-0122', 'TM', 'TGA', '24201', null, false, false, interval '5 days', 'S06', interval '14 minutes', 'test_drive', null, null, null, null),
  ('L-1021', 'C-0123', 'PHONE', 'HAM', '24102', null, false, false, interval '14 days', 'S03', interval '2 minutes', 'negotiating', null, 'Counter offer on the CX-5', 2, null),
  ('L-1022', 'C-0124', 'WEB', 'HAM', '24105', null, false, true, interval '15 days', 'S02', interval '9 minutes', 'negotiating', null, 'Chase the finance approval', 1, null),
  ('L-1023', 'C-0125', 'TM', 'TGA', '24202', null, true, false, interval '16 days', 'S05', interval '41 minutes', 'negotiating', null, 'Book the delivery', 2, null),
  ('L-1024', 'C-0126', 'REF', 'TGA', '24201', null, false, true, interval '18 days', 'S06', interval '18 minutes', 'negotiating', null, 'Book the delivery', 3, null),
  ('L-1025', 'C-0127', 'TM', 'HAM', '24101', null, false, false, interval '6 minutes', 'S02', null, 'new', null, null, null, null),
  ('L-1026', 'C-0128', 'WEB', 'TGA', '24204', null, false, true, interval '50 minutes', 'S05', null, 'new', null, null, null, null),
  ('L-1027', 'C-0129', 'FB', 'HAM', '24106', null, false, false, interval '3 hours', null, null, 'new', null, null, null, null),
  ('L-1028', 'C-0130', 'OEM', 'HAM', '24107', null, true, false, interval '20 minutes', 'S04', null, 'new', null, null, null, null),
  ('L-1029', 'C-0114', 'TM', 'HAM', '24101', null, false, true, interval '2 hours', 'S03', null, 'new', null, null, null, null)
) x(code, contact, source, site, stock, wanted, trade, fin, age, staff, resp, stage, lost, na, na_days, closed)
join contacts c on c.code = x.contact
join lead_sources src on src.code = x.source
join sites si on si.code = x.site
left join vehicles v on v.stock_no = x.stock
left join staff s on s.code = x.staff
on conflict (code) do nothing;

-- Olivia came back through Trade Me on the same car: one lead, not two.
update leads set duplicate_of = (select id from leads where code = 'L-1012')
where code = 'L-1029' and duplicate_of is null;

insert into appraisals (code, lead_id, contact_id, rego, year, make, model, odometer_km, condition, offer_cents, appraised_by, appraised_at, valid_until, ppsr_checked_on, money_owing_cents, status)
select x.code, l.id, l.contact_id, x.rego, x.yr, x.make, x.model, x.km, x.cond, x.offer, s.id, now() - x.age, biz_today() + x.valid,
       case when x.ppsr is null then null else biz_today() - x.ppsr end, x.owing, x.status
from (values
  ('A-301', 'L-1010', 'HJK411', 2014, 'Toyota', 'Corolla', 121400, 'Tidy, two new tyres needed', 650000::bigint, 'S01', interval '12 days', -5, 12::int, 0::bigint, 'accepted'),
  ('A-302', 'L-1014', 'BNM522', 2016, 'Mazda', 'CX-3', 98300, 'Stone chips on the bonnet, full service history', 1150000, 'S01', interval '5 days', 2, null, null, 'open'),
  ('A-303', 'L-1023', 'XCV633', 2013, 'Nissan', 'X-Trail', 143900, 'Worn interior, runs well', 480000, 'S01', interval '9 days', -2, null, null, 'accepted'),
  ('A-304', 'L-1006', 'TYU744', 2012, 'Honda', 'Fit', 151000, 'Rust on the sills', 210000, 'S01', interval '58 days', -51, null, null, 'declined')
) x(code, lead, rego, yr, make, model, km, cond, offer, staff, age, valid, ppsr, owing, status)
join leads l on l.code = x.lead
join staff s on s.code = x.staff
on conflict (code) do nothing;

insert into deals (code, lead_id, contact_id, vehicle_id, salesperson_id, sale_price_cents, appraisal_id, trade_allowance_cents, payout_cents,
                   deposit_cents, deposit_method, balance_method, finance_status, lender, credit_consent_at, status, written_on, delivered_on)
select x.code, l.id, l.contact_id, v.id, l.assigned_to, x.price, a.id, x.trade, 0, x.dep, x.dep_m, x.bal_m, x.fin, x.lender,
       case when x.consent is null then null else now() - x.consent end, x.status, biz_today() - x.written,
       case when x.delivered is null then null else biz_today() - x.delivered end
from (values
  ('D-501', 'L-1010', '24090', 3150000::bigint, 'A-301', 650000::bigint, 100000::bigint, 'card', 'transfer', 'none', null::text, null::interval, 'delivered', 13, 10::int),
  ('D-502', 'L-1022', '24105', 3650000, null, 0, 200000, 'card', 'finance', 'applied', 'Harbour Finance', null, 'written', 3, null),
  ('D-503', 'L-1023', '24202', 2750000, 'A-303', 480000, 50000, 'transfer', 'transfer', 'none', null, null, 'written', 4, null),
  ('D-504', 'L-1011', '24091', 1599000, null, 0, 400000, 'cash', 'cash', 'none', null, null, 'delivered', 41, 40),
  ('D-505', 'L-1024', '24201', 4850000, null, 0, 500000, 'transfer', 'finance', 'approved', 'Harbour Finance', interval '10 days', 'written', 8, null),
  ('D-506', 'L-1007', '24092', 2150000, null, 0, 100000, 'card', 'transfer', 'none', null, null, 'delivered', 27, 25),
  ('D-507', 'L-1008', '24093', 2650000, null, 0, 300000, 'transfer', 'finance', 'approved', 'Harbour Finance', interval '45 days', 'delivered', 44, 40),
  ('D-508', 'L-1009', '24094', 1790000, null, 0, 100000, 'transfer', 'transfer', 'none', null, null, 'delivered', 57, 55)
) x(code, lead, stock, price, appraisal, trade, dep, dep_m, bal_m, fin, lender, consent, status, written, delivered)
join leads l on l.code = x.lead
join vehicles v on v.stock_no = x.stock
left join appraisals a on a.code = x.appraisal
on conflict (code) do nothing;

-- The activity history, appointments and test drives load once.
insert into activities (lead_id, contact_id, staff_id, kind, direction, body, at)
select l.id, l.contact_id, null, 'system', 'in', 'Enquiry received from ' || src.name, l.received_at
from leads l join lead_sources src on src.id = l.source_id
where not exists (select 1 from settings where key = 'demo_seeded');

insert into activities (lead_id, contact_id, staff_id, kind, direction, body, at)
select l.id, l.contact_id, l.assigned_to, 'call', 'out', 'First call back', l.first_response_at
from leads l
where l.first_response_at is not null and not exists (select 1 from settings where key = 'demo_seeded');

insert into activities (lead_id, contact_id, staff_id, kind, direction, marketing, body, at)
select l.id, coalesce(l.contact_id, c.id), s.id, x.kind, x.dir, x.mkt, x.body, now() - x.age
from (values
  ('L-1012', null::text, 'S03', 'sms', 'out', false, 'Sent the RAV4 photos and the finance calculator', interval '9 days'),
  ('L-1013', null, 'S02', 'call', 'out', false, 'Booked a Saturday look at the Ranger', interval '5 days'),
  ('L-1014', null, 'S06', 'visit', 'in', false, 'Came in with the CX-3 for an appraisal', interval '5 days'),
  ('L-1014', null, 'S06', 'email', 'out', false, 'Sent the trade-in offer, valid a week', interval '2 days'),
  ('L-1015', null, 'S03', 'sms', 'out', false, 'Confirmed tomorrow''s visit', interval '1 day'),
  ('L-1016', null, 'S02', 'call', 'out', false, 'Booked a test drive in the Sportage', interval '2 days'),
  ('L-1017', null, 'S05', 'call', 'out', false, 'Booked a visit to see the Golf', interval '4 days'),
  ('L-1018', null, 'S02', 'sms', 'out', false, 'Booked a visit for the Corolla', interval '3 days'),
  ('L-1019', null, 'S03', 'visit', 'in', false, 'Test drove the Ranger, wants finance numbers', interval '3 days'),
  ('L-1020', null, 'S06', 'visit', 'in', false, 'Out on a test drive in the Hilux', interval '5 hours'),
  ('L-1021', null, 'S03', 'visit', 'in', false, 'Test drove the CX-5, offered below the ticket', interval '6 days'),
  ('L-1021', null, 'S03', 'call', 'out', false, 'Talked through the counter offer', interval '1 day'),
  ('L-1022', null, 'S02', 'visit', 'in', false, 'Signed the agreement subject to finance', interval '3 days'),
  ('L-1023', null, 'S05', 'visit', 'in', false, 'Signed for the CR-V with the X-Trail as trade', interval '4 days'),
  ('L-1024', null, 'S06', 'call', 'out', false, 'Finance approved, delivery to book', interval '7 days'),
  (null, 'C-0105', 'S02', 'email', 'out', true, 'New arrivals this week: three hatchbacks under twenty thousand', interval '4 days'),
  (null, 'C-0111', 'S05', 'sms', 'out', true, 'Spring service and trade-up evening, Thursday', interval '2 days'),
  (null, 'C-0109', 'S06', 'email', 'out', true, 'New arrivals this week', interval '4 days')
) x(lead, contact, staff, kind, dir, mkt, body, age)
left join leads l on l.code = x.lead
left join contacts c on c.code = x.contact
left join staff s on s.code = x.staff
where not exists (select 1 from settings where key = 'demo_seeded');

insert into appointments (lead_id, staff_id, starts_at, kind, outcome)
select l.id, l.assigned_to, ((biz_today() + x.day_offset) + x.at_time::time) at time zone coalesce((select value from settings where key = 'timezone'), 'Pacific/Auckland'), x.kind, x.outcome
from (values
  ('L-1013', -4, '10:00', 'visit', 'showed'),
  ('L-1015', 1, '10:30', 'visit', null::text),
  ('L-1016', 2, '11:00', 'test_drive', null),
  ('L-1017', -1, '14:00', 'visit', null),
  ('L-1018', -2, '11:30', 'visit', 'no_show'),
  ('L-1019', -3, '15:00', 'test_drive', 'showed'),
  ('L-1024', 3, '16:00', 'delivery', null)
) x(lead, day_offset, at_time, kind, outcome)
join leads l on l.code = x.lead
where not exists (select 1 from settings where key = 'demo_seeded');

insert into test_drives (lead_id, contact_id, vehicle_id, staff_id, out_at, back_at, licence_no, licence_expires_on, licence_sighted, odometer_out, odometer_back)
select l.id, l.contact_id, v.id, l.assigned_to, now() - x.out_age, case when x.back_age is null then null else now() - x.back_age end,
       x.lic, case when x.lic is null then null else biz_today() + 800 end, x.sighted, v.odometer_km, case when x.back_age is null then null else v.odometer_km + 14 end
from (values
  ('L-1019', '24103', interval '3 days', interval '3 days' - interval '40 minutes', 'DL100121', true),
  ('L-1020', '24201', interval '5 hours', null::interval, 'DL100122', true),
  ('L-1021', '24102', interval '6 days', interval '6 days' - interval '30 minutes', null::text, false),
  ('L-1010', '24090', interval '18 days', interval '18 days' - interval '35 minutes', 'DL100112', true)
) x(lead, stock, out_age, back_age, lic, sighted)
join leads l on l.code = x.lead
join vehicles v on v.stock_no = x.stock
where not exists (select 1 from settings where key = 'demo_seeded');

insert into settings (key, value, note) values ('demo_seeded', 'yes', 'The demo history has loaded. Delete this row to load it again on a fresh database.')
on conflict (key) do nothing;
