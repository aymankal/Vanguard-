import { Router } from 'express';
import { db, setSetting, today, type Row } from './db.js';
import { MODEL, hasApiKey } from './config.js';
import { h } from './api.js';
import { invite } from './auth.js';
import { UserError } from './store.js';
import * as metrics from './metrics.js';
import { reportPdf, sendReport, dueWeek } from './reports.js';
import { claude, friendlyError } from './errors.js';
import { FALLBACK } from './ai.js';

// ---------- Owner: Agency Dashboard + management ----------
export const agency = Router();
const allClientIds = () => (db.prepare('SELECT id FROM clients').all() as Row[]).map((r) => r.id as number);
const id = (v: unknown) => Number(v);

agency.get('/overview', h((req) => {
  const period = req.query.period === 'day' ? 'day' : 'week';
  const ids = allClientIds();
  const active = db.prepare("SELECT id, name, health_key, health_text FROM clients WHERE status = 'active' ORDER BY name COLLATE NOCASE").all() as Row[];
  const health = active
    .map((c) => {
      const flags = metrics.healthFlags(c.id as number);
      const key = healthKey(flags);
      return {
        client_id: c.id, name: c.name,
        flags: flags.map((f) => ({ kind: f.kind, label: metrics.flagLabel(f) })),
        suggestions: c.health_key === key && c.health_text ? JSON.parse(c.health_text as string) : null,
      };
    })
    .filter((c) => c.flags.length);
  return {
    period,
    rollup: metrics.clientRollup(ids),
    leaderboard: metrics.leaderboard(ids, period),
    health,
    reports: db.prepare(`SELECT r.id, r.client_id, c.name client, r.week_start, r.week_end, r.status, r.sent_at FROM weekly_reports r
      JOIN clients c ON c.id = r.client_id WHERE r.status = 'draft' OR r.week_start >= ? ORDER BY r.status = 'draft' DESC, r.week_start DESC, c.name LIMIT 30`)
      .all(dueWeek()),
  };
}));

const healthKey = (flags: metrics.Flag[]) => `${today()}|${flags.map((f) => f.kind).join(',')}`;
const FALLBACK_TIP: Record<string, string> = {
  activity_drop: 'Check rep capacity on this account and rebalance call blocks this week.',
  no_meetings: 'Review messaging and target list with the client; test a new opener.',
  no_activity: 'Confirm who owns this account today and restart the daily cadence.',
};

/** One-line AI suggestion per flag. Cached per client per day; no figures allowed in the text. */
agency.post('/health/suggest', async (req, res) => {
  const active = db.prepare("SELECT id, name, start_date FROM clients WHERE status = 'active'").all() as Row[];
  const out: Record<number, Record<string, string>> = {};
  try {
    for (const c of active) {
      const flags = metrics.healthFlags(c.id as number);
      if (!flags.length) continue;
      const key = healthKey(flags);
      const cached = db.prepare('SELECT health_text FROM clients WHERE id = ? AND health_key = ?').get(c.id, key) as Row | undefined;
      if (cached?.health_text) { out[c.id as number] = JSON.parse(cached.health_text as string); continue; }
      if (!hasApiKey()) throw new Error('nokey');
      const msg = await claude().beta.messages.create({
        model: MODEL, max_tokens: 2000, ...FALLBACK,
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: {
            type: 'object', additionalProperties: false, required: ['suggestions'],
            properties: { suggestions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'text'],
              properties: { kind: { type: 'string', enum: flags.map((f) => f.kind) }, text: { type: 'string' } } } } },
          } },
        },
        messages: [{ role: 'user', content: `You advise the owner of an SDR/outbound agency. Client "${c.name}" has these health flags:
${flags.map((f) => `- ${f.kind}: ${metrics.flagLabel(f)}`).join('\n')}
For each flag, give ONE concrete action the owner should take this week. Max 18 words each, imperative, no numbers or digits.` }],
      });
      const raw = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      const parsed = JSON.parse(raw) as { suggestions: { kind: string; text: string }[] };
      const tips: Record<string, string> = {};
      for (const f of flags) {
        const t = parsed.suggestions.find((s) => s.kind === f.kind)?.text?.trim();
        tips[f.kind] = t && !/\d/.test(t) ? t : FALLBACK_TIP[f.kind];
      }
      db.prepare('UPDATE clients SET health_key = ?, health_text = ? WHERE id = ?').run(key, JSON.stringify(tips), c.id);
      out[c.id as number] = tips;
    }
    res.json({ suggestions: out });
  } catch (e) {
    if (e instanceof Error && e.message === 'nokey') return res.status(503).json({ error: 'Add ANTHROPIC_API_KEY to get AI suggestions.', suggestions: out });
    const f = friendlyError(e);
    res.status(f.status).json({ error: f.message, suggestions: out });
  }
});

// Clients
const CLIENT_FIELDS = ['name', 'logo_url', 'contact_email', 'status', 'start_date'] as const;
function cleanClient(b: Row, partial: boolean) {
  const out: Row = {};
  for (const k of CLIENT_FIELDS) {
    if (!(k in b)) continue;
    const v = String(b[k] ?? '').trim();
    if (k === 'name' && !v) throw new UserError('Client name is required.');
    if (k === 'status' && !['active', 'paused', 'ended'].includes(v)) throw new UserError('Status must be active, paused or ended.');
    if (k === 'start_date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UserError('Start date must be YYYY-MM-DD.');
    if (k === 'contact_email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new UserError('Enter a valid contact email.');
    if (k === 'logo_url' && v && !/^https:\/\//.test(v)) throw new UserError('Logo must be an https:// image URL.');
    out[k] = k === 'start_date' ? v || null : v;
  }
  if (!partial && !out.name) throw new UserError('Client name is required.');
  return out;
}
agency.get('/clients', h(() => db.prepare('SELECT id, name, logo_url, contact_email, status, start_date FROM clients ORDER BY name COLLATE NOCASE').all()));
agency.post('/clients', h((req) => {
  const c = cleanClient(req.body, false);
  const r = db.prepare('INSERT INTO clients (name, logo_url, contact_email, status, start_date) VALUES (?, ?, ?, ?, ?)')
    .run(c.name, c.logo_url ?? '', c.contact_email ?? '', c.status ?? 'active', c.start_date ?? today());
  return { id: r.lastInsertRowid };
}));
agency.patch('/clients/:id', h((req) => {
  const c = cleanClient(req.body, true);
  const keys = Object.keys(c);
  if (keys.length) db.prepare(`UPDATE clients SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => c[k]), id(req.params.id));
  return { ok: true };
}));

// Team
agency.get('/users', h(() => {
  const users = db.prepare(`SELECT id, email, name, role, client_id, (password_hash IS NULL) AS pending FROM users ORDER BY role, name COLLATE NOCASE`).all() as Row[];
  const links = db.prepare('SELECT user_id, client_id FROM user_clients').all() as Row[];
  return users.map((u) => ({ ...u, pending: !!u.pending, client_ids: u.role === 'client' ? [u.client_id] : links.filter((l) => l.user_id === u.id).map((l) => l.client_id) }));
}));
agency.post('/users/invite', async (req, res, next) => {
  try {
    res.json(await invite(req, { email: String(req.body.email ?? ''), name: req.body.name, role: req.body.role, clientIds: Array.isArray(req.body.client_ids) ? req.body.client_ids : [], claudeId: req.body.claude_id }));
  } catch (e) {
    next(e);
  }
});
agency.patch('/users/:id', h((req) => {
  const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id(req.params.id)) as Row | undefined;
  if (!u) throw new UserError('User not found.');
  if (u.role !== 'rep') throw new UserError('Only rep assignments can be changed. Re-invite to change a role.');
  const ids = (Array.isArray(req.body.client_ids) ? req.body.client_ids : []).map(Number).filter((c: number) => allClientIds().includes(c));
  db.transaction(() => {
    db.prepare('DELETE FROM user_clients WHERE user_id = ?').run(u.id);
    ids.forEach((c: number) => db.prepare('INSERT INTO user_clients (user_id, client_id) VALUES (?, ?)').run(u.id, c));
  })();
  return { ok: true };
}));
agency.delete('/users/:id', h((req) => {
  if (id(req.params.id) === req.user!.id) throw new UserError("You can't remove yourself.");
  db.prepare('DELETE FROM users WHERE id = ?').run(id(req.params.id));
  return { ok: true };
}));

// Reports
const reportRow = (rid: number) => {
  const r = db.prepare('SELECT r.*, c.name client, c.contact_email FROM weekly_reports r JOIN clients c ON c.id = r.client_id WHERE r.id = ?').get(rid) as Row | undefined;
  if (!r) throw new UserError('Report not found.');
  return r;
};
agency.get('/reports/:id', h((req) => reportRow(id(req.params.id))));
agency.patch('/reports/:id', h((req) => {
  const r = reportRow(id(req.params.id));
  if (r.status === 'sent') throw new UserError('Sent reports can’t be edited.');
  for (const k of ['summary', 'blockers', 'plan']) {
    if (k in req.body) db.prepare(`UPDATE weekly_reports SET ${k} = ? WHERE id = ?`).run(String(req.body[k] ?? ''), r.id);
  }
  return { ok: true };
}));
agency.post('/reports/:id/send', async (req, res, next) => {
  try {
    res.json(await sendReport(id(req.params.id)));
  } catch (e) {
    next(e);
  }
});
agency.get('/reports/:id/pdf', async (req, res, next) => {
  try {
    const r = reportRow(id(req.params.id));
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="report-${r.week_start}.pdf"`);
    res.send(await reportPdf(r, r.client as string));
  } catch (e) {
    next(e);
  }
});

// Settings
agency.get('/settings', h(() => ({ timezone: metrics.reportTz() })));
agency.patch('/settings', h((req) => {
  const tz = String(req.body.timezone ?? '');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new UserError('Unknown timezone.');
  }
  setSetting('report_timezone', tz);
  return { ok: true };
}));
agency.post('/disable', h(() => (setSetting('agency_mode', '0'), { ok: true })));

// ---------- Client Portal (client users; owner may preview the active client) ----------
export const portalRoutes = Router();
portalRoutes.get('/', h((req) => metrics.portal(req.scope.clientId)));
portalRoutes.get('/reports/:id/pdf', async (req, res, next) => {
  try {
    const r = db.prepare("SELECT r.*, c.name client FROM weekly_reports r JOIN clients c ON c.id = r.client_id WHERE r.id = ? AND r.client_id = ? AND r.status = 'sent'")
      .get(id(req.params.id), req.scope.clientId) as Row | undefined;
    if (!r) throw new UserError('Report not found.');
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="report-${r.week_start}.pdf"`);
    res.send(await reportPdf(r, r.client as string));
  } catch (e) {
    next(e);
  }
});
