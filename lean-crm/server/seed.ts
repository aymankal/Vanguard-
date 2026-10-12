import { db } from './db.js';

export const DEFAULT_STAGES = ['New', 'Contacted', 'Meeting', 'Proposal', 'Won', 'Lost'];

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const ts = (offset: number, hour = 10) => `${day(offset)} ${String(hour).padStart(2, '0')}:00:00`;

const companies = [
  ['Acme Logistics', 'acmelogistics.com', 'Logistics', '201-500', 'Freight forwarding across EMEA. Expanding into last-mile.'],
  ['Northwind Health', 'northwindhealth.io', 'Healthcare', '51-200', 'Telehealth platform. Support team overloaded after Series B.'],
  ['Brightline Fintech', 'brightline.finance', 'Fintech', '11-50', 'SME lending app. Founder-led sales today.'],
  ['Cedar & Stone', 'cedarstone.co', 'Real Estate', '51-200', 'Commercial property management, Gulf region.'],
  ['Pixelforge Studios', 'pixelforge.gg', 'Gaming', '201-500', 'Mobile games. Needs multilingual player support.'],
  ['Helios Solar', 'heliossolar.energy', 'Energy', '501-1000', 'Residential solar installer. Big outbound push planned for Q1.'],
  ['Atlas Insurance', 'atlas-ins.com', 'Insurance', '1000+', 'Legacy insurer modernising claims intake.'],
  ['Kinetic SaaS', 'kineticapp.com', 'Software', '11-50', 'Product analytics SaaS. Wants an SDR pod for US mid-market.'],
  ['Oasis Hospitality', 'oasishotels.com', 'Hospitality', '501-1000', 'Hotel group, 14 properties. Reservations support.'],
  ['Meridian Retail', 'meridianretail.com', 'Retail', '201-500', 'Omnichannel fashion retailer. Peak season support.'],
];

// [name, email, phone, title, companyIndex, owner]
const contacts: [string, string, string, string, number, string][] = [
  ['Sara Haddad', 'sara@acmelogistics.com', '+961 3 112 233', 'VP Operations', 0, 'Ayman'],
  ['Tom Becker', 'tom.becker@acmelogistics.com', '+49 151 2233 4455', 'Head of Sales', 0, 'Ayman'],
  ['Priya Nair', 'priya@northwindhealth.io', '+1 415 555 0142', 'Director of Support', 1, 'Lina'],
  ['James Okafor', 'james@northwindhealth.io', '+1 415 555 0199', 'COO', 1, 'Lina'],
  ['Maya Chen', 'maya@brightline.finance', '+44 20 7946 0011', 'Founder & CEO', 2, 'Ayman'],
  ['Omar Khalil', 'omar@cedarstone.co', '+971 50 123 4567', 'Managing Director', 3, 'Karim'],
  ['Lea Fontaine', 'lea@cedarstone.co', '+971 50 765 4321', 'Head of Tenant Experience', 3, 'Karim'],
  ['Daniel Kim', 'dkim@pixelforge.gg', '+82 10 5555 0101', 'Head of Player Support', 4, 'Lina'],
  ['Sofia Rossi', 'sofia@pixelforge.gg', '+39 333 123 4567', 'CX Lead', 4, 'Lina'],
  ['Rami Aoun', 'rami@heliossolar.energy', '+1 512 555 0177', 'VP Sales', 5, 'Ayman'],
  ['Hannah Weiss', 'hannah@heliossolar.energy', '+1 512 555 0123', 'Sales Ops Manager', 5, 'Ayman'],
  ['George Mills', 'gmills@atlas-ins.com', '+44 161 555 0100', 'Claims Director', 6, 'Karim'],
  ['Nadia Farah', 'nfarah@atlas-ins.com', '+44 161 555 0133', 'Procurement Lead', 6, 'Karim'],
  ['Alex Turner', 'alex@kineticapp.com', '+1 646 555 0188', 'CRO', 7, 'Ayman'],
  ['Jess Park', 'jess@kineticapp.com', '+1 646 555 0110', 'Growth Manager', 7, 'Ayman'],
  ['Karim Saleh', 'ksaleh@oasishotels.com', '+961 71 555 010', 'Director of Reservations', 8, 'Lina'],
  ['Elena Petrova', 'epetrova@oasishotels.com', '+961 71 555 020', 'GM, Beirut', 8, 'Lina'],
  ['Chris Adams', 'cadams@meridianretail.com', '+1 312 555 0155', 'VP Customer Experience', 9, 'Karim'],
  ['Laila Mansour', 'laila@meridianretail.com', '+1 312 555 0166', 'E-commerce Director', 9, 'Karim'],
  ['Ben Foster', 'ben@brightline.finance', '+44 20 7946 0022', 'Head of Growth', 2, 'Ayman'],
];

// [title, value, stage, companyIdx, contactIdx, closeOffsetDays, createdOffset]
const deals: [string, number, string, number, number, number, number][] = [
  ['Acme — 6-seat SDR pod', 15000, 'Proposal', 0, 0, 10, -30],
  ['Northwind — Tier 1 support team', 42000, 'Meeting', 1, 2, 25, -20],
  ['Brightline — outbound pilot', 8000, 'Contacted', 2, 4, 40, -12],
  ['Cedar & Stone — tenant hotline', 24000, 'Proposal', 3, 5, 6, -40],
  ['Pixelforge — multilingual support', 36000, 'Meeting', 4, 7, 18, -25],
  ['Helios — Q1 appointment setting', 54000, 'New', 5, 9, 60, -3],
  ['Atlas — claims intake BPO', 120000, 'Contacted', 6, 11, 75, -35],
  ['Kinetic — US mid-market SDR pod', 30000, 'Won', 7, 13, -5, -50],
  ['Oasis — reservations desk', 27000, 'Proposal', 8, 15, 3, -28],
  ['Meridian — peak season support', 18000, 'Lost', 9, 17, -10, -45],
  ['Helios — inbound qualification', 12000, 'Meeting', 5, 10, 22, -15],
  ['Northwind — after-hours coverage', 16000, 'New', 1, 3, 45, -2],
];

export function seedIfEmpty() {
  const hasStages = (db.prepare('SELECT COUNT(*) n FROM stages').get() as { n: number }).n > 0;
  if (!hasStages) {
    const ins = db.prepare('INSERT INTO stages (name, position) VALUES (?, ?)');
    DEFAULT_STAGES.forEach((s, i) => ins.run(s, i));
  }
  const hasData = (db.prepare('SELECT COUNT(*) n FROM companies').get() as { n: number }).n > 0;
  if (hasData) return;

  const stageId = (name: string) => (db.prepare('SELECT id FROM stages WHERE name = ?').get(name) as { id: number }).id;

  db.transaction(() => {
    const coIds = companies.map(
      ([name, website, industry, size, notes]) =>
        db.prepare('INSERT INTO companies (name, website, industry, size, notes, created_at) VALUES (?,?,?,?,?,?)')
          .run(name, website, industry, size, notes, ts(-60)).lastInsertRowid as number,
    );
    const ctIds = contacts.map(
      ([name, email, phone, title, co, owner]) =>
        db.prepare('INSERT INTO contacts (name, email, phone, title, company_id, owner, created_at) VALUES (?,?,?,?,?,?,?)')
          .run(name, email, phone, title, coIds[co], owner, ts(-55)).lastInsertRowid as number,
    );
    const dealIds = deals.map(
      ([title, value, stage, co, ct, close, created]) =>
        db.prepare('INSERT INTO deals (title, value, stage_id, company_id, contact_id, close_date, created_at) VALUES (?,?,?,?,?,?,?)')
          .run(title, value, stageId(stage), coIds[co], ctIds[ct], day(close), ts(created)).lastInsertRowid as number,
    );

    const act = db.prepare('INSERT INTO activities (type, body, contact_id, company_id, deal_id, created_at) VALUES (?,?,?,?,?,?)');
    const dealAct = (d: number, type: string, body: string, offset: number) => {
      const [, , , co, ct] = deals[d];
      act.run(type, body, ctIds[ct], coIds[co], dealIds[d], ts(offset, 9 + (Math.abs(offset) % 8)));
    };
    // Recent, healthy activity
    dealAct(0, 'email', 'Sent proposal v2: 6 SDRs, 1 team lead, $15k/month. Sara to review with CFO.', -2);
    dealAct(0, 'stage_change', 'Stage: Meeting → Proposal', -2);
    dealAct(0, 'note', 'Discovery call. Pain: inbound leads go cold in 48h. Want EMEA coverage in EN/DE/AR.', -9);
    dealAct(1, 'note', 'Priya wants a pilot with 5 agents before committing to 20. Budget approved for Q4.', -3);
    dealAct(1, 'stage_change', 'Stage: Contacted → Meeting', -4);
    dealAct(4, 'email', 'Shared CSAT case study from a gaming client. Daniel forwarding to Sofia.', -1);
    dealAct(5, 'note', 'Inbound from website. Rami wants 3,000 booked appointments in Q1.', -1);
    dealAct(7, 'stage_change', 'Stage: Proposal → Won', -5);
    dealAct(7, 'note', 'Signed 12-month MSA. Onboarding kickoff next Monday.', -5);
    dealAct(10, 'email', 'Sent qualification script draft to Hannah.', -4);
    dealAct(11, 'note', 'James asked about weekend + night coverage for US time zones.', -1);
    // Stale deals (no activity in 7+ days) so Today has work
    dealAct(2, 'email', 'Intro email: outbound pilot, 2 SDRs for 60 days.', -11);
    dealAct(3, 'note', 'Omar liked the pricing. Waiting on legal review of SLA terms.', -14);
    dealAct(6, 'note', 'George is building internal case. Procurement (Nadia) to join next call.', -18);
    dealAct(8, 'email', 'Proposal sent: 8 agents, AR/EN/FR, 24/7.', -9);
    dealAct(9, 'stage_change', 'Stage: Proposal → Lost', -10);
    dealAct(9, 'note', 'Lost on price to an in-house hire. Revisit before next peak season.', -10);
    // Company-level and contact-level notes
    act.run('note', 'Met Maya at Beirut Fintech Week. Warm intro via Ben.', ctIds[4], coIds[2], null, ts(-20));
    act.run('note', 'Laila mentioned replatforming to Shopify Plus in spring.', ctIds[18], coIds[9], null, ts(-30));

    const task = db.prepare('INSERT INTO tasks (title, due_date, contact_id, deal_id, done, created_at) VALUES (?,?,?,?,?,?)');
    task.run('Follow up with Sara on CFO review', day(-1), ctIds[0], dealIds[0], 0, ts(-2));
    task.run('Chase Cedar & Stone legal on SLA', day(-3), ctIds[5], dealIds[3], 0, ts(-10));
    task.run('Send Oasis revised staffing plan', day(0), ctIds[15], dealIds[8], 0, ts(-5));
    task.run('Prep pilot scope for Northwind', day(0), ctIds[2], dealIds[1], 0, ts(-3));
    task.run('Book discovery call with Helios', day(1), ctIds[9], dealIds[5], 0, ts(-1));
    task.run('Send Atlas security questionnaire', day(4), ctIds[12], dealIds[6], 0, ts(-6));
    task.run('Check in with Maya re: pilot', day(2), ctIds[4], dealIds[2], 0, ts(-4));
    task.run('Kickoff deck for Kinetic onboarding', day(-6), ctIds[13], dealIds[7], 1, ts(-6));
  })();
}
