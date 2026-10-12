// Live checks against the real Claude API. Runs in GitHub Actions with the ANTHROPIC_API_KEY repo secret
// (npm run test:live). Prints PASS/FAIL per check; never prints the key or full model output.
import type { AddressInfo } from 'node:net';
import { tempDb } from '../helpers.js';

if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  console.log('SKIP: ANTHROPIC_API_KEY is not set.');
  process.exit(0);
}
const key = process.env.ANTHROPIC_API_KEY;
tempDb('live');
process.env.ANTHROPIC_API_KEY = key; // tempDb clears it for unit tests

const { db, setSetting } = await import('../../db.js');
const { seedIfEmpty } = await import('../../seed.js');
const { createApp } = await import('../../app.js');
const { hashPassword } = await import('../../auth.js');
const { generateReport, placeholders } = await import('../../reports.js');
const { reportMetrics } = await import('../../metrics.js');
const { MODEL } = await import('../../config.js');

seedIfEmpty();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
let failures = 0;
async function check(name: string, fn: () => Promise<string | void>) {
  const t = Date.now();
  try {
    const info = await fn();
    console.log(`PASS  ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)${info ? ` — ${info}` : ''}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}: ${(e as Error).message}`);
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
const assert = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
const post = (path: string, body: unknown, cookie = '') =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
async function sse(path: string, body: unknown) {
  const text = await (await post(path, body)).text();
  return text.split('\n\n').filter((c) => c.startsWith('data: ')).map((c) => JSON.parse(c.slice(6)));
}

console.log(`Model: ${MODEL}`);

await check('API key + model reachable', async () => {
  const s = await json(fetch(base + '/ai/status'));
  assert(s.ok, s.message);
});

await check('Command bar proposes changes and writes nothing until confirmed', async () => {
  const before = (db.prepare('SELECT COUNT(*) n FROM deals').get() as { n: number }).n;
  const ev = await sse('/ai/chat', { messages: [{ role: 'user', content: 'Add Sara Novak from Acme Robotics, $15k deal in Proposal, follow up Friday.' }] });
  const err = ev.find((e) => e.type === 'error');
  assert(!err, err?.message);
  const props = ev.filter((e) => e.type === 'proposal').map((e) => e.action);
  const deal = props.find((a) => a.tool === 'create_deal');
  assert(deal && Number(deal.input.value) === 15000 && /proposal/i.test(deal.input.stage), `no matching create_deal in ${JSON.stringify(props.map((p) => p.tool))}`);
  assert(props.some((a) => a.tool === 'create_task' && /^\d{4}-\d{2}-\d{2}$/.test(a.input.due_date)), 'no dated follow-up task');
  assert((db.prepare('SELECT COUNT(*) n FROM deals').get() as { n: number }).n === before, 'wrote before confirm');
  const applied = await json(post('/ai/apply', { actions: props.map(({ tool, input }: { tool: string; input: unknown }) => ({ tool, input })) }));
  assert(applied.applied?.length === props.length, JSON.stringify(applied));
  return props.map((p: { tool: string }) => p.tool).join(', ');
});

await check('Command bar answers a data question (streamed)', async () => {
  const ev = await sse('/ai/chat', { messages: [{ role: 'user', content: "What's closing in the next 30 days?" }] });
  assert(!ev.find((e) => e.type === 'error'), ev.find((e) => e.type === 'error')?.message);
  const text = ev.filter((e) => e.type === 'text').map((e) => e.text).join('');
  assert(ev.filter((e) => e.type === 'text').length > 3 && text.length > 20, 'no streamed answer');
});

await check('Research uses web search and returns cited sources', async () => {
  const ev = await sse('/ai/research', { kind: 'company', id: 1 });
  const err = ev.find((e) => e.type === 'error');
  assert(!err, err?.message);
  const final = ev.find((e) => e.type === 'final');
  assert(final, 'no final brief');
  for (const h of ['What they do', 'Size', 'Recent news', 'Likely pain points', 'Talking points', 'Draft first outreach']) assert(final.markdown.includes(h), `missing section ${h}`);
  assert(final.sources.length > 0 && final.sources.every((s: { url: string }) => /^https?:\/\//.test(s.url)), 'no sources');
  return `${final.sources.length} sources`;
});

await check('Next best action', async () => {
  const r = await json(post('/ai/nba/1', {}));
  assert(r.text && r.text.length < 300, JSON.stringify(r));
});

// ---- Agency Mode ----
setSetting('agency_mode', '1');
setSetting('report_timezone', 'Asia/Beirut');
db.prepare("INSERT INTO users (email, name, role, password_hash) VALUES ('owner@ci.example', 'CI Owner', 'owner', ?)").run(hashPassword('ci-password'));
const login = await post('/auth/login', { email: 'owner@ci.example', password: 'ci-password' });
const cookie = login.headers.get('set-cookie')!.split(';')[0];
const client = db.prepare("INSERT INTO clients (name, contact_email, start_date) VALUES ('CI Client', 'c@ci.example', '2026-01-01')").run().lastInsertRowid as number;
const co = db.prepare("INSERT INTO companies (client_id, name) VALUES (?, 'Orbit Labs')").run(client).lastInsertRowid;
const ct = db.prepare("INSERT INTO contacts (client_id, name, company_id) VALUES (?, 'Pat Lee', ?)").run(client, co).lastInsertRowid;
const week = '2026-09-28';
const types = ['call_no_answer', 'call_no_answer', 'call_voicemail', 'call_connected', 'email', 'email', 'linkedin', 'meeting_booked'];
for (let i = 0; i < 40; i++)
  db.prepare("INSERT INTO activities (client_id, type, body, contact_id, company_id, meeting_at, created_at) VALUES (?, ?, '', ?, ?, ?, ?)")
    .run(client, types[i % types.length], ct, co, types[i % types.length] === 'meeting_booked' ? '2026-10-06 10:00' : null, `2026-09-${String(28 + (i % 3)).padStart(2, '0')} 09:${String(i).padStart(2, '0')}:00`);

await check('Weekly report: Claude writes prose, every figure comes from the database', async () => {
  const id = await generateReport(client, week);
  const r = db.prepare('SELECT summary, blockers, plan, ai_note FROM weekly_reports WHERE id = ?').get(id) as Record<string, string>;
  assert(/drafted by Claude/.test(r.ai_note), r.ai_note);
  const allowed = new Set(Object.values(placeholders(reportMetrics(client, week))));
  const figures = `${r.summary} ${r.blockers} ${r.plan}`.match(/\$?\d[\d,]*%?/g) ?? [];
  const stray = figures.filter((f) => !allowed.has(f) && !allowed.has(f.replace(/%$/, '')));
  assert(!stray.length, `figures not from the database: ${stray.join(', ')}`);
  return `${figures.length} figures, all from the database`;
});

await check('Health flag suggestions', async () => {
  const r = await json(post('/agency/health/suggest', {}, cookie));
  const tips = r.suggestions?.[client];
  assert(tips && Object.keys(tips).length, JSON.stringify(r).slice(0, 200));
  assert(Object.values(tips).every((t) => typeof t === 'string' && !/\d/.test(t as string)), 'tip contains digits');
});

server.close();
console.log(failures ? `\n${failures} live check(s) failed.` : '\nAll live checks passed.');
process.exit(failures ? 1 : 0);
