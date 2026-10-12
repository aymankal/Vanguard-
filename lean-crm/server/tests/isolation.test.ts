// Proves client data isolation at the query layer: through the real HTTP app and directly against
// the data functions. A client or rep must never read or touch another client's records.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tempDb } from './helpers.js';

tempDb('isolation');
const { db, setSetting } = await import('../db.js');
const { createApp } = await import('../app.js');
const { hashPassword } = await import('../auth.js');
const repo = await import('../repo.js');
const store = await import('../store.js');
const { runReadTool, applyActions } = await import('../aiTools.js');
const { seedIfEmpty } = await import('../seed.js');

const METRICS = JSON.stringify({ week_start: '2026-09-28', week_end: '2026-10-04', timezone: 'Asia/Beirut', calls: 10, connected: 2, connect_rate: 20,
  emails: 5, linkedin: 1, meetings: 1, activities: 17, pipeline_deals: 1, pipeline_value: 5000, prev: {}, wins: [], context: { stale_deals: [], meetings_next_week: [] } });
let server: Server;
let base = '';
const ids: Record<string, number> = {};

function seedClient(name: string) {
  const c = db.prepare("INSERT INTO clients (name, contact_email, status, start_date) VALUES (?, ?, 'active', '2026-01-01')").run(name, `${name}@x.example`).lastInsertRowid as number;
  const co = db.prepare('INSERT INTO companies (client_id, name) VALUES (?, ?)').run(c, `${name} Prospect Co`).lastInsertRowid as number;
  const ct = db.prepare('INSERT INTO contacts (client_id, name, company_id, email) VALUES (?, ?, ?, ?)').run(c, `${name} Person`, co, `${name}@p.example`).lastInsertRowid as number;
  const deal = db.prepare('INSERT INTO deals (client_id, title, value, stage_id, company_id, contact_id) VALUES (?, ?, 5000, 1, ?, ?)').run(c, `${name} Secret Deal`, co, ct).lastInsertRowid as number;
  const task = db.prepare('INSERT INTO tasks (client_id, title, contact_id, deal_id, due_date) VALUES (?, ?, ?, ?, date())').run(c, `${name} task`, ct, deal).lastInsertRowid as number;
  const act = db.prepare("INSERT INTO activities (client_id, type, body, contact_id, company_id, deal_id) VALUES (?, 'call_connected', ?, ?, ?, ?)").run(c, `${name} call notes`, ct, co, deal).lastInsertRowid as number;
  const rep = db.prepare("INSERT INTO weekly_reports (client_id, week_start, week_end, metrics_json, summary, status) VALUES (?, '2026-09-28', '2026-10-04', ?, ?, 'sent')").run(c, METRICS, `${name} report`).lastInsertRowid as number;
  Object.assign(ids, { [`${name}`]: c, [`${name}_co`]: co, [`${name}_ct`]: ct, [`${name}_deal`]: deal, [`${name}_task`]: task, [`${name}_act`]: act, [`${name}_report`]: rep });
}
const user = (email: string, role: string, clientId: number | null = null) =>
  db.prepare('INSERT INTO users (email, name, role, client_id, password_hash) VALUES (?, ?, ?, ?, ?)').run(email, email, role, clientId, hashPassword('password123')).lastInsertRowid as number;

before(async () => {
  seedIfEmpty(); // client 1 = single-user sample data
  seedClient('Alpha');
  seedClient('Bravo');
  user('owner@t.example', 'owner');
  const rep = user('rep@t.example', 'rep');
  db.prepare('INSERT INTO user_clients (user_id, client_id) VALUES (?, ?)').run(rep, ids.Alpha);
  user('alpha@t.example', 'client', ids.Alpha);
  user('bravo@t.example', 'client', ids.Bravo);
  setSetting('agency_mode', '1');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function login(email: string) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  assert.equal(r.status, 200, `login ${email}`);
  return r.headers.get('set-cookie')!.split(';')[0];
}
function as(cookie: string | null, clientId?: number) {
  return async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    if (clientId) headers['x-client-id'] = String(clientId);
    const r = await fetch(`${base}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* binary (PDF) */ }
    return { status: r.status, text, json };
  };
}
const leaks = (text: string) => /Bravo/.test(text);

describe('unauthenticated', () => {
  test('every data route needs a session in Agency Mode', async () => {
    const anon = as(null);
    for (const p of ['/contacts', '/companies', '/deals', '/today', '/portal', '/agency/overview', '/stages', `/contacts/${ids.Alpha_ct}`]) {
      assert.equal((await anon('GET', p)).status, 401, p);
    }
    assert.equal((await anon('POST', '/ai/chat', { messages: [{ role: 'user', content: 'hi' }] })).status, 401);
  });
});

describe('rep assigned to Alpha only', () => {
  let call: ReturnType<typeof as>;
  let callBravo: ReturnType<typeof as>;
  before(async () => {
    const c = await login('rep@t.example');
    call = as(c, ids.Alpha);
    callBravo = as(c, ids.Bravo);
  });

  test('cannot open the Bravo workspace', async () => {
    for (const p of ['/contacts', '/companies', '/deals', '/today', '/search?q=a']) assert.equal((await callBravo('GET', p)).status, 403, p);
  });

  test('lists in Alpha contain no Bravo data', async () => {
    for (const p of ['/contacts', '/companies', '/deals', '/today', '/search?q=e', '/search?q=Bravo']) {
      const r = await call('GET', p);
      assert.equal(r.status, 200, p);
      assert.ok(!leaks(r.text), `${p} leaked Bravo data: ${r.text.slice(0, 200)}`);
    }
    assert.ok((await call('GET', '/contacts')).text.includes('Alpha Person'));
  });

  test('cannot read Bravo records by id', async () => {
    for (const p of [`/contacts/${ids.Bravo_ct}`, `/companies/${ids.Bravo_co}`, `/deals/${ids.Bravo_deal}`, `/ai/nba/${ids.Bravo_deal}`]) {
      const r = await call('GET', p);
      assert.ok(r.status >= 400, `${p} returned ${r.status}`);
      assert.ok(!leaks(r.text), p);
    }
  });

  test('cannot change or delete Bravo records', async () => {
    assert.ok((await call('PATCH', `/contacts/${ids.Bravo_ct}`, { name: 'hacked' })).status >= 400);
    assert.ok((await call('PATCH', `/deals/${ids.Bravo_deal}`, { stage_id: 2, value: 1 })).status >= 400);
    assert.ok((await call('PATCH', `/tasks/${ids.Bravo_task}`, { done: true })).status >= 400);
    assert.ok((await call('PATCH', `/activities/${ids.Bravo_act}`, { meeting_status: 'held' })).status >= 400);
    assert.ok((await call('DELETE', `/deals/${ids.Bravo_deal}`)).status >= 400);
    assert.ok((await call('DELETE', `/contacts/${ids.Bravo_ct}`)).status >= 400);
    assert.ok((await call('DELETE', `/activities/${ids.Bravo_act}`)).status >= 400);
    const deal = db.prepare('SELECT title, value, stage_id FROM deals WHERE id = ?').get(ids.Bravo_deal) as { title: string; value: number; stage_id: number };
    assert.deepEqual(deal, { title: 'Bravo Secret Deal', value: 5000, stage_id: 1 });
    assert.equal((db.prepare('SELECT name FROM contacts WHERE id = ?').get(ids.Bravo_ct) as { name: string }).name, 'Bravo Person');
    assert.equal((db.prepare('SELECT done FROM tasks WHERE id = ?').get(ids.Bravo_task) as { done: number }).done, 0);
  });

  test('cannot link Alpha records to Bravo records', async () => {
    assert.equal((await call('POST', '/deals', { title: 'x', company_id: ids.Bravo_co })).status, 400);
    assert.equal((await call('POST', '/deals', { title: 'x', contact_id: ids.Bravo_ct })).status, 400);
    assert.equal((await call('POST', '/tasks', { title: 'x', deal_id: ids.Bravo_deal })).status, 400);
    assert.equal((await call('POST', '/activities', { type: 'call_connected', contact_id: ids.Bravo_ct })).status, 400);
    assert.equal((await call('PATCH', `/contacts/${ids.Alpha_ct}`, { company_id: ids.Bravo_co })).status, 400);
    assert.equal((await call('PATCH', `/deals/${ids.Alpha_deal}`, { contact_id: ids.Bravo_ct })).status, 400);
  });

  test('AI actions cannot reach Bravo', async () => {
    const r = await call('POST', '/ai/apply', { actions: [{ tool: 'update_deal_stage', input: { deal: 'Bravo Secret Deal', stage: 'Won' } }] });
    assert.equal(r.status, 400);
    assert.equal((db.prepare('SELECT stage_id FROM deals WHERE id = ?').get(ids.Bravo_deal) as { stage_id: number }).stage_id, 1);
  });

  test('no access to agency dashboard, portal, export or stage edits', async () => {
    for (const p of ['/agency/overview', '/agency/users', '/agency/clients', '/portal', '/export']) assert.equal((await call('GET', p)).status, 403, p);
    assert.equal((await call('POST', '/stages', { name: 'Hack' })).status, 403);
  });
});

describe('client user (Alpha)', () => {
  let call: ReturnType<typeof as>;
  before(async () => {
    call = as(await login('alpha@t.example'), ids.Bravo); // even asking for Bravo must not help
  });

  test('portal shows only Alpha, regardless of the client header', async () => {
    const r = await call('GET', '/portal');
    assert.equal(r.status, 200);
    assert.equal(r.json.client.name, 'Alpha');
    assert.ok(!leaks(r.text), r.text.slice(0, 300));
    assert.equal(r.json.report.summary, 'Alpha report');
  });

  test('cannot download another client’s report', async () => {
    assert.ok((await call('GET', `/portal/reports/${ids.Bravo_report}/pdf`)).status >= 400);
    assert.equal((await call('GET', `/portal/reports/${ids.Alpha_report}/pdf`)).status, 200);
  });

  test('is read-only and limited to the portal', async () => {
    for (const p of ['/contacts', '/companies', '/deals', '/today', `/contacts/${ids.Alpha_ct}`, '/agency/overview', '/stages', '/export']) {
      assert.equal((await call('GET', p)).status, 403, p);
    }
    assert.equal((await call('POST', '/contacts', { name: 'x' })).status, 403);
    assert.equal((await call('POST', '/activities', { type: 'note', body: 'x', contact_id: ids.Alpha_ct })).status, 403);
    assert.equal((await call('POST', '/ai/chat', { messages: [{ role: 'user', content: 'hi' }] })).status, 403);
  });
});

describe('client user (Bravo)', () => {
  test('sees only Bravo', async () => {
    const r = await as(await login('bravo@t.example'), ids.Alpha)('GET', '/portal');
    assert.equal(r.json.client.name, 'Bravo');
    assert.ok(!/Alpha/.test(r.text));
  });
});

describe('owner', () => {
  test('can open any workspace and see the rollup', async () => {
    const c = await login('owner@t.example');
    assert.ok((await as(c, ids.Bravo)('GET', '/contacts')).text.includes('Bravo Person'));
    assert.ok(!(await as(c, ids.Bravo)('GET', '/contacts')).text.includes('Alpha Person'));
    const o = await as(c)('GET', '/agency/overview');
    assert.equal(o.status, 200);
    assert.ok(o.text.includes('Alpha') && o.text.includes('Bravo'));
  });
});

describe('query layer (no HTTP)', () => {
  const A = { clientId: 0, userId: null, role: 'rep' as const, agency: true };
  before(() => { A.clientId = ids.Alpha; });

  test('every read function is scoped', () => {
    const outputs = [
      repo.listCompanies(A), repo.listContacts(A), repo.listDeals(A), repo.today(A, '2099-01-01'), repo.quickSearch(A, ''),
      repo.exportData(A), repo.getCompany(A, ids.Bravo_co), repo.getContact(A, ids.Bravo_ct), repo.getDeal(A, ids.Bravo_deal),
      repo.dealRow(A, ids.Bravo_deal), repo.dealTimeline(A, ids.Bravo_deal), repo.openDealTasks(A, ids.Bravo_deal),
      repo.researchSubject(A, 'company', ids.Bravo_co), repo.researchSubject(A, 'contact', ids.Bravo_ct),
      repo.companyByName(A, 'Bravo Prospect Co'), repo.contactByName(A, 'Bravo Person'), repo.dealsByTitle(A, 'Bravo'),
      ...(['contacts', 'companies', 'deals', 'tasks'] as const).map((type) => repo.searchRecords(A, { type, include_done: true })),
      runReadTool(A, 'search_records', { type: 'deals', query: 'Secret' }),
    ];
    for (const o of outputs) assert.ok(!leaks(JSON.stringify(o ?? null)), String(JSON.stringify(o)).slice(0, 200));
    // Asking for another client's account by name finds nothing (the error only echoes the query).
    assert.ok('error' in repo.accountSummary(A, { company: 'Bravo Prospect' }));
    assert.ok('error' in repo.accountSummary(A, { contact: 'Bravo Person' }));
    assert.equal(repo.nbaKey(A, ids.Bravo_deal), '');
    assert.equal(repo.owns(A, 'deals', ids.Bravo_deal), false);
    assert.equal(repo.owns(A, 'deals', ids.Alpha_deal), true);
  });

  test('writes are scoped and client scopes are read-only', () => {
    assert.throws(() => store.patch(A, 'deals', ids.Bravo_deal, { title: 'x' }), store.UserError);
    assert.throws(() => store.setDealStage(A, ids.Bravo_deal, 2), store.UserError);
    assert.throws(() => store.setTaskDone(A, ids.Bravo_task, true), store.UserError);
    assert.throws(() => store.deleteRecord(A, 'companies', ids.Bravo_co), store.UserError);
    assert.throws(() => applyActions(A, [{ tool: 'log_note', input: { body: 'x', deal: 'Bravo Secret Deal' } }]));
    const clientScope = { clientId: ids.Alpha, userId: null, role: 'client' as const, agency: true };
    assert.throws(() => store.createContact(clientScope, { name: 'x' }), /read-only/);
    // A name that exists only in Bravo creates a new Alpha record instead of linking across clients.
    const newId = store.createContact(A, { name: 'Linked', company: 'Bravo Prospect Co' });
    const row = db.prepare('SELECT co.client_id FROM contacts c JOIN companies co ON co.id = c.company_id WHERE c.id = ?').get(newId) as { client_id: number };
    assert.equal(row.client_id, ids.Alpha);
  });
});

describe('single-user mode', () => {
  test('no login needed and only the default workspace is visible', async () => {
    setSetting('agency_mode', '0');
    try {
      const r = await as(null)('GET', '/contacts');
      assert.equal(r.status, 200);
      assert.ok(r.text.includes('Sara Haddad'));
      assert.ok(!/Alpha|Bravo/.test(r.text));
      assert.equal((await as(null)('GET', '/agency/overview')).status, 404);
    } finally {
      setSetting('agency_mode', '1');
    }
  });
});
