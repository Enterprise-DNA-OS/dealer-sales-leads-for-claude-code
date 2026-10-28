#!/usr/bin/env node
// dealer-sales-leads-for-claude-code: the one CLI. The slash commands call this; so can you.
//
//   node scripts/leads.mjs <command> [args] [--flags] [--json]
//   npm run leads -- <command> ...
//
// Run with no arguments (or `help`) for the command list.
//
// This records what a car dealer's sales floor runs on between the enquiry and the delivery: lead
// sources and what they cost, who gets each lead, how fast they answer, every call, text and email,
// appointments, test drives with the licence sighted, trade-in appraisals with the PPSR search, and
// written deals with their deposit and finance. Stock, workshop and accounts stay in your DMS: the
// stock list here is a light copy so a lead can name the car it is about. It sends nothing: replies,
// follow-ups and marketing are drafted to drafts/ and a person sends them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick, yesNo } from './lib/csv.mjs';
import { table, money, heading, truncate } from './lib/format.mjs';

// ---------------------------------------------------------------- the law, not a setting

// AML/CFT Act 2009 s 67A and reg 5AC of the AML/CFT (Definitions) Regulations 2011: since 11 May 2023 a
// dealer must not buy or sell a motor vehicle for cash of NZ$10,000 or more, in one payment or several
// related ones. Cheques count. A flat ban, so a constant, not a setting anyone can raise.
const CASH_LIMIT_CENTS = 1_000_000;
const CASH_METHODS = new Set(['cash', 'cheque']);

const OPEN_STAGES = ['new', 'contacted', 'appointment', 'test_drive', 'negotiating'];
const STAGES = [...OPEN_STAGES, 'sold', 'lost'];
const TOUCH_KINDS = new Set(['call', 'sms', 'email', 'visit']);

// ---------------------------------------------------------------- arguments

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'yes', 'trade', 'finance', 'marketing', 'clear', 'consent', 'out', 'back', 'past', 'in']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { flags.help = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name, value;
      if (eq > -1) { name = a.slice(2, eq); value = a.slice(eq + 1); }
      else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else args.push(a);
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

const n = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));
const nzd = (cents) => (cents === null || cents === undefined ? '' : money(cents, 'NZD'));
const pct = (a, b) => (n(b) ? `${Math.round((100 * n(a)) / n(b))}%` : '-');

let db;
let JSON_OUT = false;
let SETTINGS = {};
let TODAY = '';

function addDays(iso, k) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const t = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}
function iso(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// A timestamp in the yard's own time zone: "Wed 29 Oct 14:05".
function when(ts) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-NZ', {
    timeZone: SETTINGS.timezone || 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`;
}

// 6 -> "6 min", 190 -> "3 h 10", 2900 -> "2 d".
function mins(m) {
  if (m === null || m === undefined || m === '') return '';
  const x = Math.round(Number(m));
  if (x < 60) return `${x} min`;
  if (x < 60 * 24) return `${Math.floor(x / 60)} h${x % 60 ? ' ' + String(x % 60).padStart(2, '0') : ''}`;
  return `${Math.floor(x / 1440)} d`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s === 'today') return TODAY;
  if (s === 'yesterday') return addDays(TODAY, -1);
  if (s === 'tomorrow') return addDays(TODAY, 1);
  const rel = s.match(/^([+-])(\d+)d?$/);
  if (rel) return addDays(TODAY, (rel[1] === '-' ? -1 : 1) * Number(rel[2]));
  // NZ and AU exports write DD/MM/YYYY.
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD, today, tomorrow or +3.`);
}

function parseTime(v, what = 'time') {
  const s = str(v).trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/);
  if (!m) throw new CliError(`${what} should be a time like 10:30 or 2pm (got "${s}").`);
  let h = Number(m[1]);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || Number(m[2] || 0) > 59) throw new CliError(`${what} "${s}" is not a time of day.`);
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
}

function parseMoney(v, what = 'amount') {
  if (v === undefined || v === null || v === true || v === '') return null;
  const s = String(v).replace(/[$,\s]/g, '').replace(/^nzd/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new CliError(`${what} "${v}" is not a dollar amount.`);
  return Math.round(Number(s) * 100);
}

function intFlag(v, dflt) {
  if (v === undefined || v === true) return dflt;
  const x = Number(v);
  if (!Number.isInteger(x) || x < 0) throw new CliError(`"${v}" is not a whole number.`);
  return x;
}

const digits = (s) => String(s ?? '').replace(/[^0-9]/g, '');

// ---------------------------------------------------------------- lookups

function ambiguous(what, rows, label) {
  return new CliError(`More than one ${what} matches. Be more specific:\n${rows.map((r) => `  ${label(r)}`).join('\n')}`);
}

const LEAD_SQL = `select l.*, c.code as contact_code, c.full_name as contact, c.mobile, c.email, c.marketing_consent,
    s.code as salesperson_code, s.full_name as salesperson, src.code as source_code, src.name as source, si.code as site,
    v.stock_no, trim(concat_ws(' ', v.year, v.make, v.model)) as vehicle
  from leads l join contacts c on c.id = l.contact_id left join staff s on s.id = l.assigned_to
  left join lead_sources src on src.id = l.source_id left join sites si on si.id = l.site_id left join vehicles v on v.id = l.vehicle_id`;

async function findLead(ref) {
  if (!ref || ref === true) throw new CliError('Which lead? Give its code (L-1012) or part of the customer\'s name.');
  const r = String(ref).trim();
  const code = /^\d+$/.test(r) ? `L-${r}` : r;
  const exact = await db.query(`${LEAD_SQL} where lower(l.code) = lower($1) or lower(coalesce(l.external_ref, '')) = lower($1)`, [code]);
  if (exact.length === 1) return exact[0];
  const rows = await db.query(`${LEAD_SQL} where c.full_name ilike $1 or c.code ilike $2 order by l.received_at desc`, [`%${r}%`, r]);
  const open = rows.filter((x) => OPEN_STAGES.includes(x.stage) && !x.duplicate_of);
  if (rows.length === 1) return rows[0];
  if (open.length === 1) return open[0];
  if (!rows.length) throw new CliError(`No lead matches "${r}". Run: leads leads --all`);
  throw ambiguous('lead', rows, (x) => `${x.code}  ${x.contact} (${x.stage}${x.vehicle ? ', ' + x.vehicle : ''})`);
}

async function findContact(ref) {
  if (!ref || ref === true) throw new CliError('Who? Give a contact code (C-0114), a name, a mobile or an email.');
  const r = String(ref).trim();
  const d = digits(r);
  const rows = await db.query(`select * from contacts where lower(code) = lower($1) or lower(full_name) = lower($1) or full_name ilike $2
      or lower(coalesce(email, '')) = lower($1) or ($3 <> '' and length($3) >= 6 and regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') = $3) order by full_name`, [r, `%${r}%`, d]);
  const exact = rows.filter((x) => x.code.toLowerCase() === r.toLowerCase() || x.full_name.toLowerCase() === r.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No contact matches "${r}".`);
  throw ambiguous('contact', rows, (x) => `${x.code}  ${x.full_name} ${x.mobile || ''}`);
}

async function findStaff(ref) {
  if (!ref || ref === true) throw new CliError('Who? Give a staff code (S03) or part of a name. Run: leads team');
  const rows = await db.query(`select s.*, si.code as site from staff s left join sites si on si.id = s.site_id
    where lower(s.code) = lower($1) or s.full_name ilike $2 order by s.code`, [ref, `%${ref}%`]);
  const exact = rows.filter((x) => x.code.toLowerCase() === String(ref).toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No one on the team matches "${ref}". Run: leads team`);
  throw ambiguous('person', rows, (x) => `${x.code}  ${x.full_name} (${x.role})`);
}

async function findVehicle(ref) {
  if (!ref || ref === true) throw new CliError('Which car? Give a stock number, a rego, or the make and model.');
  const r = String(ref).trim();
  const exact = await db.query(`select * from vehicles where lower(stock_no) = lower($1) or lower(coalesce(rego, '')) = lower($1) or lower(coalesce(vin, '')) = lower($1)`, [r]);
  if (exact.length === 1) return exact[0];
  const rows = await db.query(`select * from vehicles where concat_ws(' ', year, make, model, variant) ilike $1 and status <> 'gone' order by status, stock_no`, [`%${r}%`]);
  const live = rows.filter((v) => v.status !== 'sold');
  if (rows.length === 1) return rows[0];
  if (live.length === 1) return live[0];
  if (!rows.length) throw new CliError(`No car matches "${r}". Run: leads stock`);
  throw ambiguous('car', rows, (v) => `${v.stock_no}  ${v.year} ${v.make} ${v.model} ${v.rego || ''} (${v.status})`);
}

async function findSource(ref) {
  if (!ref || ref === true) throw new CliError('Where did it come from? Give a source code (TM, WEB, FB). Run: leads sources');
  const rows = await db.query(`select * from lead_sources where lower(code) = lower($1) or lower(name) = lower($1) or name ilike $2 order by code`, [ref, `%${ref}%`]);
  const exact = rows.filter((x) => x.code.toLowerCase() === String(ref).toLowerCase() || x.name.toLowerCase() === String(ref).toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No lead source "${ref}". Run: leads sources, or add it: leads source-add <code> --name="..."`);
  throw ambiguous('lead source', rows, (x) => `${x.code}  ${x.name}`);
}

async function findSite(ref) {
  const rows = await db.query(`select * from sites where lower(code) = lower($1) or name ilike $2 or city ilike $2 order by code`, [ref, `%${ref}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No yard "${ref}". Yards: ${(await db.query('select code from sites order by code')).map((x) => x.code).join(', ')}`);
  throw ambiguous('yard', rows, (x) => `${x.code}  ${x.name}`);
}

async function findDeal(ref) {
  if (!ref || ref === true) throw new CliError('Which deal? Give its code (D-502), the lead (L-1022) or the customer\'s name.');
  const r = String(ref).trim();
  const sql = `select d.*, c.full_name as contact, c.code as contact_code, l.code as lead_code, v.stock_no, trim(concat_ws(' ', v.year, v.make, v.model)) as vehicle,
      a.code as appraisal_code, a.ppsr_checked_on, a.money_owing_cents, s.full_name as salesperson
    from deals d join contacts c on c.id = d.contact_id left join leads l on l.id = d.lead_id join vehicles v on v.id = d.vehicle_id
    left join appraisals a on a.id = d.appraisal_id left join staff s on s.id = d.salesperson_id`;
  const exact = await db.query(`${sql} where lower(d.code) = lower($1) or lower(coalesce(l.code, '')) = lower($1)`, [/^\d+$/.test(r) ? `D-${r}` : r]);
  if (exact.length === 1) return exact[0];
  const rows = await db.query(`${sql} where c.full_name ilike $1 order by d.written_on desc`, [`%${r}%`]);
  const live = rows.filter((x) => x.status === 'written');
  if (rows.length === 1) return rows[0];
  if (live.length === 1) return live[0];
  if (!rows.length) throw new CliError(`No deal matches "${r}". Run: leads deals --all`);
  throw ambiguous('deal', rows, (x) => `${x.code}  ${x.contact}, ${x.vehicle} (${x.status})`);
}

async function findAppraisal(ref) {
  const r = String(ref || '').trim();
  if (!r) throw new CliError('Which appraisal? Give its code (A-302) or the lead.');
  const rows = await db.query(`select a.*, c.full_name as contact, l.code as lead_code from appraisals a join contacts c on c.id = a.contact_id
    left join leads l on l.id = a.lead_id where lower(a.code) = lower($1) or lower(coalesce(l.code, '')) = lower($1) or lower(coalesce(a.rego, '')) = lower($1)
    order by a.appraised_at desc`, [/^\d+$/.test(r) ? `A-${r}` : r]);
  if (rows.length >= 1 && (rows.length === 1 || rows.filter((x) => x.status === 'open').length === 1)) return rows.length === 1 ? rows[0] : rows.find((x) => x.status === 'open');
  if (!rows.length) throw new CliError(`No appraisal matches "${r}". Run: leads appraisals --all`);
  throw ambiguous('appraisal', rows, (x) => `${x.code}  ${x.contact} ${x.year} ${x.make} ${x.model} (${x.status})`);
}

async function staffBy(flags) {
  return flags.by ? findStaff(flags.by) : null;
}

async function nextCode(tableName, prefix, start, width = 0) {
  const [r] = await db.query(`select max(nullif(regexp_replace(code, '[^0-9]', '', 'g'), '')::int) as m from ${tableName} where code like $1`, [`${prefix}%`]);
  const next = Math.max(n(r.m) + 1, start);
  return `${prefix}${width ? String(next).padStart(width, '0') : next}`;
}

// ---------------------------------------------------------------- output

function out(data, text) {
  if (JSON_OUT) console.log(JSON.stringify(data, null, 2));
  else console.log(typeof text === 'function' ? text() : text);
}

async function logActivity({ lead = null, contact = null, staff = null, kind, direction = null, marketing = false, body, at = null }) {
  await db.query(`insert into activities (lead_id, contact_id, staff_id, kind, direction, marketing, body, at) values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()))`,
    [lead?.id ?? null, contact?.id ?? lead?.contact_id ?? null, staff?.id ?? null, kind, direction, marketing, body, at]);
}

const setting = (key, dflt) => (SETTINGS[key] === undefined ? dflt : SETTINGS[key]);
const settingInt = (key, dflt) => { const x = Number(setting(key, dflt)); return Number.isFinite(x) ? x : dflt; };

// Working days between two dates (Monday to Friday; public holidays are on the operator).
function workingDaysSince(fromIso, toIso) {
  let count = 0;
  for (let d = addDays(fromIso, 1); d <= toIso; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) count++;
  }
  return count;
}

// ---------------------------------------------------------------- allocation

// Round robin by load: a salesperson at the lead's yard who takes leads, is not away, is under their cap,
// holding the fewest open leads; ties go to whoever was given a lead longest ago.
async function pickSalesperson(siteId) {
  const rows = await db.query(`
    select s.*, si.code as site,
      (select count(*) from leads l where l.assigned_to = s.id and l.stage not in ('sold','lost') and l.duplicate_of is null) as open_leads,
      (select max(l.assigned_at) from leads l where l.assigned_to = s.id) as last_assigned
    from staff s left join sites si on si.id = s.site_id
    where s.active and s.takes_leads and s.role = 'salesperson' and ($1::uuid is null or s.site_id = $1)
      and (s.away_until is null or s.away_until < biz_today())
    order by open_leads, last_assigned nulls first, s.code`, [siteId]);
  return rows.find((s) => n(s.open_leads) < n(s.max_open_leads)) || null;
}

// ---------------------------------------------------------------- reads

async function cmdStats() {
  const [s] = await db.query(`select
      (select count(*) from v_open_leads) as open_leads,
      (select count(*) from v_open_leads where first_response_at is null) as unanswered,
      (select count(*) from leads where duplicate_of is null and received_at >= now() - interval '7 days') as new_this_week,
      (select count(*) from appointments where outcome is null and starts_at::date between biz_today() and biz_today() + 7) as appointments_next_7_days,
      (select count(*) from test_drives where back_at is null) as cars_out_on_drives,
      (select count(*) from deals where status = 'written') as deals_written,
      (select count(*) from deals where status = 'delivered' and delivered_on >= biz_today() - 30) as delivered_last_30_days`);
  const data = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, n(v)]));
  out(data, () => heading(`${setting('business_name', 'The sales floor')} today`) + '\n' + table(Object.entries(data).map(([k, v]) => ({ k: k.replace(/_/g, ' '), v })), [
    { key: 'k', label: 'what' }, { key: 'v', label: 'count', align: 'right' }]));
}

async function cmdLeads(flags) {
  const where = [];
  const params = [];
  if (!flags.all) where.push(`l.stage not in ('sold','lost') and l.duplicate_of is null`);
  if (flags.stage) { params.push(String(flags.stage)); where.push(`l.stage = $${params.length}`); }
  if (flags.to) { const s = await findStaff(flags.to); params.push(s.id); where.push(`l.assigned_to = $${params.length}`); }
  if (flags.site) { const s = await findSite(flags.site); params.push(s.id); where.push(`l.site_id = $${params.length}`); }
  if (flags.source) { const s = await findSource(flags.source); params.push(s.id); where.push(`l.source_id = $${params.length}`); }
  const rows = await db.query(`${LEAD_SQL} ${where.length ? 'where ' + where.join(' and ') : ''} order by l.received_at desc`, params);
  out(rows.map((r) => ({ code: r.code, contact: r.contact, stage: r.stage, source: r.source_code, site: r.site, salesperson: r.salesperson_code, vehicle: r.vehicle || r.wanted, received_at: r.received_at, next_action_on: iso(r.next_action_on), duplicate_of: r.duplicate_of })),
    () => heading(`${flags.all ? 'All' : 'Open'} leads (${rows.length})`) + '\n' + table(rows, [
      { key: 'code', label: 'lead' }, { key: 'contact', label: 'customer' }, { key: 'stage', label: 'stage' }, { key: 'source_code', label: 'from' },
      { key: 'site', label: 'yard' }, { key: 'salesperson_code', label: 'who' }, { key: 'vehicle', label: 'car', width: 26, format: (v, r) => v || r.wanted || '' },
      { key: 'received_at', label: 'came in', format: when }, { key: 'next_action_on', label: 'next', format: iso }]));
}

async function cmdLead(ref) {
  const l = await findLead(ref);
  const acts = await db.query(`select a.*, s.code as who from activities a left join staff s on s.id = a.staff_id where a.lead_id = $1 or (a.lead_id is null and a.contact_id = $2) order by a.at`, [l.id, l.contact_id]);
  const dups = await db.query(`select l.code, l.received_at, src.name as source from leads l left join lead_sources src on src.id = l.source_id where l.duplicate_of = $1 order by l.received_at`, [l.id]);
  const appts = await db.query(`select * from appointments where lead_id = $1 order by starts_at`, [l.id]);
  const drives = await db.query(`select td.*, v.stock_no, trim(concat_ws(' ', v.year, v.make, v.model)) as vehicle from test_drives td join vehicles v on v.id = td.vehicle_id where td.lead_id = $1 order by out_at`, [l.id]);
  const apps = await db.query(`select * from appraisals where lead_id = $1 order by appraised_at`, [l.id]);
  const deals = await db.query(`select * from deals where lead_id = $1 order by written_on`, [l.id]);
  const response = l.first_response_at ? (new Date(l.first_response_at) - new Date(l.received_at)) / 60000 : null;
  const data = { lead: l, response_minutes: response === null ? null : Math.round(response), activities: acts, duplicates: dups, appointments: appts, test_drives: drives, appraisals: apps, deals };
  out(data, () => [
    heading(`${l.code}  ${l.contact} (${l.stage})`),
    `  ${l.mobile || ''}  ${l.email || ''}  marketing consent: ${l.marketing_consent}`,
    `  from ${l.source || '?'} into ${l.site || '?'}, ${when(l.received_at)}; with ${l.salesperson || 'nobody yet'}`,
    `  car: ${l.vehicle ? `${l.stock_no} ${l.vehicle}` : l.wanted || 'not named'}${l.has_trade ? '; has a trade-in' : ''}${l.wants_finance ? '; wants finance' : ''}`,
    `  first answered: ${response === null ? 'NOT YET' : mins(response)}${l.next_action ? `; next: ${l.next_action} (${iso(l.next_action_on)})` : ''}${l.lost_reason ? `; lost: ${l.lost_reason}` : ''}`,
    dups.length ? `  came back ${dups.length} more time(s): ${dups.map((d) => `${d.code} via ${d.source} ${when(d.received_at)}`).join('; ')}` : '',
    heading('History'),
    table(acts, [{ key: 'at', label: 'when', format: when }, { key: 'who', label: 'who' }, { key: 'kind', label: 'what', format: (v, r) => `${v}${r.direction ? ' ' + r.direction : ''}${r.marketing ? ' (marketing)' : ''}` }, { key: 'body', label: 'note', width: 70 }]),
    appts.length ? heading('Appointments') + '\n' + table(appts, [{ key: 'starts_at', label: 'when', format: when }, { key: 'kind', label: 'kind' }, { key: 'outcome', label: 'outcome', format: (v) => v || '-' }]) : '',
    drives.length ? heading('Test drives') + '\n' + table(drives, [{ key: 'out_at', label: 'out', format: when }, { key: 'back_at', label: 'back', format: (v) => (v ? when(v) : 'STILL OUT') }, { key: 'vehicle', label: 'car' }, { key: 'licence_sighted', label: 'licence sighted', format: (v) => (v ? 'yes' : 'NO') }]) : '',
    apps.length ? heading('Trade-in appraisals') + '\n' + table(apps, [{ key: 'code', label: 'code' }, { key: 'model', label: 'car', format: (v, r) => `${r.year} ${r.make} ${r.model}` }, { key: 'offer_cents', label: 'offer', align: 'right', format: nzd }, { key: 'valid_until', label: 'valid to', format: iso }, { key: 'ppsr_checked_on', label: 'PPSR', format: (v) => (v ? iso(v) : 'not searched') }, { key: 'status', label: 'status' }]) : '',
    deals.length ? heading('Deals') + '\n' + table(deals, [{ key: 'code', label: 'deal' }, { key: 'sale_price_cents', label: 'price', align: 'right', format: nzd }, { key: 'finance_status', label: 'finance' }, { key: 'status', label: 'status' }]) : '',
  ].filter(Boolean).join('\n'));
}

async function cmdContact(ref) {
  const c = await findContact(ref);
  const leads = await db.query(`${LEAD_SQL} where l.contact_id = $1 order by l.received_at`, [c.id]);
  const deals = await db.query(`select d.code, d.status, d.written_on, d.delivered_on, trim(concat_ws(' ', v.year, v.make, v.model)) as vehicle from deals d join vehicles v on v.id = d.vehicle_id where d.contact_id = $1 order by d.written_on`, [c.id]);
  const marketing = await db.query(`select at, kind, body from activities where contact_id = $1 and marketing order by at desc`, [c.id]);
  out({ contact: c, leads: leads.map((l) => ({ code: l.code, stage: l.stage, source: l.source_code, vehicle: l.vehicle, received_at: l.received_at })), deals, marketing }, () => [
    heading(`${c.code}  ${c.full_name}`),
    `  ${c.mobile || ''}  ${c.email || ''}  ${c.suburb || ''}`,
    `  marketing consent: ${c.marketing_consent}${c.consent_source ? ` (${c.consent_source})` : ''}${c.unsubscribed_at ? `; UNSUBSCRIBED ${when(c.unsubscribed_at)}` : c.unsubscribe_requested_at ? `; ASKED TO UNSUBSCRIBE ${when(c.unsubscribe_requested_at)}, not actioned` : ''}`,
    `  licence: ${c.licence_no ? `${c.licence_no}, expires ${iso(c.licence_expires_on)}` : 'not on file'}${c.anonymised_at ? '; anonymised' : ''}`,
    heading('Leads'), table(leads, [{ key: 'code', label: 'lead' }, { key: 'stage', label: 'stage' }, { key: 'source_code', label: 'from' }, { key: 'vehicle', label: 'car' }, { key: 'received_at', label: 'came in', format: when }]),
    deals.length ? heading('Deals') + '\n' + table(deals, [{ key: 'code', label: 'deal' }, { key: 'vehicle', label: 'car' }, { key: 'status', label: 'status' }, { key: 'delivered_on', label: 'delivered', format: iso }]) : '',
  ].filter(Boolean).join('\n'));
}

async function cmdResponse(flags) {
  const days = intFlag(flags.days, 30);
  const target = settingInt('response_target_minutes', 15);
  const waiting = await db.query(`select code, contact, source, site, salesperson, salesperson_code, away_until, received_at, response_minutes from v_open_leads
    where first_response_at is null order by received_at`);
  const by = async (col, label) => db.query(`
    select ${col} as key, ${label} as name, count(*) as leads, count(l.first_response_at) as answered,
      count(*) filter (where l.first_response_at is not null and l.first_response_at - l.received_at <= make_interval(mins => $2)) as in_target,
      round(percentile_cont(0.5) within group (order by extract(epoch from (l.first_response_at - l.received_at)) / 60)) as median_minutes,
      round(max(extract(epoch from (l.first_response_at - l.received_at)) / 60)) as slowest_minutes
    from leads l left join staff s on s.id = l.assigned_to left join lead_sources src on src.id = l.source_id
    where l.duplicate_of is null and l.received_at >= now() - make_interval(days => $1)
    group by 1, 2 order by 1`, [days, target]);
  const people = await by(`coalesce(s.code, '-')`, `coalesce(s.full_name, 'not assigned')`);
  const sources = await by('src.code', 'src.name');
  const data = { target_minutes: target, days, waiting: waiting.map((w) => ({ ...w, response_minutes: n(w.response_minutes), over_target: n(w.response_minutes) > target })), by_salesperson: people, by_source: sources };
  const cols = [{ key: 'key', label: 'code' }, { key: 'name', label: 'name' }, { key: 'leads', label: 'leads', align: 'right' }, { key: 'in_target', label: `in ${target} min`, align: 'right', format: (v, r) => `${v} (${pct(v, r.leads)})` },
    { key: 'median_minutes', label: 'median', align: 'right', format: mins }, { key: 'slowest_minutes', label: 'slowest', align: 'right', format: mins }];
  out(data, () => [
    heading(`Waiting for a first answer now (target ${target} min)`),
    table(waiting, [{ key: 'code', label: 'lead' }, { key: 'contact', label: 'customer' }, { key: 'source', label: 'from' }, { key: 'site', label: 'yard' },
      { key: 'salesperson', label: 'with', format: (v, r) => (v ? `${v}${r.away_until && iso(r.away_until) >= TODAY ? ' (AWAY)' : ''}` : 'NOBODY') },
      { key: 'response_minutes', label: 'waiting', align: 'right', format: (v) => `${mins(v)}${n(v) > target ? ' LATE' : ''}` }]),
    heading(`Speed to first answer, last ${days} days, by salesperson`), table(people, cols),
    heading('By lead source'), table(sources, cols),
  ].join('\n'));
}

async function followupList() {
  const quietDays = settingInt('quiet_days', 7);
  const overdue = await db.query(`select code, contact, salesperson_code, stage, next_action, next_action_on, (biz_today() - next_action_on) as days_late from v_open_leads
    where next_action_on < biz_today() order by next_action_on`);
  const dueToday = await db.query(`select code, contact, salesperson_code, stage, next_action from v_open_leads where next_action_on = biz_today() order by code`);
  const quiet = await db.query(`select code, contact, salesperson_code, stage, last_touch_at, days_quiet from v_open_leads
    where first_response_at is not null and days_quiet >= $1 and (next_action_on is null or next_action_on < biz_today()) order by days_quiet desc`, [quietDays]);
  const noNext = await db.query(`select code, contact, salesperson_code, stage from v_open_leads where first_response_at is not null and next_action_on is null and days_quiet < $1 order by code`, [quietDays]);
  const noShows = await db.query(`select l.code, c.full_name as contact, s.code as salesperson_code, ap.starts_at from appointments ap join leads l on l.id = ap.lead_id
    join contacts c on c.id = l.contact_id left join staff s on s.id = l.assigned_to
    where ap.outcome = 'no_show' and l.stage not in ('sold','lost')
      and not exists (select 1 from activities a where a.lead_id = l.id and a.direction = 'out' and a.at > ap.starts_at) order by ap.starts_at`);
  const noOutcome = await db.query(`select l.code, c.full_name as contact, s.code as salesperson_code, ap.kind, ap.starts_at from appointments ap join leads l on l.id = ap.lead_id
    join contacts c on c.id = l.contact_id left join staff s on s.id = ap.staff_id where ap.outcome is null and ap.starts_at < now() - interval '2 hours' order by ap.starts_at`);
  const cameBack = await db.query(`select o.code, o.contact, o.salesperson_code, o.days_quiet, d.code as again_code, src.name as again_via, d.received_at as again_at
    from leads d join v_open_leads o on o.id = d.duplicate_of left join lead_sources src on src.id = d.source_id
    where d.received_at > coalesce(o.last_touch_at, o.received_at) order by d.received_at desc`);
  return { overdue, due_today: dueToday, quiet, no_next_action: noNext, no_shows_not_chased: noShows, appointments_without_outcome: noOutcome, came_back: cameBack, quiet_days: quietDays };
}

async function cmdFollowups() {
  const f = await followupList();
  out(f, () => [
    heading('Came back while we were quiet'), table(f.came_back, [{ key: 'code', label: 'lead' }, { key: 'contact', label: 'customer' }, { key: 'salesperson_code', label: 'who' }, { key: 'again_via', label: 'came back via' }, { key: 'again_at', label: 'when', format: when }, { key: 'days_quiet', label: 'we were quiet', align: 'right', format: (v) => `${v} d` }]),
    heading('Follow-ups overdue'), table(f.overdue, [{ key: 'code', label: 'lead' }, { key: 'contact', label: 'customer' }, { key: 'salesperson_code', label: 'who' }, { key: 'next_action', label: 'promised', width: 40 }, { key: 'days_late', label: 'late', align: 'right', format: (v) => `${v} d` }]),
    heading('Due today'), table(f.due_today, [{ key: 'code', label: 'lead' }, { key: 'contact', label: 'customer' }, { key: 'salesperson_code', label: 'who' }, { key: 'next_action', label: 'next', width: 40 }]),
    heading('No-shows nobody has chased'), table(f.no_shows_not_chased, [{ key: 'code', label: 'lead' }, { key: 'contact', label: 'customer' }, { key: 'salesperson_code', label: 'who' }, { key: 'starts_at', label: 'was booked', format: when }]),
    heading('Appointments with no outcome recorded'), table(f.appointments_without_outcome, [{ key: 'code', label: 'lead' }, { key: 'contact', label: 'customer' }, { key: 'salesperson_code', label: 'who' }, { key: 'kind', label: 'kind' }, { key: 'starts_at', label: 'was booked', format: when }]),
    heading(`Quiet for ${f.quiet_days} days or more`), table(f.quiet, [{ key: 'code', label: 'lead' }, { key: 'contact', label: 'customer' }, { key: 'salesperson_code', label: 'who' }, { key: 'stage', label: 'stage' }, { key: 'days_quiet', label: 'quiet', align: 'right', format: (v) => `${v} d` }]),
    heading('Answered but no next step set'), table(f.no_next_action, [{ key: 'code', label: 'lead' }, { key: 'contact', label: 'customer' }, { key: 'salesperson_code', label: 'who' }, { key: 'stage', label: 'stage' }]),
  ].join('\n'));
}

async function cmdAppointments(flags) {
  const days = intFlag(flags.days, 7);
  const rows = await db.query(`select ap.*, l.code, c.full_name as contact, c.mobile, s.code as salesperson_code, trim(concat_ws(' ', v.year, v.make, v.model)) as vehicle
    from appointments ap join leads l on l.id = ap.lead_id join contacts c on c.id = l.contact_id left join staff s on s.id = ap.staff_id left join vehicles v on v.id = l.vehicle_id
    where ${flags.past ? `ap.starts_at < now() and ap.starts_at >= now() - make_interval(days => $1)` : `ap.outcome is null and ap.starts_at >= now() - interval '2 hours' and ap.starts_at < now() + make_interval(days => $1)`}
    order by ap.starts_at`, [days]);
  out(rows, () => heading(flags.past ? `Appointments in the last ${days} days` : `Booked in the next ${days} days`) + '\n' + table(rows, [
    { key: 'starts_at', label: 'when', format: when }, { key: 'kind', label: 'kind' }, { key: 'code', label: 'lead' }, { key: 'contact', label: 'customer' },
    { key: 'mobile', label: 'mobile' }, { key: 'vehicle', label: 'car' }, { key: 'salesperson_code', label: 'with' }, { key: 'outcome', label: 'outcome', format: (v) => v || '' }]));
}

async function cmdDrives(flags) {
  const rows = await db.query(`select td.*, l.code, c.full_name as contact, s.code as salesperson_code, v.stock_no, trim(concat_ws(' ', v.year, v.make, v.model)) as vehicle,
      round(extract(epoch from (coalesce(td.back_at, now()) - td.out_at)) / 60) as minutes
    from test_drives td join contacts c on c.id = td.contact_id left join leads l on l.id = td.lead_id left join staff s on s.id = td.staff_id join vehicles v on v.id = td.vehicle_id
    where ${flags.out ? 'td.back_at is null' : `td.out_at >= now() - make_interval(days => $1)`} order by td.out_at desc`, flags.out ? [] : [intFlag(flags.days, 30)]);
  out(rows, () => heading(flags.out ? 'Cars out on a test drive now' : 'Test drives') + '\n' + table(rows, [
    { key: 'out_at', label: 'out', format: when }, { key: 'back_at', label: 'back', format: (v) => (v ? when(v) : 'STILL OUT') }, { key: 'minutes', label: 'for', align: 'right', format: mins },
    { key: 'code', label: 'lead' }, { key: 'contact', label: 'customer' }, { key: 'vehicle', label: 'car' }, { key: 'salesperson_code', label: 'with' },
    { key: 'licence_sighted', label: 'licence', format: (v, r) => (v ? r.licence_no || 'sighted' : 'NOT SIGHTED') }]));
}

async function cmdAppraisals(flags) {
  const rows = await db.query(`select a.*, c.full_name as contact, l.code as lead_code, s.code as by_code, (a.valid_until - biz_today()) as days_left
    from appraisals a join contacts c on c.id = a.contact_id left join leads l on l.id = a.lead_id left join staff s on s.id = a.appraised_by
    ${flags.all ? '' : `where a.status = 'open'`} order by a.appraised_at desc`);
  out(rows, () => heading(flags.all ? 'Trade-in appraisals' : 'Open trade-in offers') + '\n' + table(rows, [
    { key: 'code', label: 'code' }, { key: 'lead_code', label: 'lead' }, { key: 'contact', label: 'customer' }, { key: 'model', label: 'trade-in', format: (v, r) => `${r.year} ${r.make} ${r.model} ${r.rego || ''}` },
    { key: 'odometer_km', label: 'km', align: 'right' }, { key: 'offer_cents', label: 'offer', align: 'right', format: nzd },
    { key: 'days_left', label: 'valid', align: 'right', format: (v, r) => (r.status !== 'open' ? r.status : n(v) < 0 ? 'EXPIRED' : `${v} d`) },
    { key: 'ppsr_checked_on', label: 'PPSR', format: (v, r) => (v ? (n(r.money_owing_cents) ? `owing ${nzd(r.money_owing_cents)}` : 'clear') : 'not searched') }]));
}

async function cmdDeals(flags) {
  const rows = await db.query(`select d.*, c.full_name as contact, l.code as lead_code, s.code as salesperson_code, trim(concat_ws(' ', v.year, v.make, v.model)) as vehicle, (biz_today() - d.written_on) as days_open
    from deals d join contacts c on c.id = d.contact_id left join leads l on l.id = d.lead_id left join staff s on s.id = d.salesperson_id join vehicles v on v.id = d.vehicle_id
    ${flags.all ? '' : `where d.status = 'written'`} order by d.written_on desc`);
  out(rows, () => heading(flags.all ? 'Deals' : 'Deals written, not yet delivered') + '\n' + table(rows, [
    { key: 'code', label: 'deal' }, { key: 'lead_code', label: 'lead' }, { key: 'contact', label: 'customer' }, { key: 'vehicle', label: 'car' }, { key: 'salesperson_code', label: 'who' },
    { key: 'sale_price_cents', label: 'price', align: 'right', format: nzd }, { key: 'trade_allowance_cents', label: 'trade', align: 'right', format: (v) => (n(v) ? nzd(v) : '') },
    { key: 'finance_status', label: 'finance', format: (v) => (v === 'none' ? '' : v) }, { key: 'status', label: 'status', format: (v, r) => (v === 'written' ? `written ${r.days_open} d ago` : v) }]));
}

async function cmdSources(flags) {
  const days = intFlag(flags.days, 90);
  const rows = await db.query(`
    select src.code, src.name, src.kind, src.monthly_spend_cents,
      count(l.id) as leads, count(l.first_response_at) as answered,
      count(*) filter (where exists (select 1 from appointments ap where ap.lead_id = l.id)) as appointments,
      count(*) filter (where exists (select 1 from test_drives td where td.lead_id = l.id)) as test_drives,
      count(*) filter (where l.stage = 'sold') as sold
    from lead_sources src left join leads l on l.source_id = src.id and l.duplicate_of is null and l.received_at >= now() - make_interval(days => $1)
    where src.active group by src.id order by count(*) filter (where l.stage = 'sold') desc, count(l.id) desc, src.code`, [days]);
  const months = days / 30.44;
  const data = rows.map((r) => {
    const spend = Math.round(n(r.monthly_spend_cents) * months);
    return { ...r, leads: n(r.leads), answered: n(r.answered), appointments: n(r.appointments), test_drives: n(r.test_drives), sold: n(r.sold), spend_cents: spend,
      cost_per_lead_cents: n(r.leads) && spend ? Math.round(spend / n(r.leads)) : null, cost_per_sale_cents: spend ? (n(r.sold) ? Math.round(spend / n(r.sold)) : null) : null };
  });
  out({ days, sources: data }, () => heading(`Lead sources, last ${days} days: what each one turned into`) + '\n' + table(data, [
    { key: 'code', label: 'code' }, { key: 'name', label: 'source' }, { key: 'leads', label: 'leads', align: 'right' },
    { key: 'appointments', label: 'appts', align: 'right', format: (v, r) => `${v} (${pct(v, r.leads)})` }, { key: 'test_drives', label: 'drives', align: 'right', format: (v, r) => `${v} (${pct(v, r.leads)})` },
    { key: 'sold', label: 'sold', align: 'right', format: (v, r) => `${v} (${pct(v, r.leads)})` }, { key: 'spend_cents', label: 'spend', align: 'right', format: (v) => (v ? nzd(v) : '') },
    { key: 'cost_per_sale_cents', label: 'per sale', align: 'right', format: (v, r) => (r.spend_cents ? (v ? nzd(v) : 'NO SALES') : '') }]) + '\n\n  Spend is the monthly figure on each source, spread over the period. Duplicates are not counted twice.');
}

async function cmdTeam() {
  const target = settingInt('response_target_minutes', 15);
  const rows = await db.query(`select t.*, (select count(*) from leads l where l.assigned_to = s.id and l.first_response_at is not null and l.first_response_at - l.received_at <= make_interval(mins => $1)) as in_target,
      (select count(*) from leads l where l.assigned_to = s.id and l.first_response_at is not null) as answered,
      (select count(*) from leads l where l.assigned_to = s.id and l.stage not in ('sold','lost') and l.duplicate_of is null and l.first_response_at is null) as unanswered,
      (select count(*) from test_drives td where td.staff_id = s.id) as test_drives
    from v_team t join staff s on s.code = t.code order by t.site, t.code`, [target]);
  out(rows.map((r) => ({ ...r, open_leads: n(r.open_leads), overdue: n(r.overdue), sold: n(r.sold), closed: n(r.closed), unanswered: n(r.unanswered), test_drives: n(r.test_drives) })), () => heading('The sales floor') + '\n' + table(rows, [
    { key: 'code', label: 'code' }, { key: 'full_name', label: 'name' }, { key: 'role', label: 'role', format: (v) => v.replace('_', ' ') }, { key: 'site', label: 'yard' },
    { key: 'away_until', label: 'away', format: (v) => (v && iso(v) >= TODAY ? `until ${iso(v)}` : '') },
    { key: 'open_leads', label: 'open', align: 'right' }, { key: 'unanswered', label: 'unanswered', align: 'right' }, { key: 'overdue', label: 'overdue', align: 'right' },
    { key: 'avg_response_minutes', label: 'avg answer', align: 'right', format: mins }, { key: 'in_target', label: `in ${target} min`, align: 'right', format: (v, r) => (n(r.answered) ? pct(v, r.answered) : '') },
    { key: 'test_drives', label: 'drives', align: 'right' }, { key: 'sold', label: 'sold', align: 'right', format: (v, r) => (n(r.closed) ? `${v} of ${r.closed}` : '') }]));
}

async function cmdStock(flags) {
  const params = [];
  let where = flags.all ? '' : `where v.status in ('in_stock','on_hold')`;
  if (flags.site) { const s = await findSite(flags.site); params.push(s.id); where += `${where ? ' and' : 'where'} v.site_id = $${params.length}`; }
  const rows = await db.query(`select v.*, si.code as site, (biz_today() - v.in_stock_on) as days_in_stock,
      (select count(*) from leads l where l.vehicle_id = v.id and l.duplicate_of is null) as enquiries,
      (select count(*) from leads l where l.vehicle_id = v.id and l.duplicate_of is null and l.stage not in ('sold','lost')) as open_leads,
      (select count(*) from test_drives td where td.vehicle_id = v.id) as test_drives
    from vehicles v left join sites si on si.id = v.site_id ${where} order by v.site_id, v.stock_no`, params);
  out(rows.map((r) => ({ ...r, enquiries: n(r.enquiries), open_leads: n(r.open_leads), test_drives: n(r.test_drives) })), () => heading('Stock and the interest in it') + '\n' + table(rows, [
    { key: 'stock_no', label: 'stock' }, { key: 'site', label: 'yard' }, { key: 'model', label: 'car', format: (v, r) => `${r.year} ${r.make} ${r.model} ${r.variant || ''}`.trim() },
    { key: 'price_cents', label: 'price', align: 'right', format: nzd }, { key: 'days_in_stock', label: 'days', align: 'right' }, { key: 'enquiries', label: 'enquiries', align: 'right' },
    { key: 'open_leads', label: 'open', align: 'right' }, { key: 'test_drives', label: 'drives', align: 'right' }, { key: 'status', label: 'status' }]));
}

async function cmdMarketingList(flags) {
  const params = [];
  let siteFilter = '';
  if (flags.site) { const s = await findSite(flags.site); params.push(s.id); siteFilter = `and exists (select 1 from leads l where l.contact_id = c.id and l.site_id = $1)`; }
  const rows = await db.query(`select c.code, c.full_name, c.mobile, c.email, c.marketing_consent, c.consent_source from contacts c
    where c.marketing_consent in ('express','inferred') and c.unsubscribe_requested_at is null and c.unsubscribed_at is null and c.anonymised_at is null ${siteFilter}
    order by c.marketing_consent, c.full_name`, params);
  const held = await db.query(`select count(*) as k from contacts where not (marketing_consent in ('express','inferred') and unsubscribe_requested_at is null and unsubscribed_at is null and anonymised_at is null)`);
  out({ may_message: rows, held_back: n(held[0].k) }, () => heading(`Who may be sent marketing (${rows.length})`) + '\n' + table(rows, [
    { key: 'code', label: 'code' }, { key: 'full_name', label: 'name' }, { key: 'mobile', label: 'mobile' }, { key: 'email', label: 'email' }, { key: 'marketing_consent', label: 'consent' }, { key: 'consent_source', label: 'how', width: 40 }]) +
    `\n\n  ${n(held[0].k)} contact(s) held back: no consent, unsubscribed, or anonymised. Replies to a person's own enquiry are not marketing and are not limited by this list.`);
}

// ---------------------------------------------------------------- compliance

async function complianceChecks() {
  const unsubDays = settingInt('unsubscribe_working_days', 5);
  const retention = settingInt('retention_months', 24);
  const checks = [];
  const add = (id, rule, source, items) => checks.push({ id, rule, source, count: items.length, items });

  const noConsent = await db.query(`select c.code, c.full_name, a.at, a.kind, a.body from activities a join contacts c on c.id = a.contact_id
    where a.marketing and a.direction = 'out' and (c.marketing_consent = 'none' or (c.consent_at is not null and a.at < c.consent_at)) order by a.at desc`);
  add('consent', 'Marketing only to people who consented', 'Unsolicited Electronic Messages Act 2007 s 9 (NZ); Spam Act 2003 s 16 (AU)',
    noConsent.map((r) => `${r.code} ${r.full_name}: ${r.kind} "${truncate(r.body, 50)}" on ${when(r.at)} with no consent on file`));

  const unsub = await db.query(`select c.code, c.full_name, c.unsubscribe_requested_at, c.unsubscribed_at,
      (select max(a.at) from activities a where a.contact_id = c.id and a.marketing and a.direction = 'out' and a.at > coalesce(c.unsubscribed_at, c.unsubscribe_requested_at)) as sent_after
    from contacts c where c.unsubscribe_requested_at is not null order by c.unsubscribe_requested_at`);
  const unsubItems = [];
  for (const r of unsub) {
    if (r.sent_after) unsubItems.push(`${r.code} ${r.full_name}: marketing sent ${when(r.sent_after)}, after they unsubscribed`);
    else if (!r.unsubscribed_at) {
      const wd = workingDaysSince(iso(new Date(r.unsubscribe_requested_at).toISOString()), TODAY);
      if (wd > unsubDays) unsubItems.push(`${r.code} ${r.full_name}: asked to unsubscribe ${wd} working days ago, not actioned (limit ${unsubDays})`);
    }
  }
  add('unsubscribe', `Unsubscribes actioned within ${unsubDays} working days, and nothing sent after`, 'Unsolicited Electronic Messages Act 2007 s 11 (NZ); Spam Act 2003 s 18 (AU)', unsubItems);

  const lic = await db.query(`select td.out_at, c.code, c.full_name, l.code as lead_code, trim(concat_ws(' ', v.year, v.make, v.model)) as vehicle, td.licence_sighted, td.licence_no, td.licence_expires_on
    from test_drives td join contacts c on c.id = td.contact_id left join leads l on l.id = td.lead_id join vehicles v on v.id = td.vehicle_id
    where not td.licence_sighted or td.licence_no is null or td.licence_expires_on is null or td.licence_expires_on < td.out_at::date order by td.out_at desc`);
  add('licence', 'A current driver licence sighted before every test drive', 'Land Transport Act 1998 s 31 (driving without the appropriate licence); your insurer\'s demonstrator conditions',
    lic.map((r) => `${r.lead_code || r.code} ${r.full_name}: ${r.vehicle} on ${when(r.out_at)}, ${r.licence_sighted ? (r.licence_no ? 'licence expired' : 'no licence number') : 'licence not sighted'}`));

  const ppsr = await db.query(`select d.code, c.full_name, a.code as appraisal_code, a.year, a.make, a.model, d.status from deals d join appraisals a on a.id = d.appraisal_id
    join contacts c on c.id = d.contact_id where d.status <> 'cancelled' and a.ppsr_checked_on is null order by d.written_on`);
  add('ppsr', 'Every trade-in searched on the PPSR before the deal', 'Personal Property Securities Act 1999 (a registered security follows the car); ppsr.companiesoffice.govt.nz',
    ppsr.map((r) => `${r.code} ${r.full_name}: trade-in ${r.appraisal_code} ${r.year} ${r.make} ${r.model} taken on a ${r.status} deal with no PPSR search`));

  const cash = await db.query(`select d.code, c.full_name, d.deposit_cents, d.deposit_method, d.balance_method, d.sale_price_cents, d.trade_allowance_cents, d.payout_cents, d.status
    from deals d join contacts c on c.id = d.contact_id where d.status <> 'cancelled' and coalesce(d.delivered_on, d.written_on) >= date '2023-05-11'`);
  const cashItems = [];
  for (const d of cash) {
    const c = cashTotal(d);
    if (c >= CASH_LIMIT_CENTS) cashItems.push(`${d.code} ${d.full_name}: ${nzd(c)} in cash or cheque on one car (${d.status})`);
  }
  add('cash', 'No car bought or sold for NZ$10,000 or more in cash', 'AML/CFT Act 2009 s 67A; AML/CFT (Definitions) Regulations 2011 reg 5AC, in force 11 May 2023', cashItems);

  const credit = await db.query(`select d.code, c.full_name, d.finance_status, d.lender from deals d join contacts c on c.id = d.contact_id
    where d.finance_status in ('applied','approved','declined') and d.credit_consent_at is null and d.status <> 'cancelled' order by d.written_on`);
  add('credit', 'The customer\'s authority recorded before a finance application goes to a lender', 'Privacy Act 2020 IPP 3 and IPP 11; the lender\'s application terms; Credit Reporting Privacy Code 2020',
    credit.map((r) => `${r.code} ${r.full_name}: finance ${r.finance_status}${r.lender ? ' with ' + r.lender : ''}, no credit check authority recorded`));

  const old = await retentionCandidates(retention);
  add('retention', `Lost leads let go after ${retention} months with no other dealings`, 'Privacy Act 2020 IPP 9 (keep personal information no longer than needed)',
    old.map((r) => `${r.code} ${r.full_name}: last dealing ${iso(r.last_at)}, never bought`));

  return checks;
}

function cashTotal(d) {
  const deposit = CASH_METHODS.has(d.deposit_method) ? n(d.deposit_cents) : 0;
  const balance = CASH_METHODS.has(d.balance_method) ? Math.max(0, n(d.sale_price_cents) - n(d.trade_allowance_cents) + n(d.payout_cents) - n(d.deposit_cents)) : 0;
  return deposit + balance;
}

async function retentionCandidates(months) {
  return db.query(`select c.id, c.code, c.full_name, greatest((select max(a.at) from activities a where a.contact_id = c.id), (select max(coalesce(l.closed_at, l.received_at)) from leads l where l.contact_id = c.id)) as last_at
    from contacts c where c.anonymised_at is null
      and exists (select 1 from leads l where l.contact_id = c.id)
      and not exists (select 1 from leads l where l.contact_id = c.id and l.stage <> 'lost')
      and not exists (select 1 from deals d where d.contact_id = c.id)
      and greatest((select max(a.at) from activities a where a.contact_id = c.id), (select max(coalesce(l.closed_at, l.received_at)) from leads l where l.contact_id = c.id)) < now() - make_interval(months => $1)
    order by c.code`, [months]);
}

async function cmdCompliance(rule) {
  let checks = await complianceChecks();
  if (rule) {
    checks = checks.filter((c) => c.id === String(rule).toLowerCase());
    if (!checks.length) throw new CliError(`No rule "${rule}". Rules: consent, unsubscribe, licence, ppsr, cash, credit, retention`);
  }
  out(checks, () => heading('Compliance: the records against the rules') + '\n' + table(checks, [
    { key: 'id', label: 'rule' }, { key: 'count', label: 'breaches', align: 'right', format: (v) => (v ? String(v) : 'clean') }, { key: 'rule', label: 'what', width: 62 }, { key: 'source', label: 'source', width: 60 }]) +
    checks.filter((c) => c.count).map((c) => `\n\n${c.id}:\n${c.items.map((i) => '  - ' + i).join('\n')}`).join('') +
    '\n\n  The rules and their sources are in docs/compliance.md. Nothing here is legal advice.');
}

// ---------------------------------------------------------------- attention

async function cmdAttention() {
  const target = settingInt('response_target_minutes', 15);
  const items = [];
  const push = (rank, area, what, who = '') => items.push({ rank, area, what, who });

  for (const w of await db.query(`select * from v_open_leads where first_response_at is null order by received_at`)) {
    if (!w.salesperson) push(1, 'unassigned', `${w.code} ${w.contact} (${w.source}) has waited ${mins(w.response_minutes)} with nobody on it`);
    else if (w.away_until && iso(w.away_until) >= TODAY) push(1, 'away', `${w.code} ${w.contact} is with ${w.salesperson}, who is away until ${iso(w.away_until)}; waiting ${mins(w.response_minutes)}`, w.salesperson_code);
    else if (n(w.response_minutes) > target) push(2, 'first answer', `${w.code} ${w.contact} (${w.source}) has waited ${mins(w.response_minutes)}, target ${target} min`, w.salesperson_code);
  }
  for (const d of await db.query(`select td.*, c.full_name, trim(concat_ws(' ', v.year, v.make, v.model)) as vehicle, s.code as who, round(extract(epoch from (now() - td.out_at)) / 60) as minutes
      from test_drives td join contacts c on c.id = td.contact_id join vehicles v on v.id = td.vehicle_id left join staff s on s.id = td.staff_id
      where td.back_at is null and td.out_at < now() - interval '2 hours'`)) {
    push(1, 'car out', `${d.vehicle} has been out with ${d.full_name} for ${mins(d.minutes)}`, d.who);
  }
  const f = await followupList();
  for (const r of f.came_back) push(2, 'came back', `${r.contact} enquired again via ${r.again_via} (${r.again_code}); ${r.code} had been quiet ${r.days_quiet} d`, r.salesperson_code);
  for (const r of f.no_shows_not_chased) push(3, 'no-show', `${r.code} ${r.contact} did not turn up ${when(r.starts_at)} and nobody has been back in touch`, r.salesperson_code);
  for (const r of f.appointments_without_outcome) push(3, 'outcome', `${r.code} ${r.contact}: ${r.kind.replace('_', ' ')} ${when(r.starts_at)} has no outcome recorded`, r.salesperson_code);
  for (const r of f.overdue) push(3, 'follow-up', `${r.code} ${r.contact}: "${r.next_action}" was due ${r.days_late} d ago`, r.salesperson_code);
  for (const r of f.quiet) push(4, 'quiet', `${r.code} ${r.contact} (${r.stage}) has had no contact for ${r.days_quiet} d`, r.salesperson_code);
  for (const a of await db.query(`select a.code, c.full_name, a.valid_until, (a.valid_until - biz_today()) as days_left, l.code as lead_code, s.code as who
      from appraisals a join contacts c on c.id = a.contact_id join leads l on l.id = a.lead_id left join staff s on s.id = l.assigned_to
      where a.status = 'open' and l.stage not in ('sold','lost') and a.valid_until <= biz_today() + 2 order by a.valid_until`)) {
    push(3, 'trade-in', `${a.lead_code} ${a.full_name}: trade-in offer ${a.code} ${n(a.days_left) < 0 ? 'has expired' : `expires in ${a.days_left} d`}`, a.who);
  }
  const deliveryDays = settingInt('deal_delivery_days', 7);
  for (const d of await db.query(`select d.code, c.full_name, (biz_today() - d.written_on) as days, d.finance_status, s.code as who from deals d join contacts c on c.id = d.contact_id
      left join staff s on s.id = d.salesperson_id where d.status = 'written' and d.written_on <= biz_today() - $1::int order by d.written_on`, [deliveryDays])) {
    push(3, 'delivery', `${d.code} ${d.full_name} was written ${d.days} d ago and is not delivered${d.finance_status === 'approved' ? ' (finance approved)' : ''}`, d.who);
  }
  for (const c of await complianceChecks()) if (c.count) push(c.id === 'retention' ? 5 : 2, 'compliance', `${c.id}: ${c.count} breach${c.count > 1 ? 'es' : ''}. Run /compliance`);
  items.sort((a, b) => a.rank - b.rank);
  out(items, () => heading(`Needs attention (${items.length})`) + '\n' + table(items, [{ key: 'area', label: 'area' }, { key: 'who', label: 'who' }, { key: 'what', label: 'what', width: 100 }]));
}

// ---------------------------------------------------------------- writes: leads

async function cmdNew(flags) {
  const name = str(flags.name).trim();
  if (!name) throw new CliError('Who enquired? --name="Full Name" (plus --mobile and/or --email).');
  const mobile = str(flags.mobile).trim() || null;
  const email = str(flags.email).trim().toLowerCase() || null;
  if (!mobile && !email) throw new CliError('A lead needs a way back to the person: --mobile or --email.');
  const source = await findSource(flags.source);
  const vehicle = flags.vehicle ? await findVehicle(flags.vehicle) : null;
  const consent = flags.consent ? String(flags.consent) : 'none';
  if (!['express', 'inferred', 'none'].includes(consent)) throw new CliError('--consent is express (they ticked the box), inferred, or none.');
  const receivedAt = flags.at ? await localTimestamp(flags.at) : null;

  // The same person again: match on mobile digits or email.
  const d = digits(mobile);
  const [existing] = await db.query(`select * from contacts where anonymised_at is null and ((length($1) >= 6 and regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') = $1) or ($2::text is not null and lower(email) = $2)) order by created_at limit 1`, [d, email]);
  let contact = existing;
  if (!contact) {
    const code = await nextCode('contacts', 'C-', 101, 4);
    [contact] = await db.query(`insert into contacts (code, full_name, mobile, email, suburb, marketing_consent, consent_at, consent_source) values ($1, $2, $3, $4, $5, $6, case when $6 = 'none' then null else now() end, $7) returning *`,
      [code, name, mobile, email, str(flags.suburb) || null, consent, consent === 'none' ? null : `Enquiry via ${source.name}`]);
  } else {
    if (!contact.mobile && mobile) await db.query('update contacts set mobile = $2 where id = $1', [contact.id, mobile]);
    if (!contact.email && email) await db.query('update contacts set email = $2 where id = $1', [contact.id, email]);
    if (consent !== 'none' && contact.marketing_consent === 'none' && !contact.unsubscribe_requested_at) await db.query(`update contacts set marketing_consent = $2, consent_at = now(), consent_source = $3 where id = $1`, [contact.id, consent, `Enquiry via ${source.name}`]);
  }
  const [open] = await db.query(`select l.*, s.full_name as salesperson from leads l left join staff s on s.id = l.assigned_to where l.contact_id = $1 and l.stage not in ('sold','lost') and l.duplicate_of is null order by l.received_at limit 1`, [contact.id]);
  // The yard: named, else the car's, else the one already handling this person, else the only one.
  let site = flags.site ? await findSite(flags.site) : null;
  const siteId = site ? null : vehicle?.site_id || open?.site_id;
  if (siteId) [site] = await db.query('select * from sites where id = $1', [siteId]);
  if (!site) { const all = await db.query('select * from sites'); if (all.length === 1) site = all[0]; else throw new CliError(`Which yard? --site=${all.map((s) => s.code).join('|')}`); }
  const code = await nextCode('leads', 'L-', 1001);
  let assignee = null;
  if (open) assignee = open.assigned_to ? (await db.query('select * from staff where id = $1', [open.assigned_to]))[0] : null;
  else if (flags.to) assignee = await findStaff(flags.to);
  else assignee = await pickSalesperson(site.id);
  const [lead] = await db.query(`insert into leads (code, contact_id, source_id, site_id, vehicle_id, wanted, budget_cents, has_trade, wants_finance, received_at, assigned_to, assigned_at, duplicate_of, external_ref)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), $11, case when $11::uuid is null then null else now() end, $12, $13) returning *`,
    [code, contact.id, source.id, site.id, vehicle?.id ?? null, str(flags.wanted) || null, parseMoney(flags.budget, '--budget'), !!flags.trade, !!flags.finance, receivedAt, assignee?.id ?? null, open?.id ?? null, str(flags.ref) || null]);
  await logActivity({ lead, kind: 'system', direction: 'in', body: `${open ? 'Enquired again' : 'Enquiry received'} from ${source.name}${str(flags.message) ? ': ' + str(flags.message) : ''}`, at: receivedAt });
  if (open) await logActivity({ lead: open, kind: 'system', direction: 'in', body: `Came back through ${source.name} (${code})${vehicle ? ' about ' + vehicle.stock_no : ''}` });
  if (assignee && !open) await logActivity({ lead, staff: assignee, kind: 'assign', body: `Allocated to ${assignee.full_name}` });
  const result = { code, contact: contact.code, name: contact.full_name, repeat_customer: !!existing && !open, duplicate_of: open?.code ?? null, assigned_to: assignee?.code ?? null, salesperson: assignee?.full_name ?? null, site: site.code };
  out(result, () => open
    ? `${code}: ${contact.full_name} already has an open lead (${open.code}, with ${open.salesperson || 'nobody'}). Linked as a repeat enquiry, not a new lead. Tell ${open.salesperson || 'the sales manager'}: they came back.`
    : `${code}: ${contact.full_name} via ${source.name} into ${site.code}, ${assignee ? `allocated to ${assignee.full_name}` : 'NOT ALLOCATED: nobody at this yard is free. Run: leads assign ' + code + ' --to=<who>'}.${existing ? ' (They are already a contact.)' : ''}`);
}

async function localTimestamp(v) {
  const s = String(v).trim();
  const m = s.match(/^(\S+)(?:\s+|T)(\S+)$/);
  const date = parseDate(m ? m[1] : s);
  const time = m ? parseTime(m[2]) : '09:00';
  const [r] = await db.query(`select ($1::timestamp at time zone $2) as ts`, [`${date} ${time}`, setting('timezone', 'Pacific/Auckland')]);
  return r.ts instanceof Date ? r.ts.toISOString() : r.ts;
}

async function cmdAssign(ref, flags) {
  const lead = await findLead(ref);
  if (!OPEN_STAGES.includes(lead.stage)) throw new CliError(`${lead.code} is ${lead.stage}. Only open leads are allocated.`);
  let who;
  if (flags.to) {
    who = await findStaff(flags.to);
    if (!who.active) throw new CliError(`${who.full_name} is not active.`);
    if (who.away_until && iso(who.away_until) >= TODAY) throw new CliError(`${who.full_name} is away until ${iso(who.away_until)}. Pick someone else, or run: leads assign ${lead.code} (picks for you)`);
  } else {
    who = await pickSalesperson(lead.site_id);
    if (!who) throw new CliError(`Nobody at ${lead.site} is free to take ${lead.code}. Use --to=<who>.`);
  }
  await db.query('update leads set assigned_to = $2, assigned_at = now() where id = $1', [lead.id, who.id]);
  await db.query('update leads set assigned_to = $2, assigned_at = now() where duplicate_of = $1', [lead.id, who.id]);
  await logActivity({ lead, staff: await staffBy(flags), kind: 'assign', body: `Allocated to ${who.full_name}${lead.salesperson ? ` (was ${lead.salesperson})` : ''}` });
  out({ code: lead.code, assigned_to: who.code, salesperson: who.full_name, was: lead.salesperson_code }, `${lead.code} ${lead.contact} is now with ${who.full_name}.`);
}

async function cmdLog(ref, text, flags) {
  if (!text) throw new CliError('What happened? leads log <lead> "Called, booked a Saturday visit" --kind=call');
  const kind = String(flags.kind || 'note');
  if (!['call', 'sms', 'email', 'visit', 'note'].includes(kind)) throw new CliError('--kind is call, sms, email, visit or note.');
  const direction = kind === 'note' ? null : flags.in ? 'in' : 'out';
  let lead = null;
  let contact = null;
  if (/^c-\d+$/i.test(String(ref))) contact = await findContact(ref);
  else { lead = await findLead(ref); [contact] = await db.query('select * from contacts where id = $1', [lead.contact_id]); }
  const staff = (await staffBy(flags)) || (lead?.assigned_to ? (await db.query('select * from staff where id = $1', [lead.assigned_to]))[0] : null);
  if (flags.marketing) {
    if (direction !== 'out') throw new CliError('Only an outgoing message can be marketing.');
    if (contact.unsubscribed_at || contact.unsubscribe_requested_at) throw new CliError(`${contact.full_name} has unsubscribed. No marketing, ever (UEMA 2007 s 11). Reply to their own questions only.`);
    if (contact.marketing_consent === 'none') throw new CliError(`${contact.full_name} has not consented to marketing (UEMA 2007 s 9). Record consent first if they gave it: leads consent ${contact.code} express --source="..."`);
  }
  await logActivity({ lead, contact, staff, kind, direction, marketing: !!flags.marketing, body: text });
  let firstAnswer = false;
  if (lead && direction === 'out' && TOUCH_KINDS.has(kind) && !lead.first_response_at) {
    await db.query(`update leads set first_response_at = now(), stage = case when stage = 'new' then 'contacted' else stage end where id = $1`, [lead.id]);
    firstAnswer = true;
  }
  if (lead && flags.next) {
    await db.query('update leads set next_action_on = $2, next_action = $3 where id = $1', [lead.id, parseDate(flags.next, '--next'), str(flags.action) || text]);
  }
  const minutesToAnswer = firstAnswer ? Math.round((Date.now() - new Date(lead.received_at)) / 60000) : null;
  out({ lead: lead?.code ?? null, contact: contact.code, kind, direction, marketing: !!flags.marketing, first_answer: firstAnswer, minutes_to_answer: minutesToAnswer },
    `Logged on ${lead ? lead.code : contact.code} ${contact.full_name}.${firstAnswer ? ` First answer, ${mins(minutesToAnswer)} after it came in.` : ''}${flags.next ? ` Next step ${parseDate(flags.next)}.` : ''}`);
}

async function cmdNext(ref, date, action, flags) {
  const lead = await findLead(ref);
  const on = parseDate(date, 'date');
  if (!on) throw new CliError('When? leads next <lead> <date> "what you will do"');
  await db.query('update leads set next_action_on = $2, next_action = $3 where id = $1', [lead.id, on, action || lead.next_action || 'Follow up']);
  await logActivity({ lead, staff: await staffBy(flags), kind: 'note', body: `Next step ${on}: ${action || 'Follow up'}` });
  out({ code: lead.code, next_action_on: on, next_action: action || 'Follow up' }, `${lead.code} ${lead.contact}: next step ${on}, ${action || 'follow up'}.`);
}

async function cmdStage(ref, stage, flags) {
  const lead = await findLead(ref);
  if (!OPEN_STAGES.includes(stage)) throw new CliError(`Stage is one of ${OPEN_STAGES.join(', ')}. A sale closes through "deal" and "deliver"; a loss through "lost".`);
  if (!OPEN_STAGES.includes(lead.stage)) throw new CliError(`${lead.code} is already ${lead.stage}.`);
  await db.query('update leads set stage = $2 where id = $1', [lead.id, stage]);
  await logActivity({ lead, staff: await staffBy(flags), kind: 'stage', body: `${lead.stage} to ${stage}` });
  out({ code: lead.code, from: lead.stage, to: stage }, `${lead.code} ${lead.contact}: ${lead.stage} to ${stage}.`);
}

async function cmdLost(ref, flags) {
  const lead = await findLead(ref);
  const reason = str(flags.reason).trim();
  if (!reason) throw new CliError('Why was it lost? --reason="Bought elsewhere" (the reason is what the monthly review learns from).');
  if (!OPEN_STAGES.includes(lead.stage)) throw new CliError(`${lead.code} is already ${lead.stage}.`);
  const [deal] = await db.query(`select code from deals where lead_id = $1 and status = 'written'`, [lead.id]);
  if (deal) throw new CliError(`${lead.code} has a written deal (${deal.code}). Cancel it first: leads cancel ${deal.code} --reason="..."`);
  await db.query(`update leads set stage = 'lost', lost_reason = $2, closed_at = now(), next_action = null, next_action_on = null where id = $1`, [lead.id, reason]);
  const cancelled = await db.query(`update appointments set outcome = 'cancelled' where lead_id = $1 and outcome is null and starts_at > now() returning id`, [lead.id]);
  await db.query(`update appraisals set status = 'declined' where lead_id = $1 and status = 'open'`, [lead.id]);
  await logActivity({ lead, staff: await staffBy(flags), kind: 'stage', body: `Lost: ${reason}` });
  out({ code: lead.code, lost_reason: reason, appointments_cancelled: cancelled.length }, `${lead.code} ${lead.contact} marked lost (${reason}).${cancelled.length ? ` ${cancelled.length} future appointment(s) cancelled.` : ''}`);
}

// ---------------------------------------------------------------- writes: appointments and test drives

async function cmdBook(ref, flags) {
  const lead = await findLead(ref);
  if (!OPEN_STAGES.includes(lead.stage)) throw new CliError(`${lead.code} is ${lead.stage}.`);
  const kind = String(flags.kind || 'visit');
  if (!['visit', 'test_drive', 'appraisal', 'delivery'].includes(kind)) throw new CliError('--kind is visit, test_drive, appraisal or delivery.');
  if (!flags.at) throw new CliError('When? --at="2026-11-01 10:30" or --at="+2 2pm"');
  const ts = await localTimestamp(flags.at);
  if (new Date(ts) < new Date(Date.now() - 5 * 60000)) throw new CliError(`${when(ts)} is in the past.`);
  const staff = (await staffBy(flags)) || (lead.assigned_to ? (await db.query('select * from staff where id = $1', [lead.assigned_to]))[0] : null);
  if (staff?.away_until && iso(staff.away_until) >= iso(ts)) throw new CliError(`${staff.full_name} is away until ${iso(staff.away_until)}. Book with someone else: --by=<who>`);
  const [ap] = await db.query(`insert into appointments (lead_id, staff_id, starts_at, kind) values ($1, $2, $3, $4) returning *`, [lead.id, staff?.id ?? null, ts, kind]);
  if (['new', 'contacted'].includes(lead.stage)) await db.query(`update leads set stage = 'appointment' where id = $1`, [lead.id]);
  await db.query(`update leads set next_action = $2, next_action_on = ($3::timestamptz at time zone $4)::date where id = $1`, [lead.id, `${kind.replace('_', ' ')} booked`, ts, setting('timezone', 'Pacific/Auckland')]);
  await logActivity({ lead, staff, kind: 'note', body: `Booked a ${kind.replace('_', ' ')} for ${when(ts)}` });
  out({ code: lead.code, appointment: ap.id, starts_at: ts, kind, with: staff?.code ?? null }, `${lead.code} ${lead.contact}: ${kind.replace('_', ' ')} booked ${when(ts)}${staff ? ' with ' + staff.full_name : ''}.`);
}

async function cmdOutcome(ref, outcome, flags) {
  const lead = await findLead(ref);
  if (!['showed', 'no_show', 'cancelled'].includes(outcome)) throw new CliError('Outcome is showed, no_show or cancelled.');
  const [ap] = await db.query(`select * from appointments where lead_id = $1 and outcome is null and starts_at < now() + interval '1 day' order by starts_at limit 1`, [lead.id]);
  if (!ap) throw new CliError(`${lead.code} has no appointment waiting for an outcome.`);
  await db.query('update appointments set outcome = $2 where id = $1', [ap.id, outcome]);
  await logActivity({ lead, staff: await staffBy(flags), kind: outcome === 'showed' ? 'visit' : 'note', direction: outcome === 'showed' ? 'in' : null, body: `${ap.kind.replace('_', ' ')} ${when(ap.starts_at)}: ${outcome.replace('_', ' ')}` });
  out({ code: lead.code, appointment: ap.id, outcome }, `${lead.code} ${lead.contact}: ${ap.kind.replace('_', ' ')} ${when(ap.starts_at)} marked ${outcome.replace('_', ' ')}.${outcome === 'no_show' ? ' Draft the follow-up: /draft-followups' : ''}`);
}

async function cmdDrive(ref, flags) {
  const lead = await findLead(ref);
  const vehicle = await findVehicle(flags.vehicle || lead.stock_no);
  if (!['in_stock', 'on_hold'].includes(vehicle.status)) throw new CliError(`${vehicle.stock_no} is ${vehicle.status}.`);
  const [out_] = await db.query(`select c.full_name from test_drives td join contacts c on c.id = td.contact_id where td.vehicle_id = $1 and td.back_at is null`, [vehicle.id]);
  if (out_) throw new CliError(`${vehicle.stock_no} is already out with ${out_.full_name}. Book it back first: leads back ${vehicle.stock_no}`);
  const [contact] = await db.query('select * from contacts where id = $1', [lead.contact_id]);
  // The licence is sighted on every drive, even when one is on file from last time.
  const licence = str(flags.licence).trim();
  const expires = flags.expires ? parseDate(flags.expires, '--expires') : licence && licence === contact.licence_no && contact.licence_expires_on ? iso(contact.licence_expires_on) : null;
  if (!licence) throw new CliError(`No test drive without the driver licence sighted. Look at the card and record it: --licence=<number> --expires=<date>${contact.licence_no ? ` (on file from before: ${contact.licence_no}, expires ${iso(contact.licence_expires_on)})` : ''}. Land Transport Act 1998 s 31.`);
  if (!expires) throw new CliError('When does the licence expire? --expires=YYYY-MM-DD');
  if (expires < TODAY) throw new CliError(`That licence expired on ${expires}. No test drive on an expired licence.`);
  const staff = (await staffBy(flags)) || (lead.assigned_to ? (await db.query('select * from staff where id = $1', [lead.assigned_to]))[0] : null);
  await db.query('update contacts set licence_no = $2, licence_expires_on = $3 where id = $1', [contact.id, licence, expires]);
  const [td] = await db.query(`insert into test_drives (lead_id, contact_id, vehicle_id, staff_id, licence_no, licence_expires_on, licence_sighted, odometer_out)
    values ($1, $2, $3, $4, $5, $6, true, $7) returning *`, [lead.id, contact.id, vehicle.id, staff?.id ?? null, licence, expires, intFlag(flags.odometer, vehicle.odometer_km ?? 0) || null]);
  if (['new', 'contacted', 'appointment'].includes(lead.stage)) await db.query(`update leads set stage = 'test_drive' where id = $1`, [lead.id]);
  if (!lead.vehicle_id) await db.query('update leads set vehicle_id = $2 where id = $1', [lead.id, vehicle.id]);
  if (!lead.first_response_at) await db.query('update leads set first_response_at = now() where id = $1', [lead.id]);
  await db.query(`update appointments set outcome = 'showed' where lead_id = $1 and outcome is null and starts_at < now() + interval '3 hours' and starts_at > now() - interval '1 day'`, [lead.id]);
  await logActivity({ lead, staff, kind: 'visit', direction: 'in', body: `Test drive out: ${vehicle.stock_no} ${vehicle.year} ${vehicle.make} ${vehicle.model}, licence ${licence} sighted` });
  out({ code: lead.code, test_drive: td.id, vehicle: vehicle.stock_no, licence }, `${contact.full_name} is out in ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.stock_no}). Licence ${licence} sighted. Book it back: leads back ${vehicle.stock_no}`);
}

async function cmdBack(ref, flags) {
  let rows = await db.query(`select td.*, v.stock_no, v.make, v.model, c.full_name from test_drives td join vehicles v on v.id = td.vehicle_id join contacts c on c.id = td.contact_id
    left join leads l on l.id = td.lead_id where td.back_at is null and (lower(v.stock_no) = lower($1) or lower(coalesce(v.rego, '')) = lower($1) or lower(coalesce(l.code, '')) = lower($1) or c.full_name ilike $2)`, [ref, `%${ref}%`]);
  if (!rows.length) throw new CliError(`No car out on a test drive matches "${ref}". Run: leads drives --out`);
  if (rows.length > 1) throw ambiguous('test drive', rows, (r) => `${r.stock_no} ${r.make} ${r.model} with ${r.full_name}`);
  const td = rows[0];
  const odo = flags.odometer ? intFlag(flags.odometer) : null;
  if (odo !== null && td.odometer_out && odo < td.odometer_out) throw new CliError(`The odometer cannot go backwards (out at ${td.odometer_out} km).`);
  await db.query(`update test_drives set back_at = now(), odometer_back = $2, notes = coalesce($3, notes) where id = $1`, [td.id, odo, str(flags.notes) || null]);
  if (odo !== null) await db.query('update vehicles set odometer_km = greatest(coalesce(odometer_km, 0), $2) where id = $1', [td.vehicle_id, odo]);
  const minutes = Math.round((Date.now() - new Date(td.out_at)) / 60000);
  out({ test_drive: td.id, vehicle: td.stock_no, minutes, km: odo !== null && td.odometer_out ? odo - td.odometer_out : null }, `${td.stock_no} is back from ${td.full_name}'s drive after ${mins(minutes)}.`);
}

// ---------------------------------------------------------------- writes: trade-ins and deals

async function cmdAppraise(ref, flags) {
  const lead = await findLead(ref);
  const offer = parseMoney(flags.offer, '--offer');
  if (offer === null) throw new CliError('What is the offer? --offer=6500');
  if (!flags.make || !flags.model) throw new CliError('Which car is being traded? --rego= --year= --make= --model= --km=');
  const validDays = intFlag(flags.valid, settingInt('appraisal_valid_days', 7));
  const staff = (await staffBy(flags)) || null;
  const code = await nextCode('appraisals', 'A-', 301);
  const [a] = await db.query(`insert into appraisals (code, lead_id, contact_id, rego, vin, year, make, model, odometer_km, condition, offer_cents, appraised_by, valid_until)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, biz_today() + $13::int) returning *`,
    [code, lead.id, lead.contact_id, str(flags.rego).toUpperCase() || null, str(flags.vin) || null, flags.year ? intFlag(flags.year) : null, str(flags.make), str(flags.model), flags.km ? intFlag(flags.km) : null, str(flags.condition) || null, offer, staff?.id ?? null, validDays]);
  await db.query('update leads set has_trade = true where id = $1', [lead.id]);
  await logActivity({ lead, staff, kind: 'note', body: `Trade-in appraised (${code}): ${a.year || ''} ${a.make} ${a.model}, offer ${nzd(offer)}, valid to ${iso(a.valid_until)}` });
  out({ code, lead: lead.code, offer_cents: offer, valid_until: iso(a.valid_until), ppsr_checked_on: null }, `${code}: ${a.year || ''} ${a.make} ${a.model} for ${lead.contact}, offer ${nzd(offer)} valid to ${iso(a.valid_until)}. Search the PPSR before it goes on a deal: leads ppsr ${code} --clear (or --owing=<amount>)`);
}

async function cmdPpsr(ref, flags) {
  const a = await findAppraisal(ref);
  if (!flags.clear && flags.owing === undefined) throw new CliError('What did the PPSR search show? --clear, or --owing=<amount still owed to the finance company>');
  const owing = flags.clear ? 0 : parseMoney(flags.owing, '--owing');
  await db.query('update appraisals set ppsr_checked_on = biz_today(), money_owing_cents = $2 where id = $1', [a.id, owing]);
  await db.query(`update deals set payout_cents = $2 where appraisal_id = $1 and status = 'written'`, [a.id, owing]);
  out({ code: a.code, ppsr_checked_on: TODAY, money_owing_cents: owing }, `${a.code}: PPSR searched ${TODAY}, ${owing ? `${nzd(owing)} owing. The payout goes on the deal and is cleared before delivery.` : 'nothing registered.'}`);
}

async function cmdDeal(ref, flags) {
  const lead = await findLead(ref);
  if (!OPEN_STAGES.includes(lead.stage)) throw new CliError(`${lead.code} is ${lead.stage}.`);
  const vehicle = await findVehicle(flags.vehicle || lead.stock_no);
  const [held] = await db.query(`select d.code, c.full_name from deals d join contacts c on c.id = d.contact_id where d.vehicle_id = $1 and d.status = 'written'`, [vehicle.id]);
  if (held) throw new CliError(`${vehicle.stock_no} is already on deal ${held.code} for ${held.full_name}.`);
  if (vehicle.status !== 'in_stock') throw new CliError(`${vehicle.stock_no} is ${vehicle.status}.`);
  const price = parseMoney(flags.price, '--price') ?? (vehicle.price_cents === null ? null : n(vehicle.price_cents));
  if (price === null) throw new CliError('What is the sale price? --price=');
  let appraisal = null;
  if (flags.trade) {
    appraisal = await findAppraisal(flags.trade);
    if (appraisal.lead_id && appraisal.lead_id !== lead.id) throw new CliError(`${appraisal.code} belongs to another lead.`);
    if (appraisal.status !== 'open' && appraisal.status !== 'accepted') throw new CliError(`${appraisal.code} is ${appraisal.status}.`);
    if (!appraisal.ppsr_checked_on) throw new CliError(`${appraisal.code} has not been searched on the PPSR. A registered security follows the car (PPSA 1999). Search it, then: leads ppsr ${appraisal.code} --clear (or --owing=<amount>)`);
    if (iso(appraisal.valid_until) < TODAY) throw new CliError(`${appraisal.code} expired on ${iso(appraisal.valid_until)}. Re-appraise the car: leads appraise ${lead.code} ...`);
  }
  const deposit = parseMoney(flags.deposit, '--deposit') ?? 0;
  const depositMethod = deposit ? String(flags['deposit-method'] || 'card') : 'none';
  const balanceMethod = String(flags.balance || (lead.wants_finance ? 'finance' : 'transfer'));
  if (!['none', 'cash', 'cheque', 'card', 'transfer'].includes(depositMethod)) throw new CliError('--deposit-method is cash, cheque, card or transfer.');
  if (!['cash', 'cheque', 'card', 'transfer', 'finance'].includes(balanceMethod)) throw new CliError('--balance is cash, cheque, card, transfer or finance.');
  const deal = { sale_price_cents: price, trade_allowance_cents: appraisal ? n(appraisal.offer_cents) : 0, payout_cents: appraisal ? n(appraisal.money_owing_cents) : 0, deposit_cents: deposit, deposit_method: depositMethod, balance_method: balanceMethod };
  const cash = cashTotal(deal);
  if (cash >= CASH_LIMIT_CENTS) throw new CliError(`${nzd(cash)} in cash or cheque on one car. A dealer must not sell a car for NZ$10,000 or more in cash (AML/CFT Act 2009 s 67A). Take it by transfer, card or finance.`);
  const code = await nextCode('deals', 'D-', 501);
  const staff = (await staffBy(flags)) || (lead.assigned_to ? (await db.query('select * from staff where id = $1', [lead.assigned_to]))[0] : null);
  await db.query(`insert into deals (code, lead_id, contact_id, vehicle_id, salesperson_id, sale_price_cents, appraisal_id, trade_allowance_cents, payout_cents, deposit_cents, deposit_method, balance_method, written_on)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, biz_today())`,
    [code, lead.id, lead.contact_id, vehicle.id, staff?.id ?? null, price, appraisal?.id ?? null, deal.trade_allowance_cents, deal.payout_cents, deposit, depositMethod, balanceMethod]);
  await db.query(`update vehicles set status = 'on_hold' where id = $1`, [vehicle.id]);
  if (appraisal) await db.query(`update appraisals set status = 'accepted' where id = $1`, [appraisal.id]);
  await db.query(`update leads set stage = 'negotiating', vehicle_id = $2, next_action = 'Deliver', next_action_on = biz_today() + 3 where id = $1`, [lead.id, vehicle.id]);
  await logActivity({ lead, staff, kind: 'note', body: `Deal ${code} written: ${vehicle.stock_no} at ${nzd(price)}${appraisal ? `, trade ${appraisal.code} at ${nzd(appraisal.offer_cents)}` : ''}${deposit ? `, deposit ${nzd(deposit)} by ${depositMethod}` : ''}, balance by ${balanceMethod}` });
  const toPay = price - deal.trade_allowance_cents + deal.payout_cents - deposit;
  out({ code, lead: lead.code, vehicle: vehicle.stock_no, sale_price_cents: price, trade_allowance_cents: deal.trade_allowance_cents, payout_cents: deal.payout_cents, deposit_cents: deposit, balance_cents: toPay, balance_method: balanceMethod },
    `${code}: ${lead.contact}, ${vehicle.year} ${vehicle.make} ${vehicle.model} at ${nzd(price)}. Balance ${nzd(toPay)} by ${balanceMethod}.${balanceMethod === 'finance' ? ` Record the credit check authority before applying: leads finance ${code} applied --consent --lender="..."` : ''}`);
}

async function cmdFinance(ref, status, flags) {
  const d = await findDeal(ref);
  if (!['applied', 'approved', 'declined'].includes(status)) throw new CliError('Finance status is applied, approved or declined.');
  if (d.status !== 'written') throw new CliError(`${d.code} is ${d.status}.`);
  let consentAt = d.credit_consent_at;
  if (flags.consent) consentAt = new Date().toISOString();
  if (!consentAt) throw new CliError(`No credit check authority on file for ${d.contact}. A finance application goes to a lender only with the customer's signed privacy authority (Privacy Act 2020 IPP 11). Once it is signed: leads finance ${d.code} ${status} --consent`);
  await db.query(`update deals set finance_status = $2, lender = coalesce($3, lender), credit_consent_at = $4, balance_method = 'finance' where id = $1`, [d.id, status, str(flags.lender) || null, consentAt]);
  if (d.lead_id) await logActivity({ lead: { id: d.lead_id, contact_id: d.contact_id }, staff: await staffBy(flags), kind: 'note', body: `Finance ${status}${flags.lender ? ' with ' + flags.lender : d.lender ? ' with ' + d.lender : ''}` });
  out({ code: d.code, finance_status: status, lender: str(flags.lender) || d.lender }, `${d.code} ${d.contact}: finance ${status}.${status === 'declined' ? ' Talk to them about a cheaper car, a bigger deposit or another lender.' : ''}`);
}

async function cmdDeliver(ref, flags) {
  const d = await findDeal(ref);
  if (d.status !== 'written') throw new CliError(`${d.code} is ${d.status}.`);
  if (d.balance_method === 'finance' && d.finance_status !== 'approved') throw new CliError(`${d.code} is on finance and finance is ${d.finance_status}. Deliver once it is approved, or change how the balance is paid.`);
  if (d.appraisal_id && !d.ppsr_checked_on) throw new CliError(`${d.code}'s trade-in (${d.appraisal_code}) has no PPSR search. Search it first: leads ppsr ${d.appraisal_code} --clear`);
  const cash = cashTotal(d);
  if (cash >= CASH_LIMIT_CENTS) throw new CliError(`${d.code} would take ${nzd(cash)} in cash or cheque. Not lawful for a dealer (AML/CFT Act 2009 s 67A).`);
  await db.query(`update deals set status = 'delivered', delivered_on = biz_today() where id = $1`, [d.id]);
  await db.query(`update vehicles set status = 'sold' where id = $1`, [d.vehicle_id]);
  if (d.lead_id) {
    await db.query(`update leads set stage = 'sold', closed_at = now(), next_action = 'Seven-day check-in call', next_action_on = null where id = $1`, [d.lead_id]);
    await db.query(`update appointments set outcome = 'showed' where lead_id = $1 and kind = 'delivery' and outcome is null and starts_at < now() + interval '1 day'`, [d.lead_id]);
    await logActivity({ lead: { id: d.lead_id, contact_id: d.contact_id }, staff: await staffBy(flags), kind: 'stage', body: `Delivered ${d.vehicle} (${d.code})` });
  }
  out({ code: d.code, delivered_on: TODAY, vehicle: d.stock_no }, `${d.code}: ${d.vehicle} delivered to ${d.contact}. Lead closed as sold.`);
}

async function cmdCancel(ref, flags) {
  const d = await findDeal(ref);
  const reason = str(flags.reason).trim();
  if (!reason) throw new CliError('Why is the deal off? --reason="..."');
  if (d.status !== 'written') throw new CliError(`${d.code} is ${d.status}; only a written deal can be cancelled.`);
  await db.query(`update deals set status = 'cancelled', cancel_reason = $2 where id = $1`, [d.id, reason]);
  await db.query(`update vehicles set status = 'in_stock' where id = $1 and status = 'on_hold'`, [d.vehicle_id]);
  if (d.appraisal_id) await db.query(`update appraisals set status = 'open' where id = $1`, [d.appraisal_id]);
  if (d.lead_id) await logActivity({ lead: { id: d.lead_id, contact_id: d.contact_id }, staff: await staffBy(flags), kind: 'note', body: `Deal ${d.code} cancelled: ${reason}` });
  out({ code: d.code, status: 'cancelled', reason }, `${d.code} cancelled (${reason}). ${d.stock_no} is back in stock; the lead stays open.`);
}

// ---------------------------------------------------------------- writes: consent, privacy, team

async function cmdConsent(ref, level, flags) {
  const c = await findContact(ref);
  if (!['express', 'inferred', 'none'].includes(level)) throw new CliError('Consent is express (they said yes), inferred (an existing customer relationship) or none.');
  if (level !== 'none' && (c.unsubscribed_at || c.unsubscribe_requested_at) && !flags.resubscribed) throw new CliError(`${c.full_name} unsubscribed. Only record consent again if they asked to hear from you again: add --resubscribed --source="what they said"`);
  if (level !== 'none' && !flags.source) throw new CliError('How did they consent? --source="Ticked the box on the test drive form"');
  await db.query(`update contacts set marketing_consent = $2, consent_at = case when $2 = 'none' then null else now() end, consent_source = $3,
      unsubscribe_requested_at = case when $4 then null else unsubscribe_requested_at end, unsubscribed_at = case when $4 then null else unsubscribed_at end where id = $1`,
    [c.id, level, level === 'none' ? null : str(flags.source), !!flags.resubscribed]);
  await logActivity({ contact: c, kind: 'consent', body: `Marketing consent: ${level}${flags.source ? ' (' + flags.source + ')' : ''}` });
  out({ contact: c.code, marketing_consent: level }, `${c.code} ${c.full_name}: marketing consent ${level}.`);
}

async function cmdUnsubscribe(ref) {
  const c = await findContact(ref);
  await db.query(`update contacts set unsubscribe_requested_at = coalesce(unsubscribe_requested_at, now()), unsubscribed_at = now(), marketing_consent = 'none' where id = $1`, [c.id]);
  await logActivity({ contact: c, kind: 'consent', body: 'Unsubscribed from marketing' });
  out({ contact: c.code, unsubscribed: true }, `${c.code} ${c.full_name} is unsubscribed. No marketing from here on; replies to their own questions are still fine. Remove them from any list held outside this system too.`);
}

async function cmdAnonymise(flags) {
  const months = settingInt('retention_months', 24);
  const rows = await retentionCandidates(months);
  if (!flags.yes) {
    out({ dry_run: true, months, contacts: rows.map((r) => ({ code: r.code, name: r.full_name, last_at: r.last_at })) }, () => heading(`Lost leads with no dealings for ${months} months (${rows.length})`) + '\n' +
      table(rows, [{ key: 'code', label: 'code' }, { key: 'full_name', label: 'name' }, { key: 'last_at', label: 'last dealing', format: iso }]) + `\n\n  Nothing changed. Run again with --yes to clear their names, numbers, emails and licence details. The lead history and counts stay.`);
    return;
  }
  for (const r of rows) {
    await db.query(`update contacts set full_name = 'Anonymised ' || code, mobile = null, email = null, suburb = null, licence_no = null, licence_expires_on = null, external_ref = null, anonymised_at = now() where id = $1`, [r.id]);
    await db.query(`update activities set body = '(removed)' where contact_id = $1 and kind not in ('stage', 'assign', 'system')`, [r.id]);
    await db.query(`update test_drives set licence_no = null where contact_id = $1`, [r.id]);
  }
  out({ dry_run: false, anonymised: rows.length }, `${rows.length} contact(s) anonymised. Lead counts, sources and outcomes stay for the reports.`);
}

async function cmdAway(ref, flags) {
  const s = await findStaff(ref);
  const until = flags.back ? null : parseDate(flags.until, '--until');
  if (!flags.back && !until) throw new CliError('Until when? --until=YYYY-MM-DD, or --back when they are back.');
  await db.query('update staff set away_until = $2 where id = $1', [s.id, until]);
  const held = await db.query(`select code from leads where assigned_to = $1 and stage not in ('sold','lost') and duplicate_of is null and first_response_at is null`, [s.id]);
  out({ staff: s.code, away_until: until, unanswered_leads: held.map((h) => h.code) }, `${s.full_name} ${until ? `is away until ${until}. New leads skip them.` : 'is back and taking leads.'}${until && held.length ? ` Still holding ${held.length} unanswered: ${held.map((h) => h.code).join(', ')}. Move each one: leads assign <lead>` : ''}`);
}

async function cmdSourceAdd(code, flags) {
  if (!code) throw new CliError('leads source-add <CODE> --name="Driven.co.nz" --kind=portal --spend=900');
  const kind = String(flags.kind || 'other');
  const spend = parseMoney(flags.spend, '--spend') ?? 0;
  const [r] = await db.query(`insert into lead_sources (code, name, kind, monthly_spend_cents) values (upper($1), $2, $3, $4)
    on conflict (code) do update set name = excluded.name, kind = excluded.kind, monthly_spend_cents = excluded.monthly_spend_cents returning *`, [code, str(flags.name) || code, kind, spend]);
  out(r, `${r.code} ${r.name} (${r.kind}), ${nzd(r.monthly_spend_cents)} a month.`);
}

// ---------------------------------------------------------------- import and export

// AutoPlay does not document a lead export, so this reads whatever CSV the dealer can get: a report
// printed to CSV, a portal's own lead download, or a spreadsheet kept by hand. Common column names
// are matched; anything unmatched is reported, not guessed.
async function cmdImport(kind, file, flags) {
  if (!['leads', 'stock'].includes(kind) || !file) throw new CliError('leads import leads <file.csv> [--dry-run]   or   leads import stock <file.csv> [--dry-run]');
  if (!existsSync(file)) throw new CliError(`No file at ${file}`);
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const dry = !!flags['dry-run'];
  const result = { kind, file, rows: rows.length, created: 0, updated: 0, skipped_existing: 0, problems: [], dry_run: dry };
  await db.exec('BEGIN');
  try {
    if (kind === 'stock') await importStock(rows, result);
    else await importLeads(rows, result, flags);
    await db.exec(dry ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
  out(result, () => `${dry ? 'DRY RUN, nothing saved. ' : ''}${kind}: ${result.rows} rows, ${result.created} created, ${result.updated} updated, ${result.skipped_existing} already there.` +
    (result.problems.length ? `\n${result.problems.length} row(s) not imported:\n${result.problems.map((p) => '  - ' + p).join('\n')}` : ''));
}

async function importStock(rows, result) {
  const sites = await db.query('select * from sites');
  for (const [i, r] of rows.entries()) {
    const stock = pick(r, 'Stock No', 'Stock Number', 'Stock #', 'StockNo', 'Stock');
    const make = pick(r, 'Make');
    const model = pick(r, 'Model');
    if (!stock || !make || !model) { result.problems.push(`row ${i + 2}: needs a stock number, make and model`); continue; }
    const siteRef = pick(r, 'Site', 'Yard', 'Branch', 'Location');
    const site = siteRef ? sites.find((s) => s.code.toLowerCase() === siteRef.toLowerCase() || s.name.toLowerCase().includes(siteRef.toLowerCase()) || (s.city || '').toLowerCase() === siteRef.toLowerCase()) : sites.length === 1 ? sites[0] : null;
    if (siteRef && !site) { result.problems.push(`row ${i + 2}: ${stock} yard "${siteRef}" is not set up`); continue; }
    const statusRaw = pick(r, 'Status').toLowerCase();
    const status = /sold|delivered/.test(statusRaw) ? 'sold' : /hold|deposit/.test(statusRaw) ? 'on_hold' : /gone|wholesale|removed/.test(statusRaw) ? 'gone' : 'in_stock';
    let price = null;
    try { price = parseMoney(pick(r, 'Price', 'Retail Price', 'Advertised Price', 'Sale Price') || null, 'price'); } catch { result.problems.push(`row ${i + 2}: ${stock} price "${pick(r, 'Price')}" is not an amount`); continue; }
    const vals = [stock, pick(r, 'Rego', 'Registration', 'Plate').toUpperCase() || null, pick(r, 'VIN', 'Chassis') || null, Number(pick(r, 'Year')) || null, make, model, pick(r, 'Variant', 'Series', 'Badge') || null,
      pick(r, 'Body', 'Body Type') || null, pick(r, 'Fuel', 'Fuel Type') || null, Number(digits(pick(r, 'Odometer', 'Kms', 'KM', 'Mileage'))) || null, price, site?.id ?? null, status,
      pick(r, 'In Stock', 'Date In', 'Stocked') ? parseDate(pick(r, 'In Stock', 'Date In', 'Stocked')) : null];
    const [ex] = await db.query('select id from vehicles where lower(stock_no) = lower($1)', [stock]);
    if (ex) {
      await db.query(`update vehicles set rego = coalesce($2, rego), odometer_km = coalesce($3, odometer_km), price_cents = coalesce($4, price_cents), status = $5 where id = $1`,
        [ex.id, vals[1], vals[9], vals[10], status]);
      result.updated++;
    } else {
      await db.query(`insert into vehicles (stock_no, rego, vin, year, make, model, variant, body, fuel, odometer_km, price_cents, site_id, status, in_stock_on) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, vals);
      result.created++;
    }
  }
}

async function importLeads(rows, result, flags) {
  const sources = await db.query('select * from lead_sources');
  const staff = await db.query('select * from staff');
  const sites = await db.query('select * from sites');
  for (const [i, r] of rows.entries()) {
    const where = `row ${i + 2}`;
    const name = pick(r, 'Name', 'Customer', 'Contact', 'Full Name') || [pick(r, 'First Name', 'Firstname'), pick(r, 'Last Name', 'Surname', 'Lastname')].filter(Boolean).join(' ');
    const mobile = pick(r, 'Mobile', 'Phone', 'Mobile Phone', 'Cell') || null;
    const email = (pick(r, 'Email', 'Email Address') || '').toLowerCase() || null;
    if (!name || (!mobile && !email)) { result.problems.push(`${where}: needs a name and a mobile or email`); continue; }
    const ref = pick(r, 'Lead ID', 'Lead Id', 'Enquiry ID', 'ID', 'Reference') || null;
    if (ref) {
      const [ex] = await db.query('select id from leads where external_ref = $1', [ref]);
      if (ex) { result.skipped_existing++; continue; }
    }
    const srcRef = pick(r, 'Source', 'Lead Source', 'Channel', 'Origin');
    const source = srcRef ? sources.find((s) => s.code.toLowerCase() === srcRef.toLowerCase() || s.name.toLowerCase() === srcRef.toLowerCase() || s.kind === srcRef.toLowerCase().replace(/[\s-]+/g, '_') || s.name.toLowerCase().includes(srcRef.toLowerCase()) || srcRef.toLowerCase().includes(s.name.toLowerCase().split(' ')[0])) : null;
    if (!source) { result.problems.push(`${where}: ${name}, source "${srcRef}" is not set up (leads source-add <CODE> --name="${srcRef}")`); continue; }
    const whoRef = pick(r, 'Salesperson', 'Sales Person', 'Assigned To', 'Owner', 'Consultant');
    const who = whoRef ? staff.find((s) => s.code.toLowerCase() === whoRef.toLowerCase() || s.full_name.toLowerCase() === whoRef.toLowerCase()) : null;
    if (whoRef && !who) { result.problems.push(`${where}: ${name}, salesperson "${whoRef}" is not on the team`); continue; }
    const stockRef = pick(r, 'Stock No', 'Stock Number', 'Stock', 'Vehicle Stock No');
    const [vehicle] = stockRef ? await db.query('select * from vehicles where lower(stock_no) = lower($1) or lower(coalesce(rego, \'\')) = lower($1)', [stockRef]) : [];
    const siteRef = pick(r, 'Site', 'Yard', 'Branch', 'Dealership');
    const site = siteRef ? sites.find((s) => s.code.toLowerCase() === siteRef.toLowerCase() || s.name.toLowerCase().includes(siteRef.toLowerCase()) || (s.city || '').toLowerCase() === siteRef.toLowerCase()) : vehicle ? sites.find((s) => s.id === vehicle.site_id) : who ? sites.find((s) => s.id === who.site_id) : sites.length === 1 ? sites[0] : null;
    if (!site) { result.problems.push(`${where}: ${name}, no yard (add a Site column)`); continue; }
    let received;
    try {
      const raw = pick(r, 'Date', 'Received', 'Created', 'Enquiry Date', 'Date Received');
      received = raw ? await localTimestamp(raw.replace(/\s+/, ' ').split(' ').slice(0, 2).join(' ')) : null;
    } catch { result.problems.push(`${where}: ${name}, date "${pick(r, 'Date', 'Received', 'Created')}" not understood`); continue; }
    const statusRaw = pick(r, 'Status', 'Stage').toLowerCase();
    const stage = /sold|won|delivered/.test(statusRaw) ? 'sold' : /lost|dead|closed/.test(statusRaw) ? 'lost' : /drive/.test(statusRaw) ? 'test_drive' : /appoint|booked/.test(statusRaw) ? 'appointment' : /negot|offer|quote/.test(statusRaw) ? 'negotiating' : /contact|progress|follow/.test(statusRaw) ? 'contacted' : statusRaw ? 'contacted' : 'new';
    const d = digits(mobile);
    let [contact] = await db.query(`select * from contacts where (length($1) >= 6 and regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') = $1) or ($2::text is not null and lower(email) = $2) limit 1`, [d, email]);
    if (!contact) {
      const code = await nextCode('contacts', 'C-', 101, 4);
      [contact] = await db.query(`insert into contacts (code, full_name, mobile, email, marketing_consent, external_ref) values ($1, $2, $3, $4, $5, $6) returning *`,
        [code, name, mobile, email, yesNo(pick(r, 'Marketing Consent', 'Opt In', 'Subscribed')) ? 'express' : 'none', ref]);
    }
    const code = await nextCode('leads', 'L-', 1001);
    const reason = stage === 'lost' ? pick(r, 'Lost Reason', 'Reason') || 'Imported as lost' : null;
    const [lead] = await db.query(`insert into leads (code, contact_id, source_id, site_id, vehicle_id, wanted, received_at, assigned_to, assigned_at, first_response_at, stage, lost_reason, closed_at, external_ref)
      values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), $8, case when $8::uuid is null then null else coalesce($7::timestamptz, now()) end, $9, $10, $11, case when $10 in ('sold','lost') then coalesce($7::timestamptz, now()) end, $12) returning *`,
      [code, contact.id, source.id, site.id, vehicle?.id ?? null, vehicle ? null : pick(r, 'Vehicle', 'Interested In', 'Car') || null, received, who?.id ?? null, stage === 'new' ? null : received, stage, reason, ref]);
    const notes = pick(r, 'Notes', 'Comments', 'Message', 'Enquiry');
    await logActivity({ lead, kind: 'system', direction: 'in', body: `Imported from ${flags.from || 'AutoPlay'} via ${source.name}${notes ? ': ' + notes : ''}`, at: received });
    result.created++;
  }
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function cmdExport(flags) {
  const dir = path.resolve(str(flags.out) || path.join(REPO_ROOT, 'exports', TODAY));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tables = ['settings', 'sites', 'staff', 'lead_sources', 'vehicles', 'contacts', 'leads', 'activities', 'appointments', 'test_drives', 'appraisals', 'deals'];
  const counts = {};
  for (const t of tables) {
    const rows = await db.query(`select * from ${t}`);
    const cols = rows.length ? Object.keys(rows[0]) : [];
    writeFileSync(path.join(dir, `${t}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n', { mode: 0o600 });
    counts[t] = rows.length;
  }
  out({ dir, counts }, `Exported ${tables.length} tables to ${dir}\n${Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`).join('\n')}`);
}

// ---------------------------------------------------------------- help and dispatch

const HELP = `Dealer Sales Leads for Claude Code

  The day
    stats                                    the floor in numbers
    attention                                everything that needs a person, worst first
    response [--days=30]                     who is waiting for a first answer, and speed to lead
    followups                                overdue, quiet, no-shows, came back, no next step
    appointments [--days=7] [--past]         who is booked in
    drives [--out]                           test drives (cars out now)

  Leads
    new --name= --mobile= --email= --source= [--vehicle=] [--site=] [--wanted=] [--trade] [--finance] [--consent=express|inferred] [--to=] [--at=]
    leads [--all] [--stage=] [--to=] [--site=] [--source=]
    lead <lead>                              the whole story of one lead
    contact <name|code|mobile|email>
    assign <lead> [--to=]                    re-allocate (no --to: the next free salesperson)
    log <lead|contact> "what happened" --kind=call|sms|email|visit|note [--in] [--marketing] [--next=+2 --action="..."] [--by=]
    next <lead> <date> "what you will do"
    stage <lead> new|contacted|appointment|test_drive|negotiating
    lost <lead> --reason="..."
    book <lead> --at="+2 10:30" [--kind=visit|test_drive|appraisal|delivery] [--by=]
    outcome <lead> showed|no_show|cancelled
    drive <lead> [--vehicle=] --licence= --expires=   a test drive out (licence sighted)
    back <stock|lead> [--odometer=]          the car is back

  Trade-ins and deals
    appraise <lead> --rego= --year= --make= --model= --km= --offer= [--valid=7]
    ppsr <appraisal> --clear | --owing=<amount>
    appraisals [--all]
    deal <lead> [--vehicle=] [--price=] [--trade=<appraisal>] [--deposit= --deposit-method=] [--balance=transfer|finance|card]
    finance <deal> applied|approved|declined [--consent] [--lender=]
    deliver <deal>
    cancel <deal> --reason="..."
    deals [--all]

  The business
    sources [--days=90]                      what each lead source turned into, and what it cost per sale
    team                                     load, answer speed and results per person
    stock [--site=] [--all]                  stock and the interest in each car
    away <who> --until=<date> | --back
    source-add <CODE> --name= --kind= --spend=<monthly>

  Compliance and privacy
    compliance [consent|unsubscribe|licence|ppsr|cash|credit|retention]
    marketing-list [--site=]                 who may be sent marketing
    consent <contact> express|inferred|none --source="..."
    unsubscribe <contact>
    anonymise [--yes]                        lost leads past the retention period

  Data
    import leads|stock <file.csv> [--dry-run]
    export [--out=<dir>]

  Add --json to any command for machine output.`;

async function main() {
  const { args, flags } = parseArgv(process.argv.slice(2));
  JSON_OUT = !!flags.json;
  const [cmd, ...rest] = args;
  if (!cmd || cmd === 'help' || flags.help) { console.log(HELP); return; }
  db = await getDb();
  try {
    SETTINGS = Object.fromEntries((await db.query('select key, value from settings')).map((r) => [r.key, r.value]));
    TODAY = (await db.query('select biz_today()::text as d'))[0].d;
    const handlers = {
      stats: () => cmdStats(),
      leads: () => cmdLeads(flags),
      lead: () => cmdLead(rest[0]),
      contact: () => cmdContact(rest.join(' ')),
      response: () => cmdResponse(flags),
      followups: () => cmdFollowups(),
      appointments: () => cmdAppointments(flags),
      drives: () => cmdDrives(flags),
      appraisals: () => cmdAppraisals(flags),
      deals: () => cmdDeals(flags),
      sources: () => cmdSources(flags),
      team: () => cmdTeam(),
      stock: () => cmdStock(flags),
      attention: () => cmdAttention(),
      compliance: () => cmdCompliance(rest[0]),
      'marketing-list': () => cmdMarketingList(flags),
      new: () => cmdNew(flags),
      assign: () => cmdAssign(rest[0], flags),
      log: () => cmdLog(rest[0], rest.slice(1).join(' '), flags),
      next: () => cmdNext(rest[0], rest[1], rest.slice(2).join(' '), flags),
      stage: () => cmdStage(rest[0], rest[1], flags),
      lost: () => cmdLost(rest[0], flags),
      book: () => cmdBook(rest[0], flags),
      outcome: () => cmdOutcome(rest[0], rest[1], flags),
      drive: () => cmdDrive(rest[0], flags),
      back: () => cmdBack(rest.join(' '), flags),
      appraise: () => cmdAppraise(rest[0], flags),
      ppsr: () => cmdPpsr(rest[0], flags),
      deal: () => cmdDeal(rest[0], flags),
      finance: () => cmdFinance(rest[0], rest[1], flags),
      deliver: () => cmdDeliver(rest[0], flags),
      cancel: () => cmdCancel(rest[0], flags),
      consent: () => cmdConsent(rest[0], rest[1], flags),
      unsubscribe: () => cmdUnsubscribe(rest.join(' ')),
      anonymise: () => cmdAnonymise(flags),
      away: () => cmdAway(rest[0], flags),
      'source-add': () => cmdSourceAdd(rest[0], flags),
      import: () => cmdImport(rest[0], rest[1], flags),
      export: () => cmdExport(flags),
    };
    const h = handlers[cmd];
    if (!h) throw new CliError(`Unknown command "${cmd}". Run: leads help`);
    await h();
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  if (e instanceof CliError) { console.error(e.message); process.exit(e.code); }
  console.error(e.stack || e.message);
  process.exit(1);
});
