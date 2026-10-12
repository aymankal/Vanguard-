import { Router, type Request, type Response, type NextFunction } from 'express';
import { db, DEAL_SELECT, CONTACT_SELECT, COMPANY_SELECT, CLOSED_STAGE_NAMES, today, nbaKey, type Row } from './db.js';
import { STALE_DAYS } from './config.js';
import * as store from './store.js';

export const api = Router();

type H = (req: Request, res: Response) => unknown;
const h = (fn: H) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    next(e);
  }
};
const id = (req: Request) => Number(req.params.id);
const closedList = CLOSED_STAGE_NAMES.map((n) => `'${n}'`).join(',');

// ---------- Stages ----------
api.get('/stages', h(() => db.prepare('SELECT id, name, position FROM stages ORDER BY position').all()));
api.post('/stages', h((req) => {
  const name = String(req.body.name ?? '').trim();
  if (!name) throw new store.UserError('Stage name is required.');
  const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM stages').get() as { p: number }).p;
  try {
    return { id: db.prepare('INSERT INTO stages (name, position) VALUES (?, ?)').run(name, pos).lastInsertRowid };
  } catch {
    throw new store.UserError(`A stage named "${name}" already exists.`);
  }
}));
api.patch('/stages/:id', h((req) => {
  const name = String(req.body.name ?? '').trim();
  if (!name) throw new store.UserError('Stage name is required.');
  try {
    db.prepare('UPDATE stages SET name = ? WHERE id = ?').run(name, id(req));
  } catch {
    throw new store.UserError(`A stage named "${name}" already exists.`);
  }
  return { ok: true };
}));
api.post('/stages/reorder', h((req) => {
  const ids: number[] = req.body.ids ?? [];
  const up = db.prepare('UPDATE stages SET position = ? WHERE id = ?');
  db.transaction(() => ids.forEach((sid, i) => up.run(i, sid)))();
  return { ok: true };
}));
api.delete('/stages/:id', h((req) => {
  const n = (db.prepare('SELECT COUNT(*) n FROM deals WHERE stage_id = ?').get(id(req)) as { n: number }).n;
  if (n) throw new store.UserError(`Move the ${n} deal(s) out of this stage first.`);
  if ((db.prepare('SELECT COUNT(*) n FROM stages').get() as { n: number }).n <= 1) throw new store.UserError('You need at least one stage.');
  db.prepare('DELETE FROM stages WHERE id = ?').run(id(req));
  return { ok: true };
}));

// ---------- Companies ----------
api.get('/companies', h(() => db.prepare(`${COMPANY_SELECT} ORDER BY co.name COLLATE NOCASE`).all()));
api.get('/companies/:id', h((req) => {
  const company = db.prepare(`${COMPANY_SELECT} WHERE co.id = ?`).get(id(req));
  if (!company) throw new store.UserError('Company not found.');
  return {
    company,
    contacts: db.prepare(`${CONTACT_SELECT} WHERE c.company_id = ? ORDER BY c.name`).all(id(req)),
    deals: db.prepare(`${DEAL_SELECT} WHERE d.company_id = ? ORDER BY d.created_at DESC`).all(id(req)),
    tasks: db.prepare(`SELECT t.* FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN deals d ON d.id = t.deal_id
                       WHERE (c.company_id = ? OR d.company_id = ?) ORDER BY t.done, t.due_date`).all(id(req), id(req)),
    activities: db.prepare('SELECT * FROM activities WHERE company_id = ? ORDER BY created_at DESC, id DESC').all(id(req)),
  };
}));
api.post('/companies', h((req) => ({ id: store.createCompany(req.body) })));
api.patch('/companies/:id', h((req) => (store.patch('companies', id(req), req.body), { ok: true })));
api.delete('/companies/:id', h((req) => (db.prepare('DELETE FROM companies WHERE id = ?').run(id(req)), { ok: true })));

// ---------- Contacts ----------
api.get('/contacts', h(() => db.prepare(`${CONTACT_SELECT} ORDER BY c.name COLLATE NOCASE`).all()));
api.get('/contacts/:id', h((req) => {
  const contact = db.prepare(`${CONTACT_SELECT} WHERE c.id = ?`).get(id(req));
  if (!contact) throw new store.UserError('Contact not found.');
  return {
    contact,
    deals: db.prepare(`${DEAL_SELECT} WHERE d.contact_id = ? ORDER BY d.created_at DESC`).all(id(req)),
    tasks: db.prepare('SELECT * FROM tasks WHERE contact_id = ? OR deal_id IN (SELECT id FROM deals WHERE contact_id = ?) ORDER BY done, due_date').all(id(req), id(req)),
    activities: db.prepare('SELECT * FROM activities WHERE contact_id = ? ORDER BY created_at DESC, id DESC').all(id(req)),
  };
}));
api.post('/contacts', h((req) => ({ id: store.createContact(req.body) })));
api.patch('/contacts/:id', h((req) => (store.patch('contacts', id(req), req.body), { ok: true })));
api.delete('/contacts/:id', h((req) => (db.prepare('DELETE FROM contacts WHERE id = ?').run(id(req)), { ok: true })));

// ---------- Deals ----------
api.get('/deals', h(() =>
  (db.prepare(`${DEAL_SELECT} ORDER BY d.created_at DESC`).all() as Row[]).map(({ nba_key, ...d }) => ({
    ...d,
    nba_fresh: !!d.nba_text && nba_key === nbaKey(d.id as number),
  })),
));
api.get('/deals/:id', h((req) => {
  const deal = db.prepare(`${DEAL_SELECT} WHERE d.id = ?`).get(id(req));
  if (!deal) throw new store.UserError('Deal not found.');
  return {
    deal,
    tasks: db.prepare('SELECT * FROM tasks WHERE deal_id = ? ORDER BY done, due_date').all(id(req)),
    activities: db.prepare('SELECT * FROM activities WHERE deal_id = ? ORDER BY created_at DESC, id DESC').all(id(req)),
  };
}));
api.post('/deals', h((req) => ({ id: store.createDeal(req.body) })));
api.patch('/deals/:id', h((req) => {
  if (req.body.stage_id != null) store.setDealStage(id(req), Number(req.body.stage_id));
  store.patch('deals', id(req), req.body);
  return { ok: true };
}));
api.delete('/deals/:id', h((req) => (db.prepare('DELETE FROM deals WHERE id = ?').run(id(req)), { ok: true })));

// ---------- Tasks ----------
const TASK_SELECT = `SELECT t.*, c.name AS contact, d.title AS deal FROM tasks t
  LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN deals d ON d.id = t.deal_id`;
api.post('/tasks', h((req) => ({ id: store.createTask(req.body) })));
api.patch('/tasks/:id', h((req) => {
  if ('done' in req.body) store.setTaskDone(id(req), Boolean(req.body.done));
  store.patch('tasks', id(req), req.body);
  return { ok: true };
}));
api.delete('/tasks/:id', h((req) => (db.prepare('DELETE FROM tasks WHERE id = ?').run(id(req)), { ok: true })));

// ---------- Activities ----------
api.post('/activities', h((req) => ({ id: store.addActivity(req.body) })));

// ---------- Today ----------
api.get('/today', h(() => {
  const t = today();
  return {
    today: t,
    overdue: db.prepare(`${TASK_SELECT} WHERE t.done = 0 AND t.due_date < ? ORDER BY t.due_date`).all(t),
    due: db.prepare(`${TASK_SELECT} WHERE t.done = 0 AND t.due_date = ? ORDER BY t.id`).all(t),
    upcoming: db.prepare(`${TASK_SELECT} WHERE t.done = 0 AND t.due_date > ? AND t.due_date <= date(?, '+7 days') ORDER BY t.due_date`).all(t, t),
    stale: db.prepare(`SELECT * FROM (${DEAL_SELECT} WHERE lower(s.name) NOT IN (${closedList}))
                       WHERE last_activity < datetime('now', ?) ORDER BY last_activity`).all(`-${STALE_DAYS} days`),
  };
}));

// ---------- Search (global, for the command bar's quick-jump) ----------
api.get('/search', h((req) => {
  const q = `%${String(req.query.q ?? '').trim()}%`;
  return [
    ...(db.prepare(`SELECT 'contact' AS kind, id, name AS label, email AS sub FROM contacts WHERE name LIKE ? OR email LIKE ? LIMIT 5`).all(q, q) as Row[]),
    ...(db.prepare(`SELECT 'company' AS kind, id, name AS label, industry AS sub FROM companies WHERE name LIKE ? LIMIT 5`).all(q) as Row[]),
    ...(db.prepare(`SELECT 'deal' AS kind, id, title AS label, '' AS sub FROM deals WHERE title LIKE ? LIMIT 5`).all(q) as Row[]),
  ];
}));

// ---------- CSV import (client parses CSV, sends rows) ----------
api.post('/import/:kind', h((req) => {
  const rows: Row[] = Array.isArray(req.body.rows) ? req.body.rows : [];
  const kind = req.params.kind;
  if (kind !== 'contacts' && kind !== 'companies') throw new store.UserError('Import supports contacts or companies.');
  let created = 0;
  const skipped: string[] = [];
  const lower = (r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), v]));
  db.transaction(() => {
    rows.forEach((raw, i) => {
      const r = lower(raw);
      try {
        if (kind === 'contacts') store.createContact(r);
        else store.createCompany(r);
        created++;
      } catch (e) {
        skipped.push(`Row ${i + 2}: ${(e as Error).message}`);
      }
    });
  })();
  return { created, skipped };
}));

// ---------- Full export ----------
api.get('/export', h((_req, res) => {
  const dump = Object.fromEntries(
    ['stages', 'companies', 'contacts', 'deals', 'tasks', 'activities'].map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]),
  );
  res.setHeader('Content-Disposition', `attachment; filename="lean-crm-export-${today()}.json"`);
  res.json({ exported_at: new Date().toISOString(), ...dump });
}));

// ---------- Errors ----------
api.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof store.UserError) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Check the terminal for details.' });
});
