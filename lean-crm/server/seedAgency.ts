// Agency Mode demo: 3 clients, 4 reps, 6 weeks of realistic outbound activity.
// Writes to data/demo.db (recreated each run) so your real database is never touched.
//   npm run demo          → seed + start the app on the demo database
import fs from 'node:fs';

const DEMO = new URL('../data/demo.db', import.meta.url).pathname;
process.env.DB_PATH ??= DEMO;
if (process.env.DB_PATH === DEMO) for (const f of [DEMO, `${DEMO}-wal`, `${DEMO}-shm`]) fs.rmSync(f, { force: true });

const { db, setSetting } = await import('./db.js');
const { seedIfEmpty } = await import('./seed.js');
const { hashPassword } = await import('./auth.js');
const { generateReport, dueWeek } = await import('./reports.js');
const { addDays, weekStart, range } = await import('./tz.js');
const { reportTz } = await import('./metrics.js');

if ((db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n) {
  console.error('This database already has users. The agency demo seed only runs on a fresh demo database.');
  process.exit(1);
}

// Deterministic randomness so numbers are reproducible.
let seed = 20261012;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;

const NOW = new Date();
const TZ = 'Asia/Beirut';
const ts = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
/** Local Beirut wall time on a given local date → Date (UTC). Beirut is UTC+3 all year. */
const at = (date: string, h: number, m: number) => new Date(Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`));

seedIfEmpty();
setSetting('agency_mode', '1');
setSetting('report_timezone', TZ);
db.prepare("UPDATE clients SET status = 'paused' WHERE id = 1").run(); // keep the single-user sample out of the agency demo

const PASSWORD = hashPassword('demo1234');
const user = (email: string, name: string, role: string, clientId: number | null = null) =>
  db.prepare('INSERT INTO users (email, name, role, client_id, password_hash) VALUES (?,?,?,?,?)').run(email, name, role, clientId, PASSWORD).lastInsertRowid as number;

const CLIENTS = [
  { name: 'Helix Payments', email: 'growth@helixpayments.example', start: '2026-06-01', profile: 'healthy',
    industry: ['Fintech', 'E-commerce', 'Marketplaces', 'Travel'], login: 'client@helixpayments.example' },
  { name: 'Northstar Freight', email: 'sales@northstarfreight.example', start: '2026-06-15', profile: 'stalling',
    industry: ['Manufacturing', 'Retail', 'Wholesale', 'Food & Beverage'], login: 'client@northstarfreight.example' },
  { name: 'Bloom Dental Group', email: 'ops@bloomdental.example', start: '2026-07-20', profile: 'dark',
    industry: ['Dental clinics', 'Orthodontics', 'Healthcare'], login: 'client@bloomdental.example' },
];

const ownerId = user('owner@demo.agency', 'Nour Haddad', 'owner');
const reps = {
  rana: user('rana@demo.agency', 'Rana Saab', 'rep'),
  karim: user('karim@demo.agency', 'Karim Aoun', 'rep'),
  lina: user('lina@demo.agency', 'Lina Farah', 'rep'),
  omar: user('omar@demo.agency', 'Omar Daher', 'rep'),
};
void ownerId;

const FIRST = ['Sara', 'Tom', 'Priya', 'James', 'Maya', 'Omar', 'Lea', 'Daniel', 'Sofia', 'Rami', 'Hannah', 'George', 'Nadia', 'Alex', 'Jess', 'Elena', 'Chris', 'Laila', 'Ben', 'Mia', 'Yusuf', 'Ines', 'Marco', 'Aisha', 'Felix', 'Zoe', 'Hugo', 'Dana'];
const LAST = ['Haddad', 'Becker', 'Nair', 'Okafor', 'Chen', 'Khalil', 'Fontaine', 'Kim', 'Rossi', 'Aoun', 'Weiss', 'Mills', 'Farah', 'Turner', 'Park', 'Petrova', 'Adams', 'Mansour', 'Foster', 'Novak', 'Demir', 'Silva'];
const TITLES = ['Head of Operations', 'VP Sales', 'CFO', 'COO', 'Head of Procurement', 'Practice Manager', 'Founder', 'Director of Finance', 'Head of Logistics'];
const CO_A = ['Orbit', 'Kestrel', 'Lumen', 'Atlas', 'Nimbus', 'Vertex', 'Cobalt', 'Harbor', 'Summit', 'Juniper', 'Quarry', 'Beacon', 'Meridian', 'Polar'];
const CO_B = ['Labs', 'Group', 'Holdings', 'Co', 'Partners', 'Systems', 'Brands', 'Works'];
const stageId = (n: string) => (db.prepare('SELECT id FROM stages WHERE name = ?').get(n) as { id: number }).id;

const assignments: [number, number][] = [];
const insAct = db.prepare(`INSERT INTO activities (client_id, user_id, type, body, contact_id, company_id, deal_id, meeting_at, meeting_status, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
const BODY: Record<string, string> = { call_connected: 'Call — connected', call_no_answer: 'Call — no answer', call_voicemail: 'Call — left voicemail', email: 'Email sent', linkedin: 'LinkedIn message' };

db.transaction(() => {
  CLIENTS.forEach((c, ci) => {
    const clientId = db.prepare('INSERT INTO clients (name, contact_email, status, start_date) VALUES (?,?,?,?)').run(c.name, c.email, 'active', c.start).lastInsertRowid as number;
    user(c.login, `${c.name} team`, 'client', clientId);
    const team = [[reps.rana, reps.karim], [reps.rana, reps.lina], [reps.lina, reps.omar]][ci];
    team.forEach((r) => { db.prepare('INSERT INTO user_clients (user_id, client_id) VALUES (?,?)').run(r, clientId); assignments.push([r, clientId]); });

    // Prospects
    const prospects: { contact: number; company: number; name: string }[] = [];
    const usedCo = new Set<string>();
    for (let i = 0; i < 14; i++) {
      let coName: string;
      do coName = `${pick(CO_A)} ${pick(CO_B)}`; while (usedCo.has(coName));
      usedCo.add(coName);
      const companyId = db.prepare("INSERT INTO companies (client_id, name, website, industry, size, created_at) VALUES (?,?,?,?,?,datetime('now','-50 days'))")
        .run(clientId, coName, `${coName.toLowerCase().replace(/\W+/g, '')}.example`, pick(c.industry), pick(['11-50', '51-200', '201-500', '501-1000'])).lastInsertRowid as number;
      for (let k = 0; k < int(2, 3); k++) {
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        const contactId = db.prepare("INSERT INTO contacts (client_id, name, email, phone, title, company_id, owner, created_at) VALUES (?,?,?,?,?,?,?,datetime('now','-50 days'))")
          .run(clientId, name, `${name.split(' ')[0].toLowerCase()}@${coName.toLowerCase().replace(/\W+/g, '')}.example`, `+1 555 01${int(10, 99)}`, pick(TITLES), companyId, '').lastInsertRowid as number;
        prospects.push({ contact: contactId, company: companyId, name });
      }
    }

    // 6 weeks of weekdays, oldest first
    const today = new Date(NOW.getTime() + 3 * 3600000).toISOString().slice(0, 10);
    for (let back = 42; back >= 0; back--) {
      const date = addDays(today, -back);
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      if (dow === 0 || dow === 6) continue;
      if (c.profile === 'dark' && back < 4) continue;        // nothing logged for the last few days
      const slowdown = c.profile === 'stalling' && back < 7 ? 0.45 : c.profile === 'dark' && back < 7 ? 0.7 : 1;
      for (const rep of team) {
        const shared = assignments.filter(([r]) => r === rep).length; // reps split time across clients
        const calls = Math.round((int(22, 34) / shared) * slowdown);
        const emails = Math.round((int(12, 20) / shared) * slowdown);
        const linkedin = Math.round((int(4, 9) / shared) * slowdown);
        const events: [string, number][] = [];
        for (let i = 0; i < calls; i++) events.push([chance(c.profile === 'stalling' ? 0.11 : 0.19) ? 'call_connected' : chance(0.6) ? 'call_no_answer' : 'call_voicemail', 0]);
        for (let i = 0; i < emails; i++) events.push(['email', 0]);
        for (let i = 0; i < linkedin; i++) events.push(['linkedin', 0]);
        for (const [type] of events) {
          const when = at(date, int(9, 16), int(0, 59));
          if (when > NOW) continue;
          const p = pick(prospects);
          insAct.run(clientId, rep, type, BODY[type], p.contact, p.company, null, null, null, ts(when));
          // Some connected calls turn into meetings (none for the stalling client in the last 2 weeks)
          const meetingOdds = c.profile === 'stalling' ? (back < 15 ? 0 : 0.18) : 0.16;
          if (type === 'call_connected' && chance(meetingOdds)) {
            const meetDate = addDays(date, int(2, 6));
            const meetDow = new Date(meetDate + 'T00:00:00Z').getUTCDay();
            const meetingAt = `${dow === 0 || meetDow === 0 ? addDays(meetDate, 1) : meetDow === 6 ? addDays(meetDate, 2) : meetDate} ${pick(['10:00', '11:30', '14:00', '15:30'])}`;
            const past = at(meetingAt.slice(0, 10), Number(meetingAt.slice(11, 13)), 0) < NOW;
            const status = past ? (chance(0.75) ? 'held' : chance(0.6) ? 'no_show' : 'cancelled') : 'booked';
            const booked = new Date(when.getTime() + 5 * 60000);
            if (booked > NOW) continue;
            let dealId: number | null = null;
            if (chance(0.6)) {
              const co = db.prepare('SELECT name FROM companies WHERE id = ?').get(p.company) as { name: string };
              dealId = db.prepare('INSERT INTO deals (client_id, title, value, stage_id, company_id, contact_id, close_date, created_at) VALUES (?,?,?,?,?,?,?,?)')
                .run(clientId, `${co.name} — ${pick(['pilot', 'annual plan', 'rollout', 'expansion'])}`, int(8, 60) * 1000, stageId('Meeting'), p.company, p.contact,
                  addDays(date, int(20, 60)), ts(booked)).lastInsertRowid as number;
            }
            insAct.run(clientId, rep, 'meeting_booked', `Meeting booked with ${p.name}`, p.contact, p.company, dealId, meetingAt, status, ts(booked));
            // Held meetings move deals forward over the following days
            if (dealId && status === 'held') {
              const step = (from: string, to: string, days: number) => {
                const t = at(addDays(meetingAt.slice(0, 10), days), 12, 0);
                if (t > NOW) return false;
                db.prepare('UPDATE deals SET stage_id = ? WHERE id = ?').run(stageId(to), dealId);
                insAct.run(clientId, rep, 'stage_change', `Stage: ${from} → ${to}`, p.contact, p.company, dealId, null, null, ts(t));
                return true;
              };
              if (chance(0.55) && step('Meeting', 'Proposal', int(1, 3))) {
                if (chance(0.35)) step('Proposal', 'Won', int(5, 10));
                else if (chance(0.2)) step('Proposal', 'Lost', int(5, 10));
              }
            }
          }
        }
      }
    }
  });
})();

// Past weekly reports, already sent, so the portal has history. Last week is left for the scheduler
// (it drafts it on server start, with Claude if a key is set) and the owner reviews and sends it.
const tz = reportTz();
const due = dueWeek(NOW, tz);
const clients = db.prepare("SELECT id, start_date FROM clients WHERE status = 'active'").all() as { id: number; start_date: string }[];
for (const c of clients) {
  for (let w = 1; w <= 4; w++) {
    const week = addDays(due, -7 * w);
    if (week < weekStart(new Date(c.start_date + 'T12:00:00Z'), tz)) continue;
    const id = await generateReport(c.id, week, { ai: false });
    const [sentAt] = range(addDays(week, 7), addDays(week, 7), tz);
    db.prepare("UPDATE weekly_reports SET status = 'sent', sent_at = datetime(?, '+8 hours', '+20 minutes'), sent_to = (SELECT contact_email FROM clients WHERE id = ?) WHERE id = ?")
      .run(sentAt, c.id, id);
  }
}

const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
console.log(`Agency demo ready in ${process.env.DB_PATH}
  ${n("SELECT COUNT(*) n FROM clients WHERE status = 'active'")} clients · ${n("SELECT COUNT(*) n FROM users WHERE role = 'rep'")} reps · ${n('SELECT COUNT(*) n FROM activities WHERE user_id IS NOT NULL')} activities · ${n('SELECT COUNT(*) n FROM deals WHERE client_id > 1')} deals · ${n('SELECT COUNT(*) n FROM weekly_reports')} sent reports

  Sign in (password demo1234):
    owner@demo.agency            Owner
    rana@demo.agency             Rep (Helix Payments, Northstar Freight)
    karim@demo.agency            Rep (Helix Payments)
    lina@demo.agency             Rep (Northstar Freight, Bloom Dental Group)
    omar@demo.agency             Rep (Bloom Dental Group)
    client@helixpayments.example Client portal`);
