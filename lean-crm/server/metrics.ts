// Numbers for the agency dashboard, weekly reports and the client portal. Pure SQL over explicit
// client ids; nothing here is estimated.
import { db, CLOSED_STAGE_NAMES, getSetting, type Row } from './db.js';
import { OUTREACH_TYPES, CALL_TYPES, HEALTH, REPORT_DEFAULT_TIMEZONE, scoreOf } from './agencyConfig.js';
import { addDays, range, weekStart, localParts, sqlTs } from './tz.js';

export const reportTz = () => getSetting('report_timezone', REPORT_DEFAULT_TIMEZONE);

const list = (xs: readonly (string | number)[]) => xs.map((x) => (typeof x === 'number' ? String(Number(x)) : `'${String(x).replace(/'/g, "''")}'`)).join(',') || 'NULL';
const OUT = list(OUTREACH_TYPES);
const CLOSED = list(CLOSED_STAGE_NAMES);
const pct = (num: number, den: number) => (den ? Math.round((num / den) * 100) : 0);

/** Counts of each activity type for one client (or several) in [from, to). */
function typeCounts(clientIds: number[], from: string, to: string, userId?: number): Record<string, number> {
  const rows = db.prepare(`SELECT type, COUNT(*) n FROM activities WHERE client_id IN (${list(clientIds)})
    AND created_at >= ? AND created_at < ? ${userId ? 'AND user_id = ?' : ''} GROUP BY type`)
    .all(...[from, to, ...(userId ? [userId] : [])]) as { type: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.type, r.n]));
}

export function summarizeCounts(c: Record<string, number>) {
  const calls = CALL_TYPES.reduce((s, t) => s + (c[t] ?? 0), 0);
  const connected = c.call_connected ?? 0;
  return {
    activities: OUTREACH_TYPES.reduce((s, t) => s + (c[t] ?? 0), 0),
    calls,
    connected,
    connect_rate: pct(connected, calls),
    emails: c.email ?? 0,
    linkedin: c.linkedin ?? 0,
    meetings: c.meeting_booked ?? 0,
    score: scoreOf(Object.fromEntries(OUTREACH_TYPES.map((t) => [t, c[t] ?? 0]))),
  };
}

/** Local [from, to) for "day" (today) or "week" (this Monday → next Monday) in the agency timezone. */
export function periodRange(period: 'day' | 'week', now = new Date()): [string, string] {
  const tz = reportTz();
  if (period === 'day') {
    const d = localParts(now, tz).date;
    return range(d, addDays(d, 1), tz);
  }
  const w = weekStart(now, tz);
  return range(w, addDays(w, 7), tz);
}

// ---------- Rep leaderboard ----------
export function leaderboard(clientIds: number[], period: 'day' | 'week', now = new Date()) {
  const [from, to] = periodRange(period, now);
  const reps = db.prepare(`SELECT id, name, email, role FROM users WHERE role = 'rep' AND password_hash IS NOT NULL
    UNION SELECT DISTINCT u.id, u.name, u.email, u.role FROM activities a JOIN users u ON u.id = a.user_id
    WHERE a.client_id IN (${list(clientIds)}) AND a.created_at >= ? AND a.created_at < ?`).all(from, to) as Row[];
  return reps
    .map((u) => ({ user_id: u.id as number, name: (u.name as string) || (u.email as string), ...summarizeCounts(typeCounts(clientIds, from, to, u.id as number)) }))
    .sort((a, b) => b.score - a.score || b.activities - a.activities);
}

// ---------- "All clients" rollup ----------
export function clientRollup(clientIds: number[], now = new Date()) {
  const [wFrom, wTo] = periodRange('week', now);
  const clients = db.prepare(`SELECT id, name, logo_url, status, start_date, contact_email FROM clients WHERE id IN (${list(clientIds)}) ORDER BY name COLLATE NOCASE`).all() as Row[];
  const rows = clients.map((c) => {
    const id = c.id as number;
    const open = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(d.value), 0) v FROM deals d JOIN stages s ON s.id = d.stage_id
      WHERE d.client_id = ? AND lower(s.name) NOT IN (${CLOSED})`).get(id) as { n: number; v: number };
    const created = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(value), 0) v FROM deals WHERE client_id = ? AND created_at >= ? AND created_at < ?').get(id, wFrom, wTo) as { n: number; v: number };
    const week = summarizeCounts(typeCounts([id], wFrom, wTo));
    const last = db.prepare(`SELECT MAX(created_at) t FROM activities WHERE client_id = ? AND type IN (${OUT})`).get(id) as { t: string | null };
    return { ...c, open_deals: open.n, open_value: open.v, created_deals: created.n, created_value: created.v,
      activities_week: week.activities, meetings_week: week.meetings, connect_rate_week: week.connect_rate, last_activity: last.t };
  });
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return {
    clients: rows,
    totals: { open_deals: sum('open_deals'), open_value: sum('open_value'), created_deals: sum('created_deals'),
      created_value: sum('created_value'), activities_week: sum('activities_week'), meetings_week: sum('meetings_week') },
  };
}

// ---------- Health flags ----------
export type Flag =
  | { kind: 'activity_drop'; last7: number; prev7: number; change_pct: number }
  | { kind: 'no_meetings'; days: number }
  | { kind: 'no_activity'; days: number; last_activity: string | null };

export function healthFlags(clientId: number, now = new Date()): Flag[] {
  const ago = (d: number) => sqlTs(new Date(now.getTime() - d * 86400000));
  const count = (from: string, to: string, types = OUT) =>
    (db.prepare(`SELECT COUNT(*) n FROM activities WHERE client_id = ? AND type IN (${types}) AND created_at >= ? AND created_at < ?`)
      .get(clientId, from, to) as { n: number }).n;
  const nowTs = sqlTs(now);
  const flags: Flag[] = [];
  const last7 = count(ago(7), nowTs), prev7 = count(ago(14), ago(7));
  if (prev7 > 0) {
    const change = Math.round(((last7 - prev7) / prev7) * 100);
    if (change <= -HEALTH.activityDropPct) flags.push({ kind: 'activity_drop', last7, prev7, change_pct: change });
  }
  if (count(ago(HEALTH.noMeetingsDays), nowTs, "'meeting_booked'") === 0) flags.push({ kind: 'no_meetings', days: HEALTH.noMeetingsDays });
  if (count(ago(HEALTH.noActivityDays), nowTs) === 0) {
    const last = db.prepare(`SELECT MAX(created_at) t FROM activities WHERE client_id = ? AND type IN (${OUT}) AND created_at < ?`).get(clientId, nowTs) as { t: string | null };
    flags.push({ kind: 'no_activity', days: HEALTH.noActivityDays, last_activity: last.t });
  }
  return flags;
}

export const flagLabel = (f: Flag) =>
  f.kind === 'activity_drop' ? `Activity down ${Math.abs(f.change_pct)}% week over week (${f.last7} vs ${f.prev7})`
  : f.kind === 'no_meetings' ? `No meetings booked in ${f.days} days`
  : `No logged activity in ${f.days}+ days`;

// ---------- Weekly report numbers ----------
export type ReportMetrics = ReturnType<typeof reportMetrics>;

export function reportMetrics(clientId: number, weekStartDate: string, tz = reportTz()) {
  const weekEnd = addDays(weekStartDate, 6);
  const [from, to] = range(weekStartDate, addDays(weekStartDate, 7), tz);
  const [pFrom, pTo] = range(addDays(weekStartDate, -7), weekStartDate, tz);
  // meeting_at is local wall-clock time (what the rep typed), so compare it with local dates.
  const [nFrom, nTo] = [addDays(weekStartDate, 7), addDays(weekStartDate, 14)];
  const cur = summarizeCounts(typeCounts([clientId], from, to));
  const prev = summarizeCounts(typeCounts([clientId], pFrom, pTo));
  const pipe = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(value), 0) v FROM deals WHERE client_id = ? AND created_at >= ? AND created_at < ?').get(clientId, from, to) as { n: number; v: number };

  const won = db.prepare(`SELECT d.title, d.value, co.name company FROM activities a JOIN deals d ON d.id = a.deal_id LEFT JOIN companies co ON co.id = d.company_id
    WHERE a.client_id = ? AND a.type = 'stage_change' AND a.body LIKE '%→ Won' AND a.created_at >= ? AND a.created_at < ? ORDER BY d.value DESC`).all(clientId, from, to) as Row[];
  const meetings = db.prepare(`SELECT ct.name contact, co.name company, a.meeting_at FROM activities a
    LEFT JOIN contacts ct ON ct.id = a.contact_id LEFT JOIN companies co ON co.id = a.company_id
    WHERE a.client_id = ? AND a.type = 'meeting_booked' AND a.created_at >= ? AND a.created_at < ? ORDER BY a.created_at DESC`).all(clientId, from, to) as Row[];
  const advanced = db.prepare(`SELECT d.title, a.body FROM activities a JOIN deals d ON d.id = a.deal_id
    WHERE a.client_id = ? AND a.type = 'stage_change' AND a.body NOT LIKE '%→ Won' AND a.body NOT LIKE '%→ Lost' AND a.created_at >= ? AND a.created_at < ?
    ORDER BY a.created_at DESC`).all(clientId, from, to) as Row[];
  const fmtDay = (local: unknown) => (local ? new Date(String(local).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
  const wins = [
    ...won.map((w) => `Closed won: ${w.title} (${money(w.value as number)})`),
    ...meetings.map((m) => `Meeting booked with ${m.contact ?? 'a prospect'}${m.company ? ` (${m.company})` : ''}${m.meeting_at ? ` for ${fmtDay(m.meeting_at)}` : ''}`),
    ...advanced.map((a) => `${a.title}: ${String(a.body).replace('Stage: ', '')}`),
  ].slice(0, 3);

  const stale = (db.prepare(`SELECT d.title FROM deals d JOIN stages s ON s.id = d.stage_id WHERE d.client_id = ? AND lower(s.name) NOT IN (${CLOSED})
    AND COALESCE((SELECT MAX(created_at) FROM activities a WHERE a.deal_id = d.id), d.created_at) < datetime(?, '-7 days') ORDER BY d.value DESC`)
    .all(clientId, to) as Row[]).map((r) => r.title as string);
  const upcoming = db.prepare(`SELECT ct.name contact, co.name company FROM activities a LEFT JOIN contacts ct ON ct.id = a.contact_id
    LEFT JOIN companies co ON co.id = a.company_id WHERE a.client_id = ? AND a.type = 'meeting_booked' AND a.meeting_status = 'booked'
    AND a.meeting_at >= ? AND a.meeting_at < ? ORDER BY a.meeting_at`).all(clientId, nFrom, nTo) as Row[];

  return {
    week_start: weekStartDate, week_end: weekEnd, timezone: tz,
    calls: cur.calls, connected: cur.connected, connect_rate: cur.connect_rate, emails: cur.emails, linkedin: cur.linkedin,
    meetings: cur.meetings, activities: cur.activities, pipeline_deals: pipe.n, pipeline_value: pipe.v,
    prev: { calls: prev.calls, connect_rate: prev.connect_rate, meetings: prev.meetings, activities: prev.activities },
    wins,
    context: {
      stale_deals: stale.slice(0, 5), stale_deal_count: stale.length,
      meetings_next_week: upcoming.map((u) => `${u.contact ?? 'prospect'}${u.company ? ` (${u.company})` : ''}`),
    },
  };
}

export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

// ---------- Client portal ----------
export function portal(clientId: number, now = new Date()) {
  const tz = reportTz();
  const [wFrom] = periodRange('week', now);
  const monthStart = localParts(now, tz).date.slice(0, 8) + '01';
  const [mFrom] = range(monthStart, monthStart, tz);
  const created = (from: string) => {
    const deals = db.prepare(`SELECT d.title, d.value, s.name stage, co.name company, d.created_at FROM deals d JOIN stages s ON s.id = d.stage_id
      LEFT JOIN companies co ON co.id = d.company_id WHERE d.client_id = ? AND d.created_at >= ? ORDER BY d.created_at DESC`).all(clientId, from) as Row[];
    return { count: deals.length, value: deals.reduce((s, d) => s + (d.value as number), 0), deals };
  };
  return {
    client: db.prepare('SELECT id, name, logo_url FROM clients WHERE id = ?').get(clientId),
    pipeline: { week: created(wFrom), month: created(mFrom) },
    meetings: db.prepare(`SELECT a.id, a.meeting_at, a.meeting_status, ct.name prospect, ct.title, co.name company, a.created_at booked_at
      FROM activities a LEFT JOIN contacts ct ON ct.id = a.contact_id LEFT JOIN companies co ON co.id = a.company_id
      WHERE a.client_id = ? AND a.type = 'meeting_booked' ORDER BY COALESCE(a.meeting_at, a.created_at) DESC LIMIT 20`).all(clientId),
    // Free-text internal notes are not shown to clients.
    feed: db.prepare(`SELECT a.id, a.type, CASE WHEN a.type = 'stage_change' THEN a.body ELSE '' END body, ct.name contact, co.name company,
      u.name rep, a.created_at FROM activities a LEFT JOIN contacts ct ON ct.id = a.contact_id LEFT JOIN companies co ON co.id = a.company_id
      LEFT JOIN users u ON u.id = a.user_id WHERE a.client_id = ? AND a.type NOT IN ('note', 'task_done')
      ORDER BY a.created_at DESC, a.id DESC LIMIT 25`).all(clientId),
    report: db.prepare(`SELECT id, week_start, week_end, metrics_json, summary, blockers, plan, sent_at FROM weekly_reports
      WHERE client_id = ? AND status = 'sent' ORDER BY week_start DESC LIMIT 1`).get(clientId) ?? null,
  };
}
