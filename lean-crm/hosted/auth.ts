// Hosted replacement for server/auth.ts. People are identified by their claude.ai account:
// the artifact owner is the agency owner; everyone else is matched by their claude.ai account id,
// which the owner picks from a name search when adding them to the team.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from './shims/express';
import { db, agencyMode, setSetting, type Row } from '../server/db.js';
import { SINGLE_USER, ForbiddenError, type Role, type Scope } from '../server/scope.js';
import { UserError } from '../server/store.js';
import { h } from '../server/api.js';
import { viewer, caps } from './caps';

export type User = { id: number; email: string; name: string; role: Role; client_id: number | null };

export const hashPassword = (_pw: string) => '';

const COLS = 'id, email, name, role, client_id';
const userById = (id: number) => db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(id) as User | undefined;

/** The owner row for the artifact owner, claiming the first owner row on first visit. */
function ownerRow(): User | undefined {
  if (viewer.id) {
    const mine = db.prepare(`SELECT ${COLS} FROM users WHERE claude_id = ? AND role = 'owner'`).get(viewer.id) as User | undefined;
    if (mine) return mine;
  }
  const first = db.prepare(`SELECT ${COLS}, claude_id FROM users WHERE role = 'owner' ORDER BY id LIMIT 1`).get() as (User & { claude_id: string | null }) | undefined;
  if (first && viewer.id && !first.claude_id) {
    db.prepare('UPDATE users SET claude_id = ?, name = ? WHERE id = ?').run(viewer.id, viewer.name || first.name, first.id);
    return userById(first.id);
  }
  return first;
}

/** The person this request acts as (the owner may preview as anyone on the team). */
export function currentUser(req?: any): User | null {
  if (viewer.isOwner) {
    const preview = Number(req?.headers?.['x-preview-user']);
    if (preview) {
      const u = userById(preview);
      if (u) return u;
    }
    return ownerRow() ?? null;
  }
  if (!viewer.id) return null;
  return (db.prepare(`SELECT ${COLS} FROM users WHERE claude_id = ?`).get(viewer.id) as User | undefined) ?? null;
}

export function accessibleClientIds(u: User): number[] {
  if (u.role === 'owner') return (db.prepare('SELECT id FROM clients ORDER BY id').all() as Row[]).map((r) => r.id as number);
  if (u.role === 'client') return u.client_id ? [u.client_id] : [];
  return (db.prepare('SELECT client_id FROM user_clients WHERE user_id = ? ORDER BY client_id').all(u.id) as Row[]).map((r) => r.client_id as number);
}

export function attachScope(req: any, res: any, next: () => void) {
  if (!agencyMode()) {
    req.scope = SINGLE_USER;
    return next();
  }
  const user = currentUser(req);
  if (!user) return res.status(403).json({ error: 'You don’t have access yet. Ask the agency owner to add your email under Team.' });
  req.user = user;
  const allowed = accessibleClientIds(user);
  let clientId: number;
  if (user.role === 'client') clientId = user.client_id!;
  else {
    const asked = Number(req.headers['x-client-id']);
    if (asked && !allowed.includes(asked)) return res.status(403).json({ error: "You don't have access to that client." });
    clientId = asked || allowed[0];
  }
  if (!clientId) return res.status(403).json({ error: 'No clients are assigned to you yet. Ask the agency owner.' });
  req.scope = { clientId, userId: user.id, role: user.role, agency: true } satisfies Scope;
  next();
}

export const allowRoles = (...roles: Role[]) => (req: any, res: any, next: () => void) =>
  roles.includes(req.scope.role) ? next() : res.status(403).json({ error: 'Not available for your account.' });

export async function invite(_req: any, input: { email: string; name?: string; role: Role; clientIds: number[]; claudeId?: string }) {
  const claudeId = String(input.claudeId ?? '');
  if (!claudeId) throw new UserError('Pick a person from the search results.');
  const email = `claude:${claudeId}`;
  if (!['owner', 'rep', 'client'].includes(input.role)) throw new UserError('Role must be owner, rep or client.');
  const known = new Set((db.prepare('SELECT id FROM clients').all() as Row[]).map((r) => r.id as number));
  const clientIds = [...new Set(input.clientIds.map(Number))].filter((id) => known.has(id));
  if (input.role === 'client' && clientIds.length !== 1) throw new UserError('Pick the one client this login is for.');
  if (input.role === 'rep' && !clientIds.length) throw new UserError('Assign at least one client to the rep.');
  if (db.prepare('SELECT 1 FROM users WHERE claude_id = ?').get(claudeId)) throw new UserError('That person is already on the team.');
  db.transaction(() => {
    const id = db.prepare('INSERT INTO users (email, name, role, client_id, claude_id) VALUES (?, ?, ?, ?, ?)')
      .run(email, input.name?.trim() || 'Teammate', input.role, input.role === 'client' ? clientIds[0] : null, claudeId).lastInsertRowid as number;
    if (input.role === 'rep') clientIds.forEach((c) => db.prepare('INSERT INTO user_clients (user_id, client_id) VALUES (?, ?)').run(id, c));
  })();
  return { emailed: false, hosted: true };
}

export const auth = Router();

auth.get('/me', h((req) => {
  if (!agencyMode()) return { agency: false, hosted: true, user: null, clients: [] };
  const user = currentUser(req);
  if (!user) return { agency: true, hosted: true, user: null, clients: [] };
  const ids = accessibleClientIds(user);
  const clients = ids.length
    ? db.prepare(`SELECT id, name, logo_url, status FROM clients WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name COLLATE NOCASE`).all(...ids)
    : [];
  const previewing = viewer.isOwner && user.role !== 'owner';
  const previewable = viewer.isOwner
    ? db.prepare("SELECT id, name, role FROM users WHERE role != 'owner' ORDER BY role DESC, name").all()
    : [];
  return { agency: true, hosted: true, user, clients, previewing, previewable };
}));

auth.post('/enable', h(() => {
  if (agencyMode()) throw new ForbiddenError('Agency Mode is already on.');
  if (!viewer.isOwner) throw new ForbiddenError('Only the owner of this page can turn on Agency Mode.');
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'owner'").get()) {
    db.prepare("INSERT INTO users (email, name, role, claude_id) VALUES (?, ?, 'owner', ?)").run(`claude:${viewer.id ?? 'owner'}`, viewer.name || 'Owner', viewer.id);
  }
  setSetting('agency_mode', '1');
  return { ok: true };
}));

/** Owner only: find people in the organization to add to the team. */
export const people = Router();
people.get('/', async (req: any, res: any) => {
  try {
    const hits = caps.user ? await caps.user.search(String(req.query.q ?? '')) : [];
    res.json(hits.filter((p: any) => p.name).slice(0, 8).map((p: any) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl })));
  } catch {
    res.json([]);
  }
});

auth.post('/login', h(() => { throw new UserError('Sign-in is handled by claude.ai on this page.'); }));
auth.post('/logout', h(() => ({ ok: true })));
