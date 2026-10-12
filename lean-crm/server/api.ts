import { Router, type Request, type Response, type NextFunction } from 'express';
import { db, today, type Row } from './db.js';
import * as repo from './repo.js';
import * as store from './store.js';
import { ForbiddenError } from './scope.js';

export const api = Router();

type H = (req: Request, res: Response) => unknown;
export const h = (fn: H) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    next(e);
  }
};
const id = (req: Request) => Number(req.params.id);
const found = <T>(v: T | null | undefined, what: string): T => {
  if (!v) throw new store.UserError(`${what} not found.`);
  return v;
};
/** Stages are shared by all workspaces, so in Agency Mode only the owner may change them. */
const ownerOnly = (req: Request) => {
  if (req.scope.agency && req.scope.role !== 'owner') throw new ForbiddenError('Only the agency owner can do that.');
};

// ---------- Stages ----------
api.get('/stages', h(() => repo.stages()));
api.post('/stages', h((req) => {
  ownerOnly(req);
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
  ownerOnly(req);
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
  ownerOnly(req);
  const ids: number[] = req.body.ids ?? [];
  const up = db.prepare('UPDATE stages SET position = ? WHERE id = ?');
  db.transaction(() => ids.forEach((sid, i) => up.run(i, sid)))();
  return { ok: true };
}));
api.delete('/stages/:id', h((req) => {
  ownerOnly(req);
  const n = (db.prepare('SELECT COUNT(*) n FROM deals WHERE stage_id = ?').get(id(req)) as { n: number }).n;
  if (n) throw new store.UserError(`Move the ${n} deal(s) out of this stage first${req.scope.agency ? ' (across all clients)' : ''}.`);
  if ((db.prepare('SELECT COUNT(*) n FROM stages').get() as { n: number }).n <= 1) throw new store.UserError('You need at least one stage.');
  db.prepare('DELETE FROM stages WHERE id = ?').run(id(req));
  return { ok: true };
}));

// ---------- Companies ----------
api.get('/companies', h((req) => repo.listCompanies(req.scope)));
api.get('/companies/:id', h((req) => found(repo.getCompany(req.scope, id(req)), 'Company')));
api.post('/companies', h((req) => ({ id: store.createCompany(req.scope, req.body) })));
api.patch('/companies/:id', h((req) => (store.patch(req.scope, 'companies', id(req), req.body), { ok: true })));
api.delete('/companies/:id', h((req) => (store.deleteRecord(req.scope, 'companies', id(req)), { ok: true })));

// ---------- Contacts ----------
api.get('/contacts', h((req) => repo.listContacts(req.scope)));
api.get('/contacts/:id', h((req) => found(repo.getContact(req.scope, id(req)), 'Contact')));
api.post('/contacts', h((req) => ({ id: store.createContact(req.scope, req.body) })));
api.patch('/contacts/:id', h((req) => (store.patch(req.scope, 'contacts', id(req), req.body), { ok: true })));
api.delete('/contacts/:id', h((req) => (store.deleteRecord(req.scope, 'contacts', id(req)), { ok: true })));

// ---------- Deals ----------
api.get('/deals', h((req) =>
  repo.listDeals(req.scope).map(({ nba_key, ...d }) => ({
    ...d,
    nba_fresh: !!d.nba_text && nba_key === repo.nbaKey(req.scope, d.id as number),
  })),
));
api.get('/deals/:id', h((req) => found(repo.getDeal(req.scope, id(req)), 'Deal')));
api.post('/deals', h((req) => ({ id: store.createDeal(req.scope, req.body) })));
api.patch('/deals/:id', h((req) => {
  if (req.body.stage_id != null) store.setDealStage(req.scope, id(req), Number(req.body.stage_id));
  store.patch(req.scope, 'deals', id(req), req.body);
  return { ok: true };
}));
api.delete('/deals/:id', h((req) => (store.deleteRecord(req.scope, 'deals', id(req)), { ok: true })));

// ---------- Tasks ----------
api.post('/tasks', h((req) => ({ id: store.createTask(req.scope, req.body) })));
api.patch('/tasks/:id', h((req) => {
  if ('done' in req.body) store.setTaskDone(req.scope, id(req), Boolean(req.body.done));
  store.patch(req.scope, 'tasks', id(req), req.body);
  return { ok: true };
}));
api.delete('/tasks/:id', h((req) => (store.deleteRecord(req.scope, 'tasks', id(req)), { ok: true })));

// ---------- Activities ----------
api.post('/activities', h((req) => ({ id: store.addActivity(req.scope, req.body) })));
api.patch('/activities/:id', h((req) => (store.updateMeeting(req.scope, id(req), req.body), { ok: true })));
api.delete('/activities/:id', h((req) => (store.deleteActivity(req.scope, id(req)), { ok: true })));

// ---------- Today / search ----------
api.get('/today', h((req) => repo.today(req.scope, today())));
api.get('/search', h((req) => repo.quickSearch(req.scope, String(req.query.q ?? '').trim())));

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
      delete r.company_id; // never trust ids from a file
      try {
        if (kind === 'contacts') store.createContact(req.scope, r);
        else store.createCompany(req.scope, r);
        created++;
      } catch (e) {
        if (e instanceof ForbiddenError) throw e;
        skipped.push(`Row ${i + 2}: ${(e as Error).message}`);
      }
    });
  })();
  return { created, skipped };
}));

// ---------- Export (current workspace) ----------
api.get('/export', h((req, res) => {
  ownerOnly(req);
  res.setHeader('Content-Disposition', `attachment; filename="lean-crm-export-${today()}.json"`);
  res.json({ exported_at: new Date().toISOString(), ...repo.exportData(req.scope) });
}));

// ---------- Errors (shared) ----------
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof store.UserError) return res.status(400).json({ error: err.message });
  if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Check the terminal for details.' });
}
