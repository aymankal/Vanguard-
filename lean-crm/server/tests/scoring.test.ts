// Score formula, leaderboard, report numbers, placeholder guard, timezone math and health flags.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { tempDb } from './helpers.js';

tempDb('scoring');
const { db, setSetting } = await import('../db.js');
const { SCORE, scoreOf } = await import('../agencyConfig.js');
const m = await import('../metrics.js');
const { fillPlaceholders, placeholders, dueWeek, generateReport } = await import('../reports.js');
const tz = await import('../tz.js');

describe('score formula', () => {
  test('matches the brief: call 1, connected 3, email 1, meeting 10', () => {
    assert.equal(SCORE.call_no_answer, 1);
    assert.equal(SCORE.call_voicemail, 1);
    assert.equal(SCORE.call_connected, 3);
    assert.equal(SCORE.email, 1);
    assert.equal(SCORE.meeting_booked, 10);
    assert.equal(scoreOf({ call_no_answer: 2, call_voicemail: 1, call_connected: 1, email: 3, meeting_booked: 1 }), 2 + 1 + 3 + 3 + 10);
    assert.equal(scoreOf({ note: 50, stage_change: 9 }), 0, 'notes and system events score nothing');
  });

  test('connect rate = connected / all calls', () => {
    const s = m.summarizeCounts({ call_connected: 3, call_no_answer: 5, call_voicemail: 2, email: 4 });
    assert.equal(s.calls, 10);
    assert.equal(s.connect_rate, 30);
    assert.equal(s.activities, 14);
    assert.equal(s.score, 3 * 3 + 5 + 2 + 4);
    assert.equal(m.summarizeCounts({}).connect_rate, 0);
  });
});

describe('timezone', () => {
  test('Beirut week starts Monday local and converts to UTC', () => {
    // 2026-10-12 is a Monday. 23:30 UTC Sunday = 02:30 Monday in Beirut (UTC+3).
    assert.equal(tz.weekStart(new Date('2026-10-11T23:30:00Z'), 'Asia/Beirut'), '2026-10-12');
    assert.equal(tz.weekStart(new Date('2026-10-11T20:30:00Z'), 'Asia/Beirut'), '2026-10-05');
    assert.deepEqual(tz.range('2026-10-05', '2026-10-12', 'Asia/Beirut'), ['2026-10-04 21:00:00', '2026-10-11 21:00:00']);
  });
  test('report is due from Monday 08:00 local', () => {
    assert.equal(dueWeek(new Date('2026-10-12T04:59:00Z'), 'Asia/Beirut'), '2026-09-28'); // 07:59 Beirut → previous report still latest
    assert.equal(dueWeek(new Date('2026-10-12T05:00:00Z'), 'Asia/Beirut'), '2026-10-05'); // 08:00 Beirut → last week due
    assert.equal(dueWeek(new Date('2026-10-14T10:00:00Z'), 'Asia/Beirut'), '2026-10-05');
  });
});

describe('leaderboard and report numbers from a known fixture', () => {
  let client = 0, other = 0, rep1 = 0, rep2 = 0;
  // Week of 2026-10-05 (Beirut): UTC 2026-10-04 21:00 → 2026-10-11 21:00
  const NOW = new Date('2026-10-08T12:00:00Z'); // Thursday of that week

  before(() => {
    setSetting('report_timezone', 'Asia/Beirut');
    db.prepare("INSERT INTO stages (name, position) SELECT 'New', 0 WHERE NOT EXISTS (SELECT 1 FROM stages)").run();
    for (const [n, i] of [['Contacted', 1], ['Meeting', 2], ['Proposal', 3], ['Won', 4], ['Lost', 5]] as const)
      db.prepare('INSERT OR IGNORE INTO stages (name, position) VALUES (?, ?)').run(n, i);
    client = db.prepare("INSERT INTO clients (name, contact_email) VALUES ('Fixture', 'f@x.example')").run().lastInsertRowid as number;
    other = db.prepare("INSERT INTO clients (name) VALUES ('Other')").run().lastInsertRowid as number;
    rep1 = db.prepare("INSERT INTO users (email, name, role, password_hash) VALUES ('r1@x', 'Rep One', 'rep', 'x')").run().lastInsertRowid as number;
    rep2 = db.prepare("INSERT INTO users (email, name, role, password_hash) VALUES ('r2@x', 'Rep Two', 'rep', 'x')").run().lastInsertRowid as number;
    const co = db.prepare("INSERT INTO companies (client_id, name) VALUES (?, 'Prospect 360')").run(client).lastInsertRowid;
    const ct = db.prepare("INSERT INTO contacts (client_id, name, company_id) VALUES (?, 'Pat Lee', ?)").run(client, co).lastInsertRowid;
    const add = (c: number, u: number, type: string, when: string, extra: Record<string, unknown> = {}) =>
      db.prepare(`INSERT INTO activities (client_id, user_id, type, body, contact_id, company_id, deal_id, meeting_at, meeting_status, created_at)
        VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?)`).run(c, u, type, c === client ? ct : null, c === client ? co : null, extra.deal ?? null, extra.meeting_at ?? null, extra.status ?? null, when);
    // In-week (rep1): 4 calls (1 connected), 2 emails, 1 linkedin, 1 meeting
    add(client, rep1, 'call_connected', '2026-10-05 07:00:00');
    add(client, rep1, 'call_no_answer', '2026-10-05 07:10:00');
    add(client, rep1, 'call_no_answer', '2026-10-06 07:00:00');
    add(client, rep1, 'call_voicemail', '2026-10-07 07:00:00');
    add(client, rep1, 'email', '2026-10-07 08:00:00');
    add(client, rep1, 'email', '2026-10-08 08:00:00');
    add(client, rep1, 'linkedin', '2026-10-08 09:00:00');
    add(client, rep1, 'meeting_booked', '2026-10-08 09:30:00', { meeting_at: '2026-10-13 10:00', status: 'booked' });
    // In-week (rep2): 2 connected calls
    add(client, rep2, 'call_connected', '2026-10-06 10:00:00');
    add(client, rep2, 'call_connected', '2026-10-06 11:00:00');
    // Boundary checks: 20:59 UTC Sunday Oct 4 is still the previous week in Beirut; 21:00 Oct 11 is next week.
    add(client, rep1, 'email', '2026-10-04 20:59:59');
    add(client, rep1, 'email', '2026-10-11 21:00:00');
    // Another client's activity must not count for this client's report
    add(other, rep1, 'call_connected', '2026-10-06 10:00:00');
    // Notes and system events don't count
    add(client, rep1, 'note', '2026-10-06 10:00:00');
    const deal = db.prepare("INSERT INTO deals (client_id, title, value, stage_id, created_at) VALUES (?, 'Prospect 360 — pilot', 12000, (SELECT id FROM stages WHERE name='Won'), '2026-10-06 09:00:00')").run(client).lastInsertRowid;
    db.prepare("INSERT INTO deals (client_id, title, value, stage_id, created_at) VALUES (?, 'Old deal', 9999, 1, '2026-09-20 09:00:00')").run(client);
    add(client, rep1, 'stage_change', '2026-10-09 09:00:00', { deal });
    db.prepare("UPDATE activities SET body = 'Stage: Proposal → Won' WHERE type = 'stage_change'").run();
  });

  test('weekly report metrics match the fixture exactly', () => {
    const r = m.reportMetrics(client, '2026-10-05', 'Asia/Beirut');
    assert.equal(r.calls, 6);
    assert.equal(r.connected, 3);
    assert.equal(r.connect_rate, 50);
    assert.equal(r.emails, 2);
    assert.equal(r.linkedin, 1);
    assert.equal(r.meetings, 1);
    assert.equal(r.pipeline_deals, 1);
    assert.equal(r.pipeline_value, 12000);
    assert.equal(r.prev.activities, 1, 'the 20:59 UTC Sunday email belongs to the previous Beirut week');
    assert.equal(r.wins[0], 'Closed won: Prospect 360 — pilot ($12,000)');
    assert.match(r.wins[1], /^Meeting booked with Pat Lee \(Prospect 360\) for Oct 13$/);
    assert.deepEqual(r.context.meetings_next_week, ['Pat Lee (Prospect 360)']);
  });

  test('leaderboard counts per rep for the week, across the given clients only', () => {
    const lb = m.leaderboard([client], 'week', NOW);
    const one = lb.find((r) => r.name === 'Rep One')!;
    const two = lb.find((r) => r.name === 'Rep Two')!;
    assert.deepEqual({ a: one.activities, c: one.calls, k: one.connected, r: one.connect_rate, m: one.meetings, s: one.score },
      { a: 8, c: 4, k: 1, r: 25, m: 1, s: 3 + 1 + 1 + 1 + 1 + 1 + 1 + 10 });
    assert.deepEqual({ a: two.activities, c: two.calls, r: two.connect_rate, s: two.score }, { a: 2, c: 2, r: 100, s: 6 });
    assert.equal(lb[0].name, 'Rep One', 'sorted by score');
    const both = m.leaderboard([client, other], 'week', NOW).find((r) => r.name === 'Rep One')!;
    assert.equal(both.calls, 5);
  });

  test('day leaderboard only counts today (local)', () => {
    const lb = m.leaderboard([client], 'day', new Date('2026-10-06T12:00:00Z'));
    assert.equal(lb.find((r) => r.name === 'Rep Two')!.calls, 2);
    assert.equal(lb.find((r) => r.name === 'Rep One')!.calls, 1);
  });

  test('drafted report stores exactly the database numbers', async () => {
    const id = await generateReport(client, '2026-10-05', { ai: false });
    const row = db.prepare('SELECT metrics_json, summary FROM weekly_reports WHERE id = ?').get(id) as { metrics_json: string; summary: string };
    const stored = JSON.parse(row.metrics_json);
    assert.equal(stored.calls, 6);
    assert.match(row.summary, /6 calls \(50% connect rate\), sent 2 emails and 1 LinkedIn messages, and booked 1 meetings\. 1 new deals worth \$12,000/);
  });
});

describe('placeholder guard (the model can never introduce a figure)', () => {
  const values = { calls: '42', connect_rate: '18%', pipeline_value: '$45,000' };
  test('fills placeholders', () => {
    assert.equal(fillPlaceholders('{{calls}} calls at {{ connect_rate }}', values), '42 calls at 18%');
  });
  test('rejects any digit the model typed itself', () => {
    assert.throws(() => fillPlaceholders('We made 40 calls', values), /wrote the figure "40"/);
    assert.throws(() => fillPlaceholders('Roughly {{calls}} calls, about 3 meetings', values), /"3"/);
    assert.throws(() => fillPlaceholders('Pipeline grew 1.5x', values), /1\.5/);
  });
  test('rejects unknown placeholders', () => {
    assert.throws(() => fillPlaceholders('{{revenue}} closed', values), /unknown placeholder/);
  });
  test('allows digits that are part of names we supplied', () => {
    assert.equal(fillPlaceholders('Follow up with Prospect 360.', values, ['Prospect 360']), 'Follow up with Prospect 360.');
  });
  test('every placeholder value comes from the metrics object', () => {
    const r = m.reportMetrics(1, '2026-10-05', 'Asia/Beirut');
    const p = placeholders(r);
    assert.equal(p.calls, String(r.calls));
    assert.equal(p.connect_rate, `${r.connect_rate}%`);
    assert.equal(p.meetings, String(r.meetings));
  });
});

describe('health flags', () => {
  test('activity drop, no meetings, no activity', () => {
    const c = db.prepare("INSERT INTO clients (name) VALUES ('Health')").run().lastInsertRowid as number;
    const now = new Date('2026-10-12T12:00:00Z');
    const add = (type: string, daysAgo: number, n = 1) => {
      for (let i = 0; i < n; i++)
        db.prepare('INSERT INTO activities (client_id, type, body, created_at) VALUES (?, ?, ?, ?)').run(c, type, '', tz.sqlTs(new Date(now.getTime() - daysAgo * 86400000)));
    };
    add('call_no_answer', 10, 10); // previous 7 days: 10
    add('call_no_answer', 5, 6);   // last 7 days: 6 → -40%
    let flags = m.healthFlags(c, now).map((f) => f.kind);
    assert.deepEqual(flags, ['activity_drop', 'no_meetings', 'no_activity']);
    add('call_no_answer', 1, 1);   // 7 vs 10 = -30% → still flagged (30%+), activity now recent
    add('meeting_booked', 13);
    flags = m.healthFlags(c, now).map((f) => f.kind);
    assert.deepEqual(flags, ['activity_drop']);
    add('email', 2, 1);            // 8 vs 10 = -20% → healthy
    assert.deepEqual(m.healthFlags(c, now), []);
  });
});
