// Scoped reads. Every statement here filters on client_id = scope.clientId.
import { db, CLOSED_STAGE_NAMES, type Row } from './db.js';
import { STALE_DAYS } from './config.js';
import type { Scope } from './scope.js';

const closed = CLOSED_STAGE_NAMES.map((n) => `'${n}'`).join(',');

const DEALS = `
  SELECT d.id, d.title, d.value, d.stage_id, s.name AS stage, d.company_id, co.name AS company,
         d.contact_id, ct.name AS contact, d.close_date, d.nba_text, d.nba_key, d.created_at,
         COALESCE((SELECT MAX(a.created_at) FROM activities a WHERE a.deal_id = d.id), d.created_at) AS last_activity
  FROM deals d JOIN stages s ON s.id = d.stage_id
  LEFT JOIN companies co ON co.id = d.company_id LEFT JOIN contacts ct ON ct.id = d.contact_id
  WHERE d.client_id = @c`;

const CONTACTS = `
  SELECT c.id, c.name, c.email, c.phone, c.title, c.company_id, co.name AS company, c.owner, c.created_at,
         (SELECT MAX(a.created_at) FROM activities a WHERE a.contact_id = c.id
            OR a.deal_id IN (SELECT id FROM deals WHERE contact_id = c.id)) AS last_activity
  FROM contacts c LEFT JOIN companies co ON co.id = c.company_id
  WHERE c.client_id = @c`;

const COMPANIES = `
  SELECT co.id, co.name, co.website, co.industry, co.size, co.notes, co.created_at,
         (SELECT COUNT(*) FROM contacts c WHERE c.company_id = co.id) AS contact_count
  FROM companies co WHERE co.client_id = @c`;

const TASKS = `SELECT t.*, c.name AS contact, d.title AS deal FROM tasks t
  LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN deals d ON d.id = t.deal_id
  WHERE t.client_id = @c`;

const ACTIVITIES = `SELECT a.*, u.name AS user_name, ct.name AS contact, co.name AS company FROM activities a
  LEFT JOIN users u ON u.id = a.user_id LEFT JOIN contacts ct ON ct.id = a.contact_id LEFT JOIN companies co ON co.id = a.company_id
  WHERE a.client_id = @c`;

const p = (s: Scope, extra: Row = {}) => ({ c: s.clientId, ...extra });
const all = (sql: string, params: Row) => db.prepare(sql).all(params) as Row[];
const one = (sql: string, params: Row) => db.prepare(sql).get(params) as Row | undefined;

/** True if the row exists in this client's workspace. Used to validate every referenced id. */
export function owns(s: Scope, table: 'companies' | 'contacts' | 'deals' | 'tasks' | 'activities', id: unknown): boolean {
  if (id == null || id === '') return false;
  return !!one(`SELECT 1 FROM ${table} WHERE id = @id AND client_id = @c`, p(s, { id: Number(id) }));
}

export const stages = () => db.prepare('SELECT id, name, position FROM stages ORDER BY position').all() as Row[];

export const listCompanies = (s: Scope) => all(`${COMPANIES} ORDER BY co.name COLLATE NOCASE`, p(s));
export const listContacts = (s: Scope) => all(`${CONTACTS} ORDER BY c.name COLLATE NOCASE`, p(s));
export const listDeals = (s: Scope) => all(`${DEALS} ORDER BY d.created_at DESC`, p(s));

export function getCompany(s: Scope, id: number) {
  const company = one(`${COMPANIES} AND co.id = @id`, p(s, { id }));
  if (!company) return null;
  return {
    company,
    contacts: all(`${CONTACTS} AND c.company_id = @id ORDER BY c.name`, p(s, { id })),
    deals: all(`${DEALS} AND d.company_id = @id ORDER BY d.created_at DESC`, p(s, { id })),
    tasks: all(`${TASKS} AND (c.company_id = @id OR d.company_id = @id) ORDER BY t.done, t.due_date`, p(s, { id })),
    activities: all(`${ACTIVITIES} AND a.company_id = @id ORDER BY a.created_at DESC, a.id DESC`, p(s, { id })),
  };
}

export function getContact(s: Scope, id: number) {
  const contact = one(`${CONTACTS} AND c.id = @id`, p(s, { id }));
  if (!contact) return null;
  return {
    contact,
    deals: all(`${DEALS} AND d.contact_id = @id ORDER BY d.created_at DESC`, p(s, { id })),
    tasks: all(`${TASKS} AND (t.contact_id = @id OR d.contact_id = @id) ORDER BY t.done, t.due_date`, p(s, { id })),
    activities: all(`${ACTIVITIES} AND a.contact_id = @id ORDER BY a.created_at DESC, a.id DESC`, p(s, { id })),
  };
}

export function getDeal(s: Scope, id: number) {
  const deal = one(`${DEALS} AND d.id = @id`, p(s, { id }));
  if (!deal) return null;
  return {
    deal,
    tasks: all(`${TASKS} AND t.deal_id = @id ORDER BY t.done, t.due_date`, p(s, { id })),
    activities: all(`${ACTIVITIES} AND a.deal_id = @id ORDER BY a.created_at DESC, a.id DESC`, p(s, { id })),
  };
}

export const dealRow = (s: Scope, id: number) => one(`${DEALS} AND d.id = @id`, p(s, { id }));
export const dealTimeline = (s: Scope, id: number) =>
  all(`SELECT type, body, meeting_at, meeting_status, created_at FROM activities WHERE client_id = @c AND deal_id = @id ORDER BY created_at DESC LIMIT 30`, p(s, { id }));
export const openDealTasks = (s: Scope, id: number) =>
  all('SELECT title, due_date FROM tasks WHERE client_id = @c AND deal_id = @id AND done = 0', p(s, { id }));

export function today(s: Scope, t: string) {
  return {
    today: t,
    overdue: all(`${TASKS} AND t.done = 0 AND t.due_date < @t ORDER BY t.due_date`, p(s, { t })),
    due: all(`${TASKS} AND t.done = 0 AND t.due_date = @t ORDER BY t.id`, p(s, { t })),
    upcoming: all(`${TASKS} AND t.done = 0 AND t.due_date > @t AND t.due_date <= date(@t, '+7 days') ORDER BY t.due_date`, p(s, { t })),
    stale: all(`SELECT * FROM (${DEALS} AND lower(s.name) NOT IN (${closed})) WHERE last_activity < datetime('now', @ago) ORDER BY last_activity`,
      p(s, { ago: `-${STALE_DAYS} days` })),
  };
}

export function quickSearch(s: Scope, q: string) {
  const like = `%${q}%`;
  return [
    ...all(`SELECT 'contact' AS kind, id, name AS label, email AS sub FROM contacts WHERE client_id = @c AND (name LIKE @q OR email LIKE @q) LIMIT 5`, p(s, { q: like })),
    ...all(`SELECT 'company' AS kind, id, name AS label, industry AS sub FROM companies WHERE client_id = @c AND name LIKE @q LIMIT 5`, p(s, { q: like })),
    ...all(`SELECT 'deal' AS kind, id, title AS label, '' AS sub FROM deals WHERE client_id = @c AND title LIKE @q LIMIT 5`, p(s, { q: like })),
  ];
}

export function exportData(s: Scope) {
  return {
    client: one('SELECT id, name, contact_email, status, start_date FROM clients WHERE id = @c', p(s)),
    stages: stages(),
    companies: all('SELECT * FROM companies WHERE client_id = @c', p(s)),
    contacts: all('SELECT * FROM contacts WHERE client_id = @c', p(s)),
    deals: all('SELECT * FROM deals WHERE client_id = @c', p(s)),
    tasks: all('SELECT * FROM tasks WHERE client_id = @c', p(s)),
    activities: all('SELECT * FROM activities WHERE client_id = @c', p(s)),
  };
}

export function nbaKey(s: Scope, dealId: number): string {
  const d = one('SELECT stage_id, value, close_date FROM deals WHERE id = @id AND client_id = @c', p(s, { id: dealId }));
  if (!d) return '';
  const a = one('SELECT COUNT(*) n, COALESCE(MAX(id), 0) m FROM activities WHERE deal_id = @id AND client_id = @c', p(s, { id: dealId }))!;
  const t = one('SELECT COUNT(*) n, COALESCE(MAX(id), 0) m FROM tasks WHERE deal_id = @id AND client_id = @c AND done = 0', p(s, { id: dealId }))!;
  return [d.stage_id, d.value, d.close_date, a.n, a.m, t.n, t.m].join('|');
}

// ---------- name lookups (AI tools, CSV import, inline company edit) ----------
export const companyByName = (s: Scope, name: string) =>
  one('SELECT * FROM companies WHERE client_id = @c AND lower(name) = lower(@n)', p(s, { n: name.trim() }));
export const contactByName = (s: Scope, name: string) =>
  one('SELECT * FROM contacts WHERE client_id = @c AND lower(name) = lower(@n)', p(s, { n: name.trim() }));
export function dealsByTitle(s: Scope, ref: string) {
  const exact = all('SELECT id, title FROM deals WHERE client_id = @c AND lower(title) = lower(@r)', p(s, { r: ref }));
  return exact.length ? exact : all('SELECT id, title FROM deals WHERE client_id = @c AND title LIKE @r', p(s, { r: `%${ref}%` }));
}

// ---------- AI read tools ----------
export type SearchFilter = {
  type: 'contacts' | 'companies' | 'deals' | 'tasks'; query?: string | null; stage?: string | null;
  close_from?: string | null; close_to?: string | null; due_from?: string | null; due_to?: string | null;
  inactive_days?: number | null; open_only?: boolean | null; include_done?: boolean | null;
};

export function searchRecords(s: Scope, f: SearchFilter) {
  const where: string[] = [];
  const params: Row = p(s);
  const q = f.query ? `%${f.query}%` : null;
  if (q) params.q = q;
  const W = () => (where.length ? ` AND ${where.join(' AND ')}` : '');
  if (f.inactive_days) params.ago = `-${Math.floor(f.inactive_days)} days`;

  if (f.type === 'contacts') {
    if (q) where.push('(name LIKE @q OR email LIKE @q OR company LIKE @q OR title LIKE @q)');
    if (f.inactive_days) where.push(`(last_activity IS NULL OR last_activity < datetime('now', @ago))`);
    return all(`SELECT id, name, email, phone, title, company, owner, last_activity FROM (${CONTACTS}) WHERE 1=1${W()} ORDER BY last_activity LIMIT 50`, params);
  }
  if (f.type === 'companies') {
    if (q) where.push('(name LIKE @q OR industry LIKE @q OR notes LIKE @q)');
    return all(`SELECT id, name, website, industry, size, notes, contact_count FROM (${COMPANIES}) WHERE 1=1${W()} ORDER BY name LIMIT 50`, params);
  }
  if (f.type === 'deals') {
    if (q) where.push('(title LIKE @q OR company LIKE @q OR contact LIKE @q)');
    if (f.stage) { where.push('lower(stage) = lower(@stage)'); params.stage = f.stage; }
    if (f.close_from) { where.push('close_date >= @cf'); params.cf = f.close_from; }
    if (f.close_to) { where.push('close_date <= @ct'); params.ct = f.close_to; }
    if (f.open_only) where.push(`lower(stage) NOT IN (${closed})`);
    if (f.inactive_days) where.push(`last_activity < datetime('now', @ago)`);
    return all(`SELECT id, title, value, stage, company, contact, close_date, last_activity FROM (${DEALS}) WHERE 1=1${W()} ORDER BY close_date LIMIT 50`, params);
  }
  if (!f.include_done) where.push('t.done = 0');
  if (q) where.push('(t.title LIKE @q OR c.name LIKE @q OR d.title LIKE @q)');
  if (f.due_from) { where.push('t.due_date >= @df'); params.df = f.due_from; }
  if (f.due_to) { where.push('t.due_date <= @dt'); params.dt = f.due_to; }
  return all(`SELECT t.id, t.title, t.due_date, t.done, c.name AS contact, d.title AS deal FROM tasks t
    LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN deals d ON d.id = t.deal_id
    WHERE t.client_id = @c${W()} ORDER BY t.due_date LIMIT 50`, params);
}

export function accountSummary(s: Scope, f: { company?: string | null; contact?: string | null }) {
  if (f.company) {
    const co = one(`${COMPANIES} AND co.name LIKE @n LIMIT 1`, p(s, { n: `%${f.company}%` }));
    if (!co) return { error: `No company matching "${f.company}"` };
    const id = co.id;
    return {
      company: co,
      contacts: all(`SELECT name, title, email, last_activity FROM (${CONTACTS}) WHERE company_id = @id`, p(s, { id })),
      deals: all(`SELECT title, value, stage, contact, close_date, last_activity FROM (${DEALS}) WHERE company_id = @id`, p(s, { id })),
      open_tasks: all(`SELECT t.title, t.due_date FROM (${TASKS}) t WHERE t.done = 0 AND (t.contact_id IN (SELECT id FROM contacts WHERE company_id = @id) OR t.deal_id IN (SELECT id FROM deals WHERE company_id = @id))`, p(s, { id })),
      timeline: all('SELECT type, body, created_at FROM activities WHERE client_id = @c AND company_id = @id ORDER BY created_at DESC LIMIT 25', p(s, { id })),
    };
  }
  if (f.contact) {
    const ct = one(`${CONTACTS} AND c.name LIKE @n LIMIT 1`, p(s, { n: `%${f.contact}%` }));
    if (!ct) return { error: `No contact matching "${f.contact}"` };
    const id = ct.id;
    return {
      contact: ct,
      deals: all(`SELECT title, value, stage, close_date, last_activity FROM (${DEALS}) WHERE contact_id = @id`, p(s, { id })),
      open_tasks: all('SELECT title, due_date FROM tasks WHERE client_id = @c AND done = 0 AND contact_id = @id', p(s, { id })),
      timeline: all('SELECT type, body, created_at FROM activities WHERE client_id = @c AND contact_id = @id ORDER BY created_at DESC LIMIT 25', p(s, { id })),
    };
  }
  return { error: 'Give a company or contact name.' };
}

export function researchSubject(s: Scope, kind: 'company' | 'contact', id: number) {
  if (kind === 'company') return one('SELECT * FROM companies WHERE id = @id AND client_id = @c', p(s, { id }));
  return one(`SELECT c.*, co.name company, co.website FROM contacts c LEFT JOIN companies co ON co.id = c.company_id
              WHERE c.id = @id AND c.client_id = @c`, p(s, { id }));
}
