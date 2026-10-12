// Weekly client reports. Every figure comes from metrics.ts (the database). Claude only writes prose
// around placeholders like {{calls}}; any digit it writes on its own makes the draft invalid.
import PDFDocument from 'pdfkit';
import { db, agencyMode, type Row } from './db.js';
import { MODEL, hasApiKey } from './config.js';
import { REPORT_HOUR } from './agencyConfig.js';
import { reportMetrics, reportTz, money, type ReportMetrics } from './metrics.js';
import { addDays, localParts, weekStart } from './tz.js';
import { claude, friendlyError } from './errors.js';
import { FALLBACK } from './ai.js';
import { sendMail } from './mail.js';
import { UserError } from './store.js';

// ---------- placeholders ----------
export function placeholders(m: ReportMetrics): Record<string, string> {
  const change = m.prev.activities ? Math.round(((m.activities - m.prev.activities) / m.prev.activities) * 100) : null;
  return {
    calls: String(m.calls),
    connected_calls: String(m.connected),
    connect_rate: `${m.connect_rate}%`,
    emails: String(m.emails),
    linkedin: String(m.linkedin),
    meetings: String(m.meetings),
    pipeline_deals: String(m.pipeline_deals),
    pipeline_value: money(m.pipeline_value),
    prev_calls: String(m.prev.calls),
    prev_meetings: String(m.prev.meetings),
    prev_connect_rate: `${m.prev.connect_rate}%`,
    activity_change: change == null ? 'no comparison available' : change === 0 ? 'flat' : `${change > 0 ? 'up' : 'down'} ${Math.abs(change)}%`,
    stale_deal_count: String(m.context.stale_deal_count),
    meetings_next_week: String(m.context.meetings_next_week.length),
  };
}

/**
 * Replace {{placeholders}} with real values. Throws if the text uses an unknown placeholder or contains
 * any digit outside a placeholder (names we passed in, like "Acme 360", are allowed).
 */
export function fillPlaceholders(text: string, values: Record<string, string>, allowedNames: string[] = []): string {
  for (const [, key] of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    if (!(key in values)) throw new Error(`unknown placeholder {{${key}}}`);
  }
  let probe = text.replace(/\{\{\s*\w+\s*\}\}/g, '');
  for (const n of [...allowedNames].sort((a, b) => b.length - a.length)) if (n) probe = probe.split(n).join('');
  const stray = probe.match(/\d[\d,.]*/);
  if (stray) throw new Error(`wrote the figure "${stray[0]}" instead of using a placeholder`);
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => values[k]);
}

const bullets = (xs: string[]) => xs.filter(Boolean).map((x) => `- ${x.replace(/^[-•*]\s*/, '')}`).join('\n');

function templateText(m: ReportMetrics, values: Record<string, string>) {
  const fill = (t: string) => fillPlaceholders(t, values, [...m.context.stale_deals, ...m.context.meetings_next_week]);
  const summary = fill('Last week the team made {{calls}} calls ({{connect_rate}} connect rate), sent {{emails}} emails and {{linkedin}} LinkedIn messages, and booked {{meetings}} meetings. {{pipeline_deals}} new deals worth {{pipeline_value}} entered the pipeline.');
  const blockers = [
    m.context.stale_deals.length ? `No recent response on: ${m.context.stale_deals.slice(0, 3).join(', ')}.` : '',
    m.calls && m.connect_rate < 10 ? 'Connect rate is low; call lists may need better phone data.' : '',
  ].filter(Boolean);
  const plan = [
    m.context.meetings_next_week.length ? `Run the booked meetings with ${m.context.meetings_next_week.slice(0, 3).join(', ')}.` : 'Book first meetings from the warmest conversations.',
    m.context.stale_deals.length ? 'Re-engage stalled deals with a new angle.' : '',
    'Keep the daily call, email and LinkedIn cadence.',
  ].filter(Boolean);
  return { summary, blockers: bullets(blockers.length ? blockers : ['No major blockers this week.']), plan: bullets(plan) };
}

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    plan: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'blockers', 'plan'],
  additionalProperties: false,
};

async function aiText(clientName: string, m: ReportMetrics, values: Record<string, string>) {
  const names = [clientName, ...m.context.stale_deals, ...m.context.meetings_next_week, ...m.wins];
  const prompt = `Write the narrative for a weekly outbound report that an SDR agency sends to its client "${clientName}".

FIGURES (from the database, already final):
${Object.entries(values).map(([k, v]) => `{{${k}}} = ${v}`).join('\n')}

CONTEXT
Top wins (already listed in the report, don't repeat them verbatim): ${JSON.stringify(m.wins)}
Deals with no activity for 7+ days: ${JSON.stringify(m.context.stale_deals)}
Meetings booked for next week with: ${JSON.stringify(m.context.meetings_next_week)}

RULES
- Never type a digit. Whenever you mention a figure, write its placeholder exactly, e.g. "{{calls}} calls".
- Only use the placeholders listed above. Don't compute, round or estimate anything new.
- Plain, confident English for a client. No hype, no emojis.

Return JSON:
- summary: 2-4 sentences on how the week went.
- blockers: 0-3 short bullets on what slowed things down (only what the data supports).
- plan: 2-3 short bullets for next week.`;

  const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: prompt }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await claude().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages,
      ...FALLBACK,
    });
    if (msg.stop_reason === 'refusal') throw new Error('Claude declined to write this report.');
    const raw = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    try {
      const out = JSON.parse(raw) as { summary: string; blockers: string[]; plan: string[] };
      const f = (t: string) => fillPlaceholders(t, values, names);
      return { summary: f(out.summary), blockers: bullets(out.blockers.slice(0, 3).map(f)), plan: bullets(out.plan.slice(0, 3).map(f)) };
    } catch (e) {
      messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `That draft was rejected: ${(e as Error).message}. Rewrite it following the rules exactly.` });
    }
  }
  throw new Error('Claude kept writing raw figures, so the template was used.');
}

/** Create the draft for one client/week (no-op if it exists). Returns the report id. */
export async function generateReport(clientId: number, weekStartDate: string, opts: { ai?: boolean } = {}): Promise<number> {
  const existing = db.prepare('SELECT id FROM weekly_reports WHERE client_id = ? AND week_start = ?').get(clientId, weekStartDate) as Row | undefined;
  if (existing) return existing.id as number;
  const client = db.prepare('SELECT name FROM clients WHERE id = ?').get(clientId) as { name: string };
  const m = reportMetrics(clientId, weekStartDate);
  const values = placeholders(m);
  let text = templateText(m, values);
  let note = 'Summary written from a template (Claude not configured).';
  if (opts.ai !== false && hasApiKey()) {
    try {
      text = await aiText(client.name, m, values);
      note = 'Summary drafted by Claude. Every figure was inserted from the database.';
    } catch (e) {
      note = `Template used: ${e instanceof Error && !('status' in e) ? e.message : friendlyError(e).message}`;
    }
  }
  const r = db.prepare(`INSERT OR IGNORE INTO weekly_reports (client_id, week_start, week_end, metrics_json, summary, blockers, plan, ai_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(clientId, weekStartDate, m.week_end, JSON.stringify(m), text.summary, text.blockers, text.plan, note);
  return (r.lastInsertRowid as number) || ((db.prepare('SELECT id FROM weekly_reports WHERE client_id = ? AND week_start = ?').get(clientId, weekStartDate) as Row).id as number);
}

/** The week a report is due for right now: last week once Monday 08:00 local has passed. */
export function dueWeek(now = new Date(), tz = reportTz()): string {
  const monday = weekStart(now, tz);
  const lp = localParts(now, tz);
  const past = lp.date > monday || lp.hour >= REPORT_HOUR;
  return addDays(monday, past ? -7 : -14);
}

let running = false;
export async function runDueReports(now = new Date()) {
  if (running || !agencyMode()) return [];
  running = true;
  try {
    const week = dueWeek(now);
    const clients = db.prepare(`SELECT id FROM clients WHERE status = 'active' AND (start_date IS NULL OR start_date <= ?)
      AND id NOT IN (SELECT client_id FROM weekly_reports WHERE week_start = ?)`).all(addDays(week, 6), week) as Row[];
    const made: number[] = [];
    for (const c of clients) made.push(await generateReport(c.id as number, week));
    if (made.length) console.log(`Weekly reports: drafted ${made.length} for week of ${week}`);
    return made;
  } finally {
    running = false;
  }
}

export function startScheduler() {
  const tick = () => runDueReports().catch((e) => console.error('Report scheduler:', e));
  setTimeout(tick, 2000);
  setInterval(tick, 60_000).unref();
}

// ---------- PDF ----------
export function reportPdf(r: Row, clientName: string): Promise<Buffer> {
  const m = JSON.parse(r.metrics_json as string) as ReportMetrics;
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Weekly report — ${clientName}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const ink = '#18181b', muted = '#71717a', accent = '#4f46e5';
  const range = `${fmt(m.week_start)} – ${fmt(m.week_end)}`;

  doc.fillColor(accent).fontSize(10).text('WEEKLY OUTBOUND REPORT');
  doc.moveDown(0.2).fillColor(ink).fontSize(22).font('Helvetica-Bold').text(clientName);
  doc.font('Helvetica').fontSize(11).fillColor(muted).text(range);
  doc.moveDown(1);

  const stats: [string, string][] = [
    ['Calls made', String(m.calls)], ['Connect rate', `${m.connect_rate}%`], ['Emails sent', String(m.emails)],
    ['Meetings booked', String(m.meetings)], ['New pipeline', money(m.pipeline_value)], ['New deals', String(m.pipeline_deals)],
  ];
  const colW = (doc.page.width - 112) / 3;
  const top = doc.y;
  stats.forEach(([label, value], i) => {
    const x = 56 + (i % 3) * colW, y = top + Math.floor(i / 3) * 52;
    doc.font('Helvetica-Bold').fontSize(18).fillColor(ink).text(value, x, y, { width: colW - 8 });
    doc.font('Helvetica').fontSize(9).fillColor(muted).text(label.toUpperCase(), x, y + 22, { width: colW - 8 });
  });
  doc.x = 56;
  doc.y = top + 116;

  const section = (title: string, body: string) => {
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).fillColor(ink).text(title, 56);
    doc.moveDown(0.3).font('Helvetica').fontSize(10.5).fillColor(ink);
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    const items = lines.filter((l) => /^[-•*]\s/.test(l));
    if (items.length === lines.length && items.length) doc.list(items.map((l) => strip(l.replace(/^[-•*]\s/, ''))), { bulletRadius: 1.8, textIndent: 10, lineGap: 3 });
    else doc.text(strip(lines.join('\n')), { lineGap: 3 });
  };
  section('Summary', String(r.summary));
  section('Top wins', m.wins.length ? m.wins.map((w) => `- ${w}`).join('\n') : 'No wins logged this week.');
  section('Blockers', String(r.blockers) || 'None.');
  section('Plan for next week', String(r.plan) || '—');

  doc.moveDown(2).fontSize(8).fillColor(muted).text(`All figures are counted from logged CRM activity (${m.timezone}).`, 56);
  doc.end();
  return done;
}
const strip = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
const fmt = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// ---------- Send ----------
export async function sendReport(id: number) {
  const r = db.prepare('SELECT * FROM weekly_reports WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new UserError('Report not found.');
  if (r.status === 'sent') throw new UserError('This report was already sent.');
  const client = db.prepare('SELECT name, contact_email FROM clients WHERE id = ?').get(r.client_id) as { name: string; contact_email: string };
  if (!client.contact_email) throw new UserError(`Add a contact email for ${client.name} in Settings → Clients first.`);
  const m = JSON.parse(r.metrics_json as string) as ReportMetrics;
  const pdf = await reportPdf(r, client.name);
  const text = `Weekly report for ${client.name}, ${fmt(m.week_start)} – ${fmt(m.week_end)}

Calls made: ${m.calls}
Connect rate: ${m.connect_rate}%
Emails sent: ${m.emails}
Meetings booked: ${m.meetings}
New pipeline: ${money(m.pipeline_value)} (${m.pipeline_deals} deals)

${strip(String(r.summary))}

Top wins
${m.wins.map((w) => `- ${w}`).join('\n') || '- None this week'}

Blockers
${strip(String(r.blockers))}

Plan for next week
${strip(String(r.plan))}

The full report is attached and available in your client portal.`;
  const mail = await sendMail({
    to: client.contact_email,
    subject: `Weekly report: ${client.name} (${fmt(m.week_start)} – ${fmt(m.week_end)})`,
    text,
    attachments: [{ filename: `weekly-report-${m.week_start}.pdf`, content: pdf }],
  });
  db.prepare("UPDATE weekly_reports SET status = 'sent', sent_at = datetime('now'), sent_to = ? WHERE id = ?").run(client.contact_email, id);
  return { ...mail, to: client.contact_email };
}
