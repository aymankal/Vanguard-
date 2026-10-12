import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from './config.js';

export type DB = Database.Database;
export type Row = Record<string, unknown>;

/** Schema as shipped in v1 (single user). Kept verbatim so old databases and fresh ones take the same path. */
export const V1_SQL = `
CREATE TABLE IF NOT EXISTS stages (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, website TEXT NOT NULL DEFAULT '', industry TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '', company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  owner TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, value REAL NOT NULL DEFAULT 0, stage_id INTEGER NOT NULL REFERENCES stages(id),
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL, contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  close_date TEXT, nba_text TEXT, nba_key TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, due_date TEXT, contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('note','email','stage_change','task_done')), body TEXT NOT NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

export const ACTIVITY_TYPES = [
  'note', 'email', 'stage_change', 'task_done',
  'call_connected', 'call_no_answer', 'call_voicemail', 'linkedin', 'meeting_booked',
] as const;
export const MEETING_STATUSES = ['booked', 'held', 'no_show', 'cancelled'] as const;

/** v2: Agency Mode. Every record gets a client_id; existing rows go to client 1 ("My workspace"). */
const V2_SQL = `
CREATE TABLE clients (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, logo_url TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')), start_date TEXT,
  health_key TEXT, health_text TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO clients (id, name, start_date) VALUES (1, 'My workspace', date('now'));

CREATE TABLE users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
  password_hash TEXT, role TEXT NOT NULL CHECK (role IN ('owner','rep','client')),
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  invite_token_hash TEXT, invite_expires TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((role = 'client') = (client_id IS NOT NULL)));
CREATE TABLE user_clients (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE, PRIMARY KEY (user_id, client_id));
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE weekly_reports (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL, week_end TEXT NOT NULL, metrics_json TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '', blockers TEXT NOT NULL DEFAULT '', plan TEXT NOT NULL DEFAULT '', ai_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent')), sent_at TEXT, sent_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (client_id, week_start));

CREATE TABLE companies_v2 (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, website TEXT NOT NULL DEFAULT '', industry TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO companies_v2 SELECT id, 1, name, website, industry, size, notes, created_at FROM companies;

CREATE TABLE contacts_v2 (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL, owner TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO contacts_v2 SELECT id, 1, name, email, phone, title, company_id, owner, created_at FROM contacts;

CREATE TABLE deals_v2 (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL, value REAL NOT NULL DEFAULT 0, stage_id INTEGER NOT NULL REFERENCES stages(id),
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL, contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  close_date TEXT, nba_text TEXT, nba_key TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO deals_v2 SELECT id, 1, title, value, stage_id, company_id, contact_id, close_date, nba_text, nba_key, created_at FROM deals;

CREATE TABLE tasks_v2 (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL, due_date TEXT, contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE, done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO tasks_v2 SELECT id, 1, title, due_date, contact_id, deal_id, done, created_at FROM tasks;

CREATE TABLE activities_v2 (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN (${ACTIVITY_TYPES.map((t) => `'${t}'`).join(',')})),
  body TEXT NOT NULL DEFAULT '',
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  meeting_at TEXT, meeting_status TEXT CHECK (meeting_status IN (${MEETING_STATUSES.map((t) => `'${t}'`).join(',')})),
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO activities_v2 (id, client_id, type, body, contact_id, company_id, deal_id, created_at)
  SELECT id, 1, type, body, contact_id, company_id, deal_id, created_at FROM activities;

DROP TABLE activities; DROP TABLE tasks; DROP TABLE deals; DROP TABLE contacts; DROP TABLE companies;
ALTER TABLE companies_v2 RENAME TO companies;
ALTER TABLE contacts_v2 RENAME TO contacts;
ALTER TABLE deals_v2 RENAME TO deals;
ALTER TABLE tasks_v2 RENAME TO tasks;
ALTER TABLE activities_v2 RENAME TO activities;

CREATE INDEX idx_companies_client ON companies(client_id, name);
CREATE INDEX idx_contacts_client ON contacts(client_id, name);
CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_deals_client ON deals(client_id, stage_id);
CREATE INDEX idx_deals_company ON deals(company_id);
CREATE INDEX idx_deals_contact ON deals(contact_id);
CREATE INDEX idx_tasks_client ON tasks(client_id, done, due_date);
CREATE INDEX idx_act_client ON activities(client_id, created_at);
CREATE INDEX idx_act_user ON activities(user_id, created_at);
CREATE INDEX idx_act_deal ON activities(deal_id, created_at);
CREATE INDEX idx_act_contact ON activities(contact_id, created_at);
CREATE INDEX idx_act_company ON activities(company_id, created_at);
`;

const MIGRATIONS: string[] = [V1_SQL, V2_SQL];

/** Bring a database to the latest schema. Each step runs in one transaction; data is copied, never dropped. */
export function migrate(d: DB) {
  const from = d.pragma('user_version', { simple: true }) as number;
  if (from >= MIGRATIONS.length) return;
  d.pragma('foreign_keys = OFF'); // required to rebuild tables (SQLite docs, "12-step" ALTER procedure)
  try {
    for (let v = from; v < MIGRATIONS.length; v++) {
      d.transaction(() => {
        d.exec(MIGRATIONS[v]);
        const broken = d.pragma('foreign_key_check') as unknown[];
        if (broken.length) throw new Error(`Migration ${v + 1} left ${broken.length} broken references`);
        d.pragma(`user_version = ${v + 1}`);
      })();
    }
  } finally {
    d.pragma('foreign_keys = ON');
  }
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db: DB = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
migrate(db);
db.pragma('foreign_keys = ON');

export const today = () => new Date().toISOString().slice(0, 10);

export function getSetting(key: string, fallback = ''): string {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? fallback;
}
export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
export const agencyMode = () => getSetting('agency_mode', '0') === '1';

/** Stage names treated as closed (not shown as stale, excluded from "open" pipeline). */
export const CLOSED_STAGE_NAMES = ['won', 'lost'];
export function findStageByName(name: string) {
  return db.prepare('SELECT * FROM stages WHERE lower(name) = lower(?)').get(name.trim()) as { id: number; name: string } | undefined;
}
