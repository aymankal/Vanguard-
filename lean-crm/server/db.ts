import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from './config.js';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  owner TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  close_date TEXT,
  nba_text TEXT,
  nba_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  due_date TEXT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('note','email','stage_change','task_done')),
  body TEXT NOT NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(done, due_date);
CREATE INDEX IF NOT EXISTS idx_act_deal ON activities(deal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_act_contact ON activities(contact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_act_company ON activities(company_id, created_at);
`);

export type Row = Record<string, unknown>;

export const today = () => new Date().toISOString().slice(0, 10);

/** SQL fragments reused by API and AI tools. */
export const DEAL_SELECT = `
  SELECT d.id, d.title, d.value, d.stage_id, s.name AS stage, d.company_id, co.name AS company,
         d.contact_id, ct.name AS contact, d.close_date, d.nba_text, d.nba_key, d.created_at,
         COALESCE((SELECT MAX(a.created_at) FROM activities a WHERE a.deal_id = d.id), d.created_at) AS last_activity
  FROM deals d
  JOIN stages s ON s.id = d.stage_id
  LEFT JOIN companies co ON co.id = d.company_id
  LEFT JOIN contacts ct ON ct.id = d.contact_id`;

export const CONTACT_SELECT = `
  SELECT c.id, c.name, c.email, c.phone, c.title, c.company_id, co.name AS company, c.owner, c.created_at,
         (SELECT MAX(a.created_at) FROM activities a WHERE a.contact_id = c.id
            OR a.deal_id IN (SELECT id FROM deals WHERE contact_id = c.id)) AS last_activity
  FROM contacts c LEFT JOIN companies co ON co.id = c.company_id`;

export const COMPANY_SELECT = `
  SELECT co.id, co.name, co.website, co.industry, co.size, co.notes, co.created_at,
         (SELECT COUNT(*) FROM contacts c WHERE c.company_id = co.id) AS contact_count
  FROM companies co`;

/** Stage names treated as closed (not shown as stale, excluded from "open" pipeline). */
export const CLOSED_STAGE_NAMES = ['won', 'lost'];

export function isClosedStage(stageId: number): boolean {
  const s = db.prepare('SELECT name FROM stages WHERE id = ?').get(stageId) as { name: string } | undefined;
  return !!s && CLOSED_STAGE_NAMES.includes(s.name.toLowerCase());
}

export function logActivity(a: { type: string; body: string; contact_id?: number | null; company_id?: number | null; deal_id?: number | null }) {
  // Attach to the deal's contact/company too, so it shows on every related timeline.
  let { contact_id = null, company_id = null } = a;
  if (a.deal_id) {
    const d = db.prepare('SELECT contact_id, company_id FROM deals WHERE id = ?').get(a.deal_id) as Row | undefined;
    contact_id ??= (d?.contact_id as number) ?? null;
    company_id ??= (d?.company_id as number) ?? null;
  }
  if (contact_id && !company_id) {
    const c = db.prepare('SELECT company_id FROM contacts WHERE id = ?').get(contact_id) as Row | undefined;
    company_id = (c?.company_id as number) ?? null;
  }
  return db
    .prepare('INSERT INTO activities (type, body, contact_id, company_id, deal_id) VALUES (?, ?, ?, ?, ?)')
    .run(a.type, a.body, contact_id, company_id, a.deal_id ?? null).lastInsertRowid as number;
}

export function findCompanyByName(name: string) {
  return db.prepare('SELECT * FROM companies WHERE lower(name) = lower(?)').get(name.trim()) as Row | undefined;
}
export function findContactByName(name: string) {
  return db.prepare('SELECT * FROM contacts WHERE lower(name) = lower(?)').get(name.trim()) as Row | undefined;
}
export function findStageByName(name: string) {
  return db.prepare('SELECT * FROM stages WHERE lower(name) = lower(?)').get(name.trim()) as { id: number; name: string } | undefined;
}

export function nbaKey(dealId: number): string {
  const d = db.prepare('SELECT stage_id, value, close_date FROM deals WHERE id = ?').get(dealId) as Row | undefined;
  if (!d) return '';
  const a = db.prepare('SELECT COUNT(*) n, COALESCE(MAX(id), 0) m FROM activities WHERE deal_id = ?').get(dealId) as Row;
  const t = db.prepare('SELECT COUNT(*) n, COALESCE(MAX(id), 0) m FROM tasks WHERE deal_id = ? AND done = 0').get(dealId) as Row;
  return [d.stage_id, d.value, d.close_date, a.n, a.m, t.n, t.m].join('|');
}
