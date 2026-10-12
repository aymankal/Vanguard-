// Scoped writes, shared by the REST API and confirmed AI actions. Every insert sets client_id from the
// scope, and every referenced id is checked to belong to the same client.
import { db, findStageByName, MEETING_STATUSES, type Row } from './db.js';
import { owns, companyByName, contactByName } from './repo.js';
import { assertCanWrite, type Scope } from './scope.js';

export class UserError extends Error {}

const str = (v: unknown) => (v == null ? '' : String(v).trim());
const dateOrNull = (v: unknown) => {
  const s = str(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new UserError(`"${s}" is not a date (use YYYY-MM-DD).`);
  return s;
};
/** Validate a foreign id belongs to this client. Returns null for empty. */
function ref(s: Scope, table: 'companies' | 'contacts' | 'deals', v: unknown): number | null {
  if (v == null || v === '' || v === 0) return null;
  if (!owns(s, table, v)) throw new UserError(`${table.slice(0, -1).replace('companie', 'company')} not found.`);
  return Number(v);
}

export function resolveCompany(s: Scope, name: unknown, create = true): number | null {
  const n = str(name);
  if (!n) return null;
  const found = companyByName(s, n);
  if (found) return found.id as number;
  return create ? createCompany(s, { name: n }) : null;
}

export function resolveContact(s: Scope, name: unknown): number | null {
  const n = str(name);
  if (!n) return null;
  const found = contactByName(s, n);
  if (!found) throw new UserError(`No contact named "${n}".`);
  return found.id as number;
}

export function resolveStage(name: unknown): number {
  const st = findStageByName(str(name));
  if (!st) throw new UserError(`No pipeline stage named "${str(name)}".`);
  return st.id;
}

export function createCompany(s: Scope, c: Row): number {
  assertCanWrite(s);
  const name = str(c.name);
  if (!name) throw new UserError('Company name is required.');
  const existing = companyByName(s, name);
  if (existing) return existing.id as number;
  return db
    .prepare('INSERT INTO companies (client_id, name, website, industry, size, notes) VALUES (?,?,?,?,?,?)')
    .run(s.clientId, name, str(c.website), str(c.industry), str(c.size), str(c.notes)).lastInsertRowid as number;
}

export function createContact(s: Scope, c: Row): number {
  assertCanWrite(s);
  const name = str(c.name);
  if (!name) throw new UserError('Contact name is required.');
  const company_id = c.company_id != null ? ref(s, 'companies', c.company_id) : resolveCompany(s, c.company);
  return db
    .prepare('INSERT INTO contacts (client_id, name, email, phone, title, company_id, owner) VALUES (?,?,?,?,?,?,?)')
    .run(s.clientId, name, str(c.email), str(c.phone), str(c.title), company_id, str(c.owner)).lastInsertRowid as number;
}

export function firstStageId(): number {
  return (db.prepare('SELECT id FROM stages ORDER BY position LIMIT 1').get() as { id: number }).id;
}

export function createDeal(s: Scope, d: Row): number {
  assertCanWrite(s);
  const title = str(d.title);
  if (!title) throw new UserError('Deal title is required.');
  const stage_id = d.stage_id != null ? Number(d.stage_id) : d.stage ? resolveStage(d.stage) : firstStageId();
  if (!db.prepare('SELECT 1 FROM stages WHERE id = ?').get(stage_id)) throw new UserError('Stage not found.');
  let company_id = d.company_id != null ? ref(s, 'companies', d.company_id) : resolveCompany(s, d.company);
  const contact_id = d.contact_id != null ? ref(s, 'contacts', d.contact_id) : resolveContact(s, d.contact);
  if (!company_id && contact_id) {
    company_id = ((db.prepare('SELECT company_id FROM contacts WHERE id = ? AND client_id = ?').get(contact_id, s.clientId) as Row)?.company_id as number) ?? null;
  }
  return db
    .prepare('INSERT INTO deals (client_id, title, value, stage_id, company_id, contact_id, close_date) VALUES (?,?,?,?,?,?,?)')
    .run(s.clientId, title, Number(d.value) || 0, stage_id, company_id, contact_id, dateOrNull(d.close_date)).lastInsertRowid as number;
}

export function logActivity(s: Scope, a: {
  type: string; body: string; contact_id?: number | null; company_id?: number | null; deal_id?: number | null;
  meeting_at?: string | null; meeting_status?: string | null;
}) {
  assertCanWrite(s);
  // Attach to the deal's contact/company too, so it shows on every related timeline.
  let { contact_id = null, company_id = null } = a;
  if (a.deal_id) {
    const d = db.prepare('SELECT contact_id, company_id FROM deals WHERE id = ? AND client_id = ?').get(a.deal_id, s.clientId) as Row | undefined;
    if (!d) throw new UserError('Deal not found.');
    contact_id ??= (d.contact_id as number) ?? null;
    company_id ??= (d.company_id as number) ?? null;
  }
  if (contact_id && !company_id) {
    const c = db.prepare('SELECT company_id FROM contacts WHERE id = ? AND client_id = ?').get(contact_id, s.clientId) as Row | undefined;
    company_id = (c?.company_id as number) ?? null;
  }
  return db
    .prepare(`INSERT INTO activities (client_id, user_id, type, body, contact_id, company_id, deal_id, meeting_at, meeting_status)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(s.clientId, s.userId, a.type, a.body, contact_id, company_id, a.deal_id ?? null, a.meeting_at ?? null, a.meeting_status ?? null)
    .lastInsertRowid as number;
}

export function setDealStage(s: Scope, dealId: number, stageId: number) {
  assertCanWrite(s);
  const deal = db.prepare('SELECT d.stage_id, st.name FROM deals d JOIN stages st ON st.id = d.stage_id WHERE d.id = ? AND d.client_id = ?')
    .get(dealId, s.clientId) as { stage_id: number; name: string } | undefined;
  if (!deal) throw new UserError('Deal not found.');
  if (deal.stage_id === stageId) return;
  const next = db.prepare('SELECT name FROM stages WHERE id = ?').get(stageId) as { name: string } | undefined;
  if (!next) throw new UserError('Stage not found.');
  db.prepare('UPDATE deals SET stage_id = ? WHERE id = ? AND client_id = ?').run(stageId, dealId, s.clientId);
  logActivity(s, { type: 'stage_change', body: `Stage: ${deal.name} → ${next.name}`, deal_id: dealId });
}

export function createTask(s: Scope, t: Row): number {
  assertCanWrite(s);
  const title = str(t.title);
  if (!title) throw new UserError('Task title is required.');
  return db
    .prepare('INSERT INTO tasks (client_id, title, due_date, contact_id, deal_id) VALUES (?,?,?,?,?)')
    .run(s.clientId, title, dateOrNull(t.due_date), ref(s, 'contacts', t.contact_id), ref(s, 'deals', t.deal_id))
    .lastInsertRowid as number;
}

export function setTaskDone(s: Scope, id: number, done: boolean) {
  assertCanWrite(s);
  const t = db.prepare('SELECT * FROM tasks WHERE id = ? AND client_id = ?').get(id, s.clientId) as Row | undefined;
  if (!t) throw new UserError('Task not found.');
  if (Boolean(t.done) === done) return;
  db.prepare('UPDATE tasks SET done = ? WHERE id = ? AND client_id = ?').run(done ? 1 : 0, id, s.clientId);
  if (done) logActivity(s, { type: 'task_done', body: `Task done: ${t.title}`, contact_id: t.contact_id as number, deal_id: t.deal_id as number });
}

/** Types a person can log by hand (stage changes and task completions are automatic). */
export const LOGGABLE = ['note', 'email', 'call_connected', 'call_no_answer', 'call_voicemail', 'linkedin', 'meeting_booked'] as const;
const DEFAULT_BODY: Record<string, string> = {
  call_connected: 'Call — connected', call_no_answer: 'Call — no answer', call_voicemail: 'Call — left voicemail',
  email: 'Email sent', linkedin: 'LinkedIn message', meeting_booked: 'Meeting booked',
};

export function addActivity(s: Scope, a: Row): number {
  assertCanWrite(s);
  const type = str(a.type) || 'note';
  if (!(LOGGABLE as readonly string[]).includes(type)) throw new UserError('That activity type can’t be logged by hand.');
  const body = str(a.body) || DEFAULT_BODY[type] || '';
  if (!body) throw new UserError('Note is empty.');
  const contact_id = ref(s, 'contacts', a.contact_id);
  const company_id = ref(s, 'companies', a.company_id);
  const deal_id = ref(s, 'deals', a.deal_id);
  if (!contact_id && !company_id && !deal_id) throw new UserError('An activity needs a contact, company or deal.');
  let meeting_at: string | null = null;
  if (type === 'meeting_booked') {
    meeting_at = str(a.meeting_at) || null;
    if (meeting_at && !/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/.test(meeting_at)) throw new UserError('Meeting date must be YYYY-MM-DD HH:MM.');
  }
  return logActivity(s, { type, body, contact_id, company_id, deal_id, meeting_at: meeting_at?.replace('T', ' ') ?? null, meeting_status: type === 'meeting_booked' ? 'booked' : null });
}

export function updateMeeting(s: Scope, id: number, body: Row) {
  assertCanWrite(s);
  const a = db.prepare("SELECT type FROM activities WHERE id = ? AND client_id = ?").get(id, s.clientId) as Row | undefined;
  if (!a || a.type !== 'meeting_booked') throw new UserError('Meeting not found.');
  if ('meeting_status' in body) {
    if (!(MEETING_STATUSES as readonly string[]).includes(str(body.meeting_status))) throw new UserError('Unknown meeting status.');
    db.prepare('UPDATE activities SET meeting_status = ? WHERE id = ? AND client_id = ?').run(str(body.meeting_status), id, s.clientId);
  }
  if ('meeting_at' in body) {
    db.prepare('UPDATE activities SET meeting_at = ? WHERE id = ? AND client_id = ?').run(str(body.meeting_at).replace('T', ' ') || null, id, s.clientId);
  }
}

/** Undo a hand-logged activity. */
export function deleteActivity(s: Scope, id: number) {
  assertCanWrite(s);
  const r = db.prepare(`DELETE FROM activities WHERE id = ? AND client_id = ? AND type IN (${LOGGABLE.map((t) => `'${t}'`).join(',')})`).run(id, s.clientId);
  if (!r.changes) throw new UserError('Activity not found.');
}

export function deleteRecord(s: Scope, table: 'companies' | 'contacts' | 'deals' | 'tasks', id: number) {
  assertCanWrite(s);
  const r = db.prepare(`DELETE FROM ${table} WHERE id = ? AND client_id = ?`).run(id, s.clientId);
  if (!r.changes) throw new UserError('Record not found.');
}

/** Whitelisted PATCH, scoped to the client. */
export function patch(s: Scope, table: 'companies' | 'contacts' | 'deals' | 'tasks', id: number, body: Row) {
  assertCanWrite(s);
  const allowed: Record<string, string[]> = {
    companies: ['name', 'website', 'industry', 'size', 'notes'],
    contacts: ['name', 'email', 'phone', 'title', 'owner', 'company_id'],
    deals: ['title', 'value', 'close_date', 'company_id', 'contact_id'],
    tasks: ['title', 'due_date', 'contact_id', 'deal_id'],
  };
  if (!owns(s, table, id)) throw new UserError('Record not found.');
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed[table]) {
    if (!(k in body)) continue;
    let v = body[k];
    if (k.endsWith('_id')) v = ref(s, k === 'company_id' ? 'companies' : k === 'contact_id' ? 'contacts' : 'deals', v);
    else if (k === 'value') v = Number(v) || 0;
    else if (k.endsWith('_date')) v = dateOrNull(v);
    else v = str(v);
    if ((k === 'name' || k === 'title') && !v) throw new UserError(`${k} can't be empty.`);
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (table === 'contacts' && 'company' in body) {
    sets.push('company_id = ?');
    vals.push(resolveCompany(s, body.company));
  }
  if (!sets.length) return;
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`).run(...vals, id, s.clientId);
}
