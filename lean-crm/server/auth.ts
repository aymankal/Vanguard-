import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { db, agencyMode, setSetting, type Row } from './db.js';
import { SINGLE_USER, ForbiddenError, type Role, type Scope } from './scope.js';
import { UserError } from './store.js';
import { APP_URL } from './config.js';
import { sendMail } from './mail.js';
import { h } from './api.js';

export type User = { id: number; email: string; name: string; role: Role; client_id: number | null };

declare module 'express-serve-static-core' {
  interface Request { scope: Scope; user?: User }
}

const COOKIE = 'lc_session';
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;

// ---------- passwords & tokens ----------
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [, salt, hash] = stored.split('$');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const checkPassword = (pw: unknown) => {
  if (typeof pw !== 'string' || pw.length < 8) throw new UserError('Use a password of at least 8 characters.');
  return pw;
};

// ---------- sessions ----------
function startSession(req: Request, res: Response, userId: number) {
  const t = token();
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(sha(t), userId);
  res.setHeader('Set-Cookie', `${COOKIE}=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${req.secure ? '; Secure' : ''}`);
}
function readCookie(req: Request): string | null {
  const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}
export function userFromRequest(req: Request): User | null {
  const t = readCookie(req);
  if (!t) return null;
  return (db.prepare(`SELECT u.id, u.email, u.name, u.role, u.client_id FROM sessions s JOIN users u ON u.id = s.user_id
                      WHERE s.token_hash = ? AND s.expires_at > datetime('now')`).get(sha(t)) as User | undefined) ?? null;
}

/** Client ids this user may open. Owner: all. Rep: assigned. Client: their own. */
export function accessibleClientIds(u: User): number[] {
  if (u.role === 'owner') return (db.prepare('SELECT id FROM clients ORDER BY id').all() as Row[]).map((r) => r.id as number);
  if (u.role === 'client') return u.client_id ? [u.client_id] : [];
  return (db.prepare('SELECT client_id FROM user_clients WHERE user_id = ? ORDER BY client_id').all(u.id) as Row[]).map((r) => r.client_id as number);
}

/**
 * Builds req.scope for every /api request. The active client comes from the X-Client-Id header but is
 * only accepted if the signed-in user has access to it; client users are pinned to their own workspace.
 */
export function attachScope(req: Request, res: Response, next: NextFunction) {
  if (!agencyMode()) {
    req.scope = SINGLE_USER;
    return next();
  }
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Please sign in.', code: 'auth' });
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
  req.scope = { clientId, userId: user.id, role: user.role, agency: true };
  next();
}

export const allowRoles = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) =>
  roles.includes(req.scope.role) ? next() : res.status(403).json({ error: 'Not available for your account.' });

// ---------- invites ----------
export async function invite(req: Request, input: { email: string; name?: string; role: Role; clientIds: number[]; claudeId?: string }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('Enter a valid email address.');
  if (!['owner', 'rep', 'client'].includes(input.role)) throw new UserError('Role must be owner, rep or client.');
  const known = new Set((db.prepare('SELECT id FROM clients').all() as Row[]).map((r) => r.id as number));
  const clientIds = [...new Set(input.clientIds.map(Number))].filter((id) => known.has(id));
  if (input.role === 'client' && clientIds.length !== 1) throw new UserError('Pick the one client this login is for.');
  if (input.role === 'rep' && !clientIds.length) throw new UserError('Assign at least one client to the rep.');
  const existing = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as Row | undefined;
  if (existing?.password_hash) throw new UserError('That person already has an account.');

  const t = token();
  db.transaction(() => {
    if (existing) db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
    const id = db.prepare(`INSERT INTO users (email, name, role, client_id, invite_token_hash, invite_expires)
                           VALUES (?, ?, ?, ?, ?, datetime('now', '+${INVITE_DAYS} days'))`)
      .run(email, input.name?.trim() ?? '', input.role, input.role === 'client' ? clientIds[0] : null, sha(t)).lastInsertRowid as number;
    if (input.role === 'rep') clientIds.forEach((c) => db.prepare('INSERT INTO user_clients (user_id, client_id) VALUES (?, ?)').run(id, c));
  })();

  const base = APP_URL || `${req.protocol}://${req.get('host')}`;
  const link = `${base}/invite/${t}`;
  const role = input.role === 'rep' ? 'an SDR' : input.role === 'client' ? 'a client' : 'an owner';
  const mail = await sendMail({
    to: email,
    subject: 'You’re invited to Lean CRM',
    text: `You've been invited to Lean CRM as ${role}.\n\nSet your password here (link valid ${INVITE_DAYS} days):\n${link}\n`,
  });
  return { link, emailed: mail.delivered };
}

// ---------- routes ----------
export const auth = Router();

const attempts = new Map<string, { n: number; until: number }>();
function throttle(key: string) {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.n >= 10) throw new ForbiddenError('Too many attempts. Try again in 15 minutes.');
}
function failed(key: string) {
  const a = attempts.get(key);
  attempts.set(key, a && a.until > Date.now() ? { n: a.n + 1, until: a.until } : { n: 1, until: Date.now() + 15 * 60000 });
}

auth.get('/me', h((req) => {
  if (!agencyMode()) return { agency: false, user: null, clients: [] };
  const user = userFromRequest(req);
  if (!user) return { agency: true, user: null, clients: [] };
  const ids = accessibleClientIds(user);
  const clients = ids.length
    ? db.prepare(`SELECT id, name, logo_url, status FROM clients WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name COLLATE NOCASE`).all(...ids)
    : [];
  return { agency: true, user, clients };
}));

auth.post('/login', h((req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  throttle(email);
  const u = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as Row | undefined;
  if (!u || !verifyPassword(String(req.body.password ?? ''), u.password_hash as string | null)) {
    failed(email);
    throw new UserError('Wrong email or password.');
  }
  attempts.delete(email);
  startSession(req, res, u.id as number);
  return { ok: true };
}));

auth.post('/logout', h((req, res) => {
  const t = readCookie(req);
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  return { ok: true };
}));

const inviteUser = (t: string) =>
  db.prepare(`SELECT id, email, role FROM users WHERE invite_token_hash = ? AND invite_expires > datetime('now')`).get(sha(t)) as Row | undefined;

auth.get('/invite/:token', h((req) => {
  const u = inviteUser(String(req.params.token));
  if (!u) throw new UserError('This invite link is invalid or has expired. Ask for a new one.');
  return { email: u.email, role: u.role };
}));

auth.post('/invite/:token', h((req, res) => {
  const u = inviteUser(String(req.params.token));
  if (!u) throw new UserError('This invite link is invalid or has expired. Ask for a new one.');
  const name = String(req.body.name ?? '').trim();
  if (!name) throw new UserError('Enter your name.');
  db.prepare('UPDATE users SET name = ?, password_hash = ?, invite_token_hash = NULL, invite_expires = NULL WHERE id = ?')
    .run(name, hashPassword(checkPassword(req.body.password)), u.id);
  startSession(req, res, u.id as number);
  return { ok: true };
}));

/** Turn Agency Mode on. Only possible while it is off (i.e. from the open single-user app). */
auth.post('/enable', h((req, res) => {
  if (agencyMode()) throw new ForbiddenError('Agency Mode is already on.');
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const name = String(req.body.name ?? '').trim();
  const owner = db.prepare("SELECT id, password_hash FROM users WHERE email = ? AND role = 'owner'").get(email) as Row | undefined;
  let id: number;
  if (owner) {
    if (!verifyPassword(String(req.body.password ?? ''), owner.password_hash as string)) throw new UserError('Wrong password for that owner account.');
    id = owner.id as number;
  } else {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('Enter a valid email address.');
    if (!name) throw new UserError('Enter your name.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new UserError('That email belongs to a non-owner account.');
    id = db.prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, 'owner', ?)")
      .run(email, name, hashPassword(checkPassword(req.body.password))).lastInsertRowid as number;
  }
  setSetting('agency_mode', '1');
  startSession(req, res, id);
  return { ok: true };
}));
