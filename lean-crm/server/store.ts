// Write operations shared by the REST API and confirmed AI actions.
import { db, logActivity, findCompanyByName, findContactByName, findStageByName, type Row } from './db.js';

export class UserError extends Error {}

const str = (v: unknown) => (v == null ? '' : String(v).trim());
const dateOrNull = (v: unknown) => {
  const s = str(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new UserError(`"${s}" is not a date (use YYYY-MM-DD).`);
  return s;
};

export function resolveCompany(name: unknown, create = true): number | null {
  const n = str(name);
  if (!n) return null;
  const found = findCompanyByName(n);
  if (found) return found.id as number;
  return create ? createCompany({ name: n }) : null;
}

export function resolveContact(name: unknown): number | null {
  const n = str(name);
  if (!n) return null;
  const found = findContactByName(n);
  if (!found) throw new UserError(`No contact named "${n}".`);
  return found.id as number;
}

export function resolveStage(name: unknown): number {
  const s = findStageByName(str(name));
  if (!s) throw new UserError(`No pipeline stage named "${str(name)}".`);
  return s.id;
}

export function createCompany(c: Row): number {
  const name = str(c.name);
  if (!name) throw new UserError('Company name is required.');
  const existing = findCompanyByName(name);
  if (existing) return existing.id as number;
  return db
    .prepare('INSERT INTO companies (name, website, industry, size, notes) VALUES (?,?,?,?,?)')
    .run(name, str(c.website), str(c.industry), str(c.size), str(c.notes)).lastInsertRowid as number;
}

export function createContact(c: Row): number {
  const name = str(c.name);
  if (!name) throw new UserError('Contact name is required.');
  const company_id = c.company_id != null ? Number(c.company_id) || null : resolveCompany(c.company);
  return db
    .prepare('INSERT INTO contacts (name, email, phone, title, company_id, owner) VALUES (?,?,?,?,?,?)')
    .run(name, str(c.email), str(c.phone), str(c.title), company_id, str(c.owner)).lastInsertRowid as number;
}

export function createDeal(d: Row): number {
  const title = str(d.title);
  if (!title) throw new UserError('Deal title is required.');
  const stage_id = d.stage_id != null ? Number(d.stage_id) : d.stage ? resolveStage(d.stage) : firstStageId();
  const company_id = d.company_id != null ? Number(d.company_id) || null : resolveCompany(d.company);
  let contact_id = d.contact_id != null ? Number(d.contact_id) || null : resolveContact(d.contact);
  if (!company_id && contact_id) {
    // inherit company from contact
    const ct = db.prepare('SELECT company_id FROM contacts WHERE id = ?').get(contact_id) as Row;
    return insertDeal(title, d.value, stage_id, (ct?.company_id as number) ?? null, contact_id, d.close_date);
  }
  return insertDeal(title, d.value, stage_id, company_id, contact_id, d.close_date);
}

function insertDeal(title: string, value: unknown, stage_id: number, company_id: number | null, contact_id: number | null, close: unknown) {
  return db
    .prepare('INSERT INTO deals (title, value, stage_id, company_id, contact_id, close_date) VALUES (?,?,?,?,?,?)')
    .run(title, Number(value) || 0, stage_id, company_id, contact_id, dateOrNull(close)).lastInsertRowid as number;
}

export function firstStageId(): number {
  return (db.prepare('SELECT id FROM stages ORDER BY position LIMIT 1').get() as { id: number }).id;
}

export function setDealStage(dealId: number, stageId: number) {
  const deal = db.prepare('SELECT d.stage_id, s.name FROM deals d JOIN stages s ON s.id = d.stage_id WHERE d.id = ?').get(dealId) as
    | { stage_id: number; name: string }
    | undefined;
  if (!deal) throw new UserError('Deal not found.');
  if (deal.stage_id === stageId) return;
  const next = db.prepare('SELECT name FROM stages WHERE id = ?').get(stageId) as { name: string } | undefined;
  if (!next) throw new UserError('Stage not found.');
  db.prepare('UPDATE deals SET stage_id = ? WHERE id = ?').run(stageId, dealId);
  logActivity({ type: 'stage_change', body: `Stage: ${deal.name} → ${next.name}`, deal_id: dealId });
}

export function createTask(t: Row): number {
  const title = str(t.title);
  if (!title) throw new UserError('Task title is required.');
  return db
    .prepare('INSERT INTO tasks (title, due_date, contact_id, deal_id) VALUES (?,?,?,?)')
    .run(title, dateOrNull(t.due_date), t.contact_id ? Number(t.contact_id) : null, t.deal_id ? Number(t.deal_id) : null)
    .lastInsertRowid as number;
}

export function setTaskDone(id: number, done: boolean) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
  if (!t) throw new UserError('Task not found.');
  if (Boolean(t.done) === done) return;
  db.prepare('UPDATE tasks SET done = ? WHERE id = ?').run(done ? 1 : 0, id);
  if (done) {
    logActivity({ type: 'task_done', body: `Task done: ${t.title}`, contact_id: t.contact_id as number, deal_id: t.deal_id as number });
  }
}

export function addActivity(a: Row): number {
  const type = str(a.type) || 'note';
  if (!['note', 'email'].includes(type)) throw new UserError('Only notes and emails can be logged by hand.');
  const body = str(a.body);
  if (!body) throw new UserError('Note is empty.');
  const id = (k: string) => (a[k] ? Number(a[k]) : null);
  if (!id('contact_id') && !id('company_id') && !id('deal_id')) throw new UserError('A note needs a contact, company or deal.');
  return logActivity({ type, body, contact_id: id('contact_id'), company_id: id('company_id'), deal_id: id('deal_id') });
}

/** Whitelisted PATCH. Returns the fields changed. */
export function patch(table: 'companies' | 'contacts' | 'deals' | 'tasks', id: number, body: Row) {
  const allowed: Record<string, string[]> = {
    companies: ['name', 'website', 'industry', 'size', 'notes'],
    contacts: ['name', 'email', 'phone', 'title', 'owner', 'company_id'],
    deals: ['title', 'value', 'close_date', 'company_id', 'contact_id'],
    tasks: ['title', 'due_date', 'contact_id', 'deal_id'],
  };
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed[table]) {
    if (!(k in body)) continue;
    let v = body[k];
    if (k.endsWith('_id')) v = v ? Number(v) : null;
    else if (k === 'value') v = Number(v) || 0;
    else if (k.endsWith('_date')) v = dateOrNull(v);
    else v = str(v);
    if (k === 'name' || k === 'title') if (!v) throw new UserError(`${k} can't be empty.`);
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  // contacts can set company by name (inline editing)
  if (table === 'contacts' && 'company' in body) {
    sets.push('company_id = ?');
    vals.push(resolveCompany(body.company));
  }
  if (!sets.length) return;
  const r = db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  if (!r.changes) throw new UserError('Record not found.');
}
