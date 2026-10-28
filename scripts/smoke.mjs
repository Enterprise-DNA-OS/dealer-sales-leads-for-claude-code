#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database: migrate, seed, then every command
// that matters, asserting on the JSON. Passes on Windows and Linux. No network, no Postgres install.
// TEST_DATABASE_URL runs the same test against a real Postgres (CI does this).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'leads-smoke-'));
const outDir = path.join(dataDir, 'out');
const env = { ...process.env, DATA_DIR: dataDir, OUTPUT_DIR: outDir };
delete env.DATABASE_URL;
if (process.env.TEST_DATABASE_URL) env.DATABASE_URL = process.env.TEST_DATABASE_URL;

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try { return JSON.parse(res.stdout); } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}
function assert(cond, msg) { if (!cond) { console.error(`\nFAIL assertion: ${msg}`); process.exit(1); } }
const L = (...a) => ['leads.mjs', ...a];
const counts = (comp) => Object.fromEntries(comp.map((x) => [x.id, x.count]));
const refused = (label, args, pattern) => {
  const r = run(label, args, { json: false, expectFail: true });
  assert(pattern.test(r.stderr), `${label}: expected ${pattern}, got "${r.stderr.trim()}"`);
};

console.log(`smoke: ${env.DATABASE_URL ? 'Postgres' : 'embedded database in ' + dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the day
  const stats = run('stats', L('stats'));
  assert(stats.open_leads === 17 && stats.unanswered === 4 && stats.cars_out_on_drives === 1 && stats.deals_written === 3, `stats ${JSON.stringify(stats)}`);
  const comp = counts(run('compliance', L('compliance')));
  assert(comp.consent === 1 && comp.unsubscribe === 2 && comp.licence === 1 && comp.ppsr === 1 && comp.cash === 1 && comp.credit === 1 && comp.retention === 3, `compliance ${JSON.stringify(comp)}`);
  const att = run('attention', L('attention'));
  assert(att[0].area === 'unassigned' && /L-1027/.test(att[0].what), 'the unassigned lead leads the list');
  for (const area of ['away', 'car out', 'first answer', 'came back', 'no-show', 'outcome', 'follow-up', 'trade-in', 'delivery', 'quiet']) assert(att.some((a) => a.area === area), `attention has ${area}`);
  assert(att.find((a) => a.area === 'first answer').what.includes('L-1026') && !att.some((a) => /L-1025/.test(a.what)), 'late answer flagged, the six-minute one is not');
  const resp = run('response', L('response'));
  assert(resp.waiting.length === 4 && resp.waiting.filter((w) => w.over_target).length === 3, 'four waiting, three past target');
  assert(resp.by_salesperson.find((p) => p.key === 'S03').in_target === 4, 'Priya answered all four inside target');
  const fu = run('followups', L('followups'));
  assert(fu.came_back.length === 1 && fu.came_back[0].code === 'L-1012', 'Olivia came back on a quiet lead');
  assert(fu.overdue.length === 1 && fu.no_shows_not_chased.length === 1 && fu.appointments_without_outcome.length === 1 && fu.quiet.length === 1, 'follow-up lists');
  const team = run('team', L('team'));
  assert(team.find((t) => t.code === 'S02').open_leads === 5, 'Ben holds five open leads');
  const src = run('sources', L('sources'));
  const fb = src.sources.find((s) => s.code === 'FB');
  assert(fb.leads === 3 && fb.sold === 0 && fb.spend_cents > 0 && fb.cost_per_sale_cents === null, 'Facebook spent money and sold nothing');
  assert(src.sources.find((s) => s.code === 'TM').sold === 2, 'Trade Me sold two');
  run('stock', L('stock'));
  run('appointments', L('appointments'));
  run('appointments past', L('appointments', '--past'));
  assert(run('drives out', L('drives', '--out')).length === 1, 'one car out');
  assert(run('appraisals', L('appraisals')).length === 1, 'one open trade-in offer');
  assert(run('deals', L('deals')).length === 3 && run('deals --all', L('deals', '--all')).length === 8, 'deals');
  assert(run('leads', L('leads')).length === 17 && run('leads --all', L('leads', '--all')).length === 29, 'lead lists');
  const card = run('one lead', L('lead', 'L-1012'));
  assert(card.duplicates.length === 1 && card.response_minutes === 4, 'lead card shows the repeat enquiry and the four-minute answer');
  run('lead by name', L('lead', 'olivia'));
  run('contact', L('contact', 'C-0111'));
  run('ambiguous contact lists and exits 1', L('contact', 'Walker'), { json: false, expectFail: true });
  const ml = run('marketing list', L('marketing-list'));
  assert(ml.held_back === 4 && !ml.may_message.some((c) => ['C-0105', 'C-0110', 'C-0111'].includes(c.code)), 'no-consent and unsubscribed held back');

  // ---- new leads, duplicates and allocation
  const nl = run('new lead', L('new', '--name=Tama Rewi', '--mobile=021 777 1234', '--email=tama@example.com', '--source=TM', '--vehicle=24103', '--finance'));
  assert(nl.code === 'L-1030' && nl.site === 'HAM' && nl.assigned_to === 'S03' && !nl.duplicate_of, `auto allocated to the least loaded free salesperson (${JSON.stringify(nl)})`);
  const dup = run('the same person again', L('new', '--name=Olivia C', '--mobile=0274000114', '--source=WEB'));
  assert(dup.duplicate_of === 'L-1012' && dup.assigned_to === 'S03' && dup.site === 'HAM', 'linked to the open lead, same salesperson');
  assert(run('still 18 open', L('stats')).open_leads === 18, 'a duplicate is not a new open lead');
  const rep = run('a past enquirer comes back', L('new', '--name=Gary Simmons', '--mobile=027 400 0101', '--source=WALK', '--site=HAM'));
  assert(rep.repeat_customer && !rep.duplicate_of, 'repeat customer reuses the contact');
  refused('a lead with no way back', L('new', '--name=No Number', '--source=TM', '--site=HAM'), /mobile or --email/);
  refused('an unknown source', L('new', '--name=X', '--mobile=0211111111', '--source=Nowhere', '--site=HAM'), /No lead source/);
  run('allocate the unassigned lead', L('assign', 'L-1027'));
  refused('allocate to someone away', L('assign', 'L-1028', '--to=S04'), /away until/);
  const moved = run('move it off the away salesperson', L('assign', 'L-1028'));
  assert(moved.assigned_to !== 'S04' && moved.was === 'S04', 'moved');
  assert(!run('attention after allocating', L('attention')).some((a) => a.area === 'unassigned' || a.area === 'away'), 'nobody unassigned or with someone away');

  // ---- the first answer and follow-up
  const first = run('first call back', L('log', 'L-1026', 'Called, left a message', '--kind=call', '--next=+1', '--action=Try again'));
  assert(first.first_answer && first.minutes_to_answer >= 50, 'first answer recorded');
  assert(run('lead is contacted', L('lead', 'L-1026')).lead.stage === 'contacted', 'new to contacted on first answer');
  refused('marketing without consent', L('log', 'C-0105', 'Spring sale', '--kind=email', '--marketing'), /not consented/);
  refused('marketing after an unsubscribe', L('log', 'C-0110', 'Spring sale', '--kind=email', '--marketing'), /unsubscribed/);
  run('marketing with consent', L('log', 'C-0109', 'New arrivals this week', '--kind=email', '--marketing'));
  run('next step', L('next', 'L-1013', 'today', 'Call to confirm Saturday'));
  assert(run('follow-up no longer overdue', L('followups')).overdue.length === 0, 'overdue cleared');

  // ---- appointments and test drives
  const bk = run('book a test drive', L('book', 'L-1012', '--at=+2 10:30', '--kind=test_drive'));
  assert(bk.with === 'S03', 'booked with the salesperson');
  refused('book in the past', L('book', 'L-1012', '--at=-2 10:30'), /in the past/);
  run('record the outcome', L('outcome', 'L-1017', 'showed'));
  run('no-show is chased', L('log', 'L-1018', 'Texted to rebook', '--kind=sms'));
  const fu2 = run('followups after', L('followups'));
  assert(fu2.appointments_without_outcome.length === 0 && fu2.no_shows_not_chased.length === 0, 'outcome and no-show cleared');
  refused('a test drive with no licence', L('drive', 'L-1014', '--vehicle=24204'), /licence sighted/);
  refused('a test drive on an expired licence', L('drive', 'L-1014', '--vehicle=24204', '--licence=DL100116', '--expires=-3'), /expired/);
  run('a test drive out', L('drive', 'L-1014', '--vehicle=24204', '--licence=DL100116', '--expires=+500'));
  refused('the same car twice', L('drive', 'L-1015', '--vehicle=24204', '--licence=X1', '--expires=+100'), /already out/);
  run('car back', L('back', '24204', '--odometer=19815'));
  refused('odometer backwards', L('back', 'L-1020', '--odometer=10'), /backwards/);
  run('the Hilux back', L('back', 'L-1020', '--odometer=58720'));
  assert(run('no cars out', L('drives', '--out')).length === 0, 'no car out');

  // ---- trade-ins and deals
  refused('a deal with a trade-in not searched on the PPSR', L('deal', 'L-1014', '--vehicle=24204', '--trade=A-302'), /PPSR/);
  run('PPSR search finds money owing', L('ppsr', 'A-302', '--owing=2300'));
  refused('a cash deposit at the limit', L('deal', 'L-1014', '--vehicle=24204', '--trade=A-302', '--price=29500', '--deposit=10000', '--deposit-method=cash'), /67A/);
  refused('a cash balance over the limit', L('deal', 'L-1014', '--vehicle=24204', '--trade=A-302', '--price=29500', '--balance=cash'), /67A/);
  const deal = run('write the deal', L('deal', 'L-1014', '--vehicle=24204', '--trade=A-302', '--price=29500', '--deposit=1000'));
  assert(deal.code === 'D-509' && deal.payout_cents === 230000 && deal.balance_cents === 2950000 - 1150000 + 230000 - 100000, 'payout added to the balance');
  refused('the same car on two deals', L('deal', 'L-1012', '--vehicle=24204'), /already on deal/);
  const ap = run('new appraisal', L('appraise', 'L-1019', '--rego=ABC123', '--year=2015', '--make=Toyota', '--model=Hilux', '--km=180000', '--offer=9000'));
  assert(ap.code === 'A-305' && ap.ppsr_checked_on === null, 'appraisal recorded');
  refused('finance applied with no credit authority', L('finance', 'D-502', 'applied'), /authority/);
  run('finance approved with authority', L('finance', 'D-502', 'approved', '--consent'));
  run('deliver', L('deliver', 'D-502'));
  refused('deliver a trade-in with no PPSR', L('deliver', 'D-503'), /PPSR/);
  run('cancel a deal', L('cancel', 'D-503', '--reason=Changed their mind'));
  assert(run('the CR-V is back in stock', L('stock')).find((v) => v.stock_no === '24202').status === 'in_stock', 'cancel frees the car');
  refused('lost without a reason', L('lost', 'L-1021'), /reason/);
  run('lost', L('lost', 'L-1021', '--reason=Bought privately'));

  // ---- consent and privacy
  run('unsubscribe', L('unsubscribe', 'C-0110'));
  refused('consent again after an unsubscribe', L('consent', 'C-0111', 'express', '--source=x'), /unsubscribed/);
  run('consent recorded', L('consent', 'C-0129', 'express', '--source=Said yes at the yard'));
  const dry = run('anonymise dry run', L('anonymise'));
  assert(dry.dry_run && dry.contacts.length === 2, 'two left after Gary came back');
  run('anonymise', L('anonymise', '--yes'));
  const comp2 = counts(run('compliance after fixes', L('compliance')));
  assert(comp2.unsubscribe === 1 && comp2.ppsr === 0 && comp2.credit === 0 && comp2.retention === 0 && comp2.licence === 1 && comp2.cash === 1, `compliance after ${JSON.stringify(comp2)}`);
  run('away', L('away', 'S05', '--until=+3'));
  const nt = run('new Tauranga lead skips the away salesperson', L('new', '--name=Aria Lam', '--email=aria@example.com', '--source=WEB', '--site=TGA'));
  assert(nt.assigned_to === 'S06', 'Daniel gets it while Mele is away');
  run('back from leave', L('away', 'S05', '--back'));
  run('add a source', L('source-add', 'DRV', '--name=Driven', '--kind=portal', '--spend=450'));

  // ---- import from AutoPlay (or any lead spreadsheet)
  const scsv = path.join(dataDir, 'stock.csv');
  writeFileSync(scsv, ['Stock No,Rego,Year,Make,Model,Odometer,Price,Site,Status', '25001,NEW001,2023,Toyota,Yaris,"12,400","$24,990",Hamilton,In stock', '25002,NEW002,2020,Holden,Colorado,88000,31990,TGA,Sold', ',X,2020,,,,,,'].join('\r\n'));
  const si = run('import stock', L('import', 'stock', scsv));
  assert(si.created === 2 && si.problems.length === 1, `stock in (${JSON.stringify(si)})`);
  assert(run('import stock again', L('import', 'stock', scsv)).updated === 2, 'stock idempotent');
  const lcsv = path.join(dataDir, 'leads.csv');
  writeFileSync(lcsv, ['Lead ID,Date,First Name,Last Name,Mobile,Email,Source,Stock No,Salesperson,Status,Notes',
    'AP-9001,12/10/2026 09:15,Kiri,Tane,021 300 9001,kiri@example.com,Trade Me Motors,25001,Ben Carter,In progress,Asked about the Yaris',
    'AP-9002,13/10/2026 14:40,Josie,Ford,,josie@example.com,Website,,Priya Nair,Lost,',
    'AP-9003,14/10/2026,Matt,Lowe,021 300 9003,,Carsales,,,New,',
    'AP-9004,15/10/2026,No,Contact,,,Website,,,New,'].join('\n'));
  const dl = run('import leads dry run', L('import', 'leads', lcsv, '--dry-run'));
  assert(dl.created === 2 && dl.problems.length === 2 && dl.dry_run, `dry run (${JSON.stringify(dl)})`);
  assert(run('dry run wrote nothing', L('leads', '--all')).length === 33, 'nothing written');
  const il = run('import leads', L('import', 'leads', lcsv));
  assert(il.created === 2, 'two leads in');
  assert(run('import leads again', L('import', 'leads', lcsv)).skipped_existing === 2, 'leads idempotent');
  const imp = run('the imported lead', L('lead', 'AP-9001'));
  assert(imp.lead.stage === 'contacted' && imp.lead.salesperson_code === 'S02' && imp.lead.stock_no === '25001', 'mapped stage, salesperson and car');

  // ---- export, views, documents
  const exp = run('export', L('export', `--out=${path.join(dataDir, 'export')}`));
  assert(exp.counts.leads === 35 && existsSync(path.join(dataDir, 'export', 'activities.csv')), 'export writes every table');
  run('views', ['view.mjs'], { json: false });
  assert(readdirSync(path.join(outDir, 'views')).length === 3, 'three views');
  run('documents', ['docs.mjs'], { json: false });
  assert(readdirSync(path.join(outDir, 'docs-out', 'test-drive-record')).length === 5, 'a record for every test drive');
  assert(readdirSync(path.join(outDir, 'docs-out', 'deal-summary')).every((f) => !/[|:<>"?*]/.test(f)), 'file names are safe on Windows');
  run('help', ['leads.mjs', 'help'], { json: false });
  run('unknown command exits 1', ['leads.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\nPASS: ${step} steps`);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
