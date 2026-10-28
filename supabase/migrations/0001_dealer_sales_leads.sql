-- Dealer Sales Leads for Claude Code: the schema.
-- Everything a car dealer's sales floor runs on between "someone asked about a car" and "the car
-- drove away": the yards, the sales team, lead sources and what they cost, a light stock list (the
-- DMS keeps the real one), contacts and their marketing consent, leads, every call, text and email,
-- appointments, test drives, trade-in appraisals and written deals with their finance.
-- Plain Postgres. Runs on any Postgres 14+ and on PGlite. No extensions.

create table settings (
  key text primary key,
  value text not null,
  note text
);

-- The business day in the dealer's own time zone, so "today" is the yard's today, not UTC's.
create or replace function biz_today() returns date language sql stable as $$
  select (now() at time zone coalesce((select value from settings where key = 'timezone'), 'Pacific/Auckland'))::date
$$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table sites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  full_name text not null,
  role text not null check (role in ('salesperson', 'sales_manager', 'business_manager', 'reception')),
  site_id uuid references sites(id),
  email text,
  mobile text,
  active boolean not null default true,
  takes_leads boolean not null default true,
  max_open_leads integer not null default 25 check (max_open_leads >= 0),
  away_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lead_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null default 'other' check (kind in ('portal', 'website', 'oem', 'social', 'walk_in', 'phone', 'referral', 'repeat', 'other')),
  monthly_spend_cents bigint not null default 0 check (monthly_spend_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  stock_no text not null unique,
  rego text,
  vin text,
  year integer,
  make text not null,
  model text not null,
  variant text,
  body text,
  fuel text,
  odometer_km integer,
  price_cents bigint check (price_cents is null or price_cents >= 0),
  site_id uuid references sites(id),
  status text not null default 'in_stock' check (status in ('in_stock', 'on_hold', 'sold', 'gone')),
  in_stock_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  full_name text not null,
  mobile text,
  email text,
  suburb text,
  -- Consent to receive marketing (new arrivals, offers, events). Replying to a person's own
  -- enquiry is not marketing; promoting something they did not ask about is.
  marketing_consent text not null default 'none' check (marketing_consent in ('express', 'inferred', 'none')),
  consent_at timestamptz,
  consent_source text,
  unsubscribe_requested_at timestamptz,
  unsubscribed_at timestamptz,
  licence_no text,
  licence_expires_on date,
  anonymised_at timestamptz,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_mobile_idx on contacts (regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g'));
create index contacts_email_idx on contacts (lower(email));

create table leads (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  contact_id uuid not null references contacts(id),
  source_id uuid references lead_sources(id),
  site_id uuid references sites(id),
  vehicle_id uuid references vehicles(id),
  wanted text,
  budget_cents bigint,
  has_trade boolean not null default false,
  wants_finance boolean not null default false,
  received_at timestamptz not null default now(),
  assigned_to uuid references staff(id),
  assigned_at timestamptz,
  first_response_at timestamptz,
  stage text not null default 'new' check (stage in ('new', 'contacted', 'appointment', 'test_drive', 'negotiating', 'sold', 'lost')),
  lost_reason text,
  next_action text,
  next_action_on date,
  duplicate_of uuid references leads(id),
  closed_at timestamptz,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stage <> 'lost' or lost_reason is not null)
);
create index leads_contact_idx on leads (contact_id);
create index leads_open_idx on leads (stage) where stage not in ('sold', 'lost');

create table activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  contact_id uuid references contacts(id),
  staff_id uuid references staff(id),
  kind text not null check (kind in ('call', 'sms', 'email', 'visit', 'note', 'stage', 'assign', 'consent', 'system')),
  direction text check (direction in ('in', 'out')),
  marketing boolean not null default false,
  body text,
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index activities_lead_idx on activities (lead_id, at);
create index activities_contact_idx on activities (contact_id, at);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  staff_id uuid references staff(id),
  starts_at timestamptz not null,
  kind text not null default 'visit' check (kind in ('visit', 'test_drive', 'appraisal', 'delivery')),
  outcome text check (outcome in ('showed', 'no_show', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table test_drives (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  contact_id uuid not null references contacts(id),
  vehicle_id uuid not null references vehicles(id),
  staff_id uuid references staff(id),
  out_at timestamptz not null default now(),
  back_at timestamptz,
  licence_no text,
  licence_expires_on date,
  licence_sighted boolean not null default false,
  odometer_out integer,
  odometer_back integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table appraisals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  lead_id uuid references leads(id),
  contact_id uuid not null references contacts(id),
  rego text,
  vin text,
  year integer,
  make text,
  model text,
  odometer_km integer,
  condition text,
  offer_cents bigint not null check (offer_cents >= 0),
  appraised_by uuid references staff(id),
  appraised_at timestamptz not null default now(),
  valid_until date,
  ppsr_checked_on date,
  money_owing_cents bigint check (money_owing_cents is null or money_owing_cents >= 0),
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table deals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  lead_id uuid references leads(id),
  contact_id uuid not null references contacts(id),
  vehicle_id uuid not null references vehicles(id),
  salesperson_id uuid references staff(id),
  sale_price_cents bigint not null check (sale_price_cents >= 0),
  appraisal_id uuid references appraisals(id),
  trade_allowance_cents bigint not null default 0 check (trade_allowance_cents >= 0),
  payout_cents bigint not null default 0 check (payout_cents >= 0),
  deposit_cents bigint not null default 0 check (deposit_cents >= 0),
  deposit_method text not null default 'none' check (deposit_method in ('none', 'cash', 'cheque', 'card', 'transfer')),
  balance_method text not null default 'transfer' check (balance_method in ('cash', 'cheque', 'card', 'transfer', 'finance')),
  finance_status text not null default 'none' check (finance_status in ('none', 'applied', 'approved', 'declined')),
  lender text,
  credit_consent_at timestamptz,
  status text not null default 'written' check (status in ('written', 'delivered', 'cancelled')),
  written_on date not null default current_date,
  delivered_on date,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['sites', 'staff', 'lead_sources', 'vehicles', 'contacts', 'leads', 'appointments', 'test_drives', 'appraisals', 'deals'] loop
    execute format('create trigger %I before update on %I for each row execute function touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- Every open lead with the numbers the sales floor runs on: age, response time, last touch, days quiet.
create view v_open_leads as
select l.id, l.code, l.stage, l.received_at, l.first_response_at, l.next_action, l.next_action_on,
       c.code as contact_code, c.full_name as contact, c.mobile, c.email,
       s.code as salesperson_code, s.full_name as salesperson, s.away_until,
       src.code as source_code, src.name as source, si.code as site,
       v.stock_no, trim(concat_ws(' ', v.year, v.make, v.model)) as vehicle, l.wanted,
       (select max(a.at) from activities a where a.lead_id = l.id and a.kind in ('call', 'sms', 'email', 'visit')) as last_touch_at,
       round(extract(epoch from (coalesce(l.first_response_at, now()) - l.received_at)) / 60) as response_minutes,
       (biz_today() - coalesce((select max(a.at) from activities a where a.lead_id = l.id and a.kind in ('call', 'sms', 'email', 'visit')), l.received_at)::date) as days_quiet
from leads l
join contacts c on c.id = l.contact_id
left join staff s on s.id = l.assigned_to
left join lead_sources src on src.id = l.source_id
left join sites si on si.id = l.site_id
left join vehicles v on v.id = l.vehicle_id
where l.stage not in ('sold', 'lost') and l.duplicate_of is null;

-- What each lead source turned into. One row per source, every lead it ever sent (duplicates excluded).
create view v_source_funnel as
select src.code, src.name, src.kind, src.monthly_spend_cents,
       count(l.id) as leads,
       count(l.first_response_at) as responded,
       count(*) filter (where exists (select 1 from appointments ap where ap.lead_id = l.id)) as appointments,
       count(*) filter (where exists (select 1 from test_drives td where td.lead_id = l.id)) as test_drives,
       count(*) filter (where l.stage = 'sold') as sold,
       count(*) filter (where l.stage = 'lost') as lost
from lead_sources src
left join leads l on l.source_id = src.id and l.duplicate_of is null
group by src.id;

-- Each person on the floor: what they hold and how fast they answer.
create view v_team as
select s.code, s.full_name, s.role, si.code as site, s.away_until, s.max_open_leads,
       (select count(*) from leads l where l.assigned_to = s.id and l.stage not in ('sold', 'lost') and l.duplicate_of is null) as open_leads,
       (select count(*) from leads l where l.assigned_to = s.id and l.stage not in ('sold', 'lost') and l.duplicate_of is null and l.next_action_on < biz_today()) as overdue,
       (select round(avg(extract(epoch from (l.first_response_at - l.received_at)) / 60)) from leads l where l.assigned_to = s.id and l.first_response_at is not null) as avg_response_minutes,
       (select count(*) from leads l where l.assigned_to = s.id and l.stage = 'sold') as sold,
       (select count(*) from leads l where l.assigned_to = s.id and l.stage in ('sold', 'lost')) as closed
from staff s left join sites si on si.id = s.site_id
where s.active;
