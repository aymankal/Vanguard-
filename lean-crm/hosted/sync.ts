// Keeps the in-browser SQLite database and the artifact's shared `db` store in step.
//  - Local writes: SQLite triggers record changed keys in _changes; flush() writes those documents.
//  - Remote writes: one onSnapshot per collection applies other viewers' changes locally.
// Layout: one document per row (t_<table>/<key>), except activities, which are grouped per client,
// per rep and per week (t_activities/c<client>_u<user>_<yyyy-ww>) so the store stays small and two
// reps logging at the same time never write the same document.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from '../server/db.js';

export const ROW_TABLES: Record<string, string[]> = {
  stages: ['id'], clients: ['id'], users: ['id'], user_clients: ['user_id', 'client_id'], settings: ['key'],
  companies: ['id'], contacts: ['id'], deals: ['id'], tasks: ['id'], weekly_reports: ['id'],
};
// Parents before children, so foreign keys resolve when loading.
const LOAD_ORDER = ['stages', 'clients', 'users', 'user_clients', 'settings', 'companies', 'contacts', 'deals', 'tasks', 'weekly_reports', 'activities'];
const bucketOf = (p: string) => `'c'||${p}.client_id||'_u'||COALESCE(${p}.user_id,0)||'_'||strftime('%Y-%W',${p}.created_at)`;
const keyOf = (t: string, p: string) => (ROW_TABLES[t].length === 1 ? `CAST(${p}.${ROW_TABLES[t][0]} AS TEXT)` : `${p}.user_id||'_'||${p}.client_id`);
const coll = (t: string) => `t_${t}`;

const columns = new Map<string, string[]>();
const cols = (t: string) => {
  if (!columns.has(t)) columns.set(t, (db.pragma(`table_info(${t})`) as { name: string }[]).map((c) => c.name));
  return columns.get(t)!;
};

export function installTriggers() {
  db.exec(`CREATE TABLE IF NOT EXISTS _sync (v INTEGER NOT NULL); DELETE FROM _sync; INSERT INTO _sync VALUES (0);
           CREATE TABLE IF NOT EXISTS _changes (tbl TEXT NOT NULL, k TEXT NOT NULL, PRIMARY KEY (tbl, k));`);
  const on = `WHEN (SELECT v FROM _sync) = 0`;
  for (const t of [...Object.keys(ROW_TABLES), 'activities']) {
    const key = (p: string) => (t === 'activities' ? bucketOf(p) : keyOf(t, p));
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS _s_${t}_i AFTER INSERT ON ${t} ${on} BEGIN INSERT OR IGNORE INTO _changes VALUES ('${t}', ${key('NEW')}); END;
      CREATE TRIGGER IF NOT EXISTS _s_${t}_u AFTER UPDATE ON ${t} ${on} BEGIN
        INSERT OR IGNORE INTO _changes VALUES ('${t}', ${key('NEW')}); INSERT OR IGNORE INTO _changes VALUES ('${t}', ${key('OLD')}); END;
      CREATE TRIGGER IF NOT EXISTS _s_${t}_d AFTER DELETE ON ${t} ${on} BEGIN INSERT OR IGNORE INTO _changes VALUES ('${t}', ${key('OLD')}); END;`);
  }
}

/** Run fn with change capture off (used when applying data that came from the store). */
function quietly(fn: () => void) {
  db.pragma('foreign_keys = OFF');
  db.exec('UPDATE _sync SET v = 1');
  try { db.transaction(fn)(); } finally {
    db.exec('UPDATE _sync SET v = 0');
    db.pragma('foreign_keys = ON');
  }
}

function upsert(t: string, row: Record<string, unknown>) {
  const c = cols(t).filter((k) => k in row);
  const pk = t === 'activities' ? ['id'] : ROW_TABLES[t];
  const set = c.filter((k) => !pk.includes(k));
  db.prepare(`INSERT INTO ${t} (${c.join(',')}) VALUES (${c.map(() => '?').join(',')}) ON CONFLICT(${pk.join(',')}) DO ${set.length ? `UPDATE SET ${set.map((k) => `${k}=excluded.${k}`).join(',')}` : 'NOTHING'}`)
    .run(...c.map((k) => row[k] ?? null));
}
function removeRow(t: string, key: string) {
  if (t === 'activities') db.prepare(`DELETE FROM activities WHERE ${bucketOf('activities')} = ?`).run(key);
  else if (t === 'user_clients') { const [u, c] = key.split('_'); db.prepare('DELETE FROM user_clients WHERE user_id = ? AND client_id = ?').run(Number(u), Number(c)); }
  else db.prepare(`DELETE FROM ${t} WHERE ${ROW_TABLES[t][0]} = ?`).run(t === 'settings' ? key : Number(key));
}
function applyDoc(t: string, key: string, body: Record<string, unknown> | null) {
  if (t === 'activities') {
    removeRow(t, key);
    for (const r of ((body?.rows as Record<string, unknown>[]) ?? [])) upsert(t, r);
  } else if (body) upsert(t, body);
  else removeRow(t, key);
}

/** Document body for a changed key, or null if it no longer exists. */
export function bodyFor(t: string, key: string): Record<string, unknown> | null {
  if (t === 'activities') {
    const rows = db.prepare(`SELECT * FROM activities WHERE ${bucketOf('activities')} = ? ORDER BY id`).all(key) as Record<string, unknown>[];
    return rows.length ? { k: key, rows } : null;
  }
  const pk = ROW_TABLES[t];
  const row = pk.length === 1
    ? db.prepare(`SELECT * FROM ${t} WHERE ${pk[0]} = ?`).get(t === 'settings' ? key : Number(key))
    : db.prepare('SELECT * FROM user_clients WHERE user_id = ? AND client_id = ?').get(...key.split('_').map(Number));
  return row ? { k: key, ...(row as Record<string, unknown>) } : null;
}

// ---------- store ----------
let store: any = null;
const lastWritten = new Map<string, string>();
const inFlight = new Set<string>();
let onError: (msg: string) => void = () => {};
let onRemote: () => void = () => {};

let chain: Promise<void> = Promise.resolve();
export function flush(): Promise<void> {
  chain = chain.then(doFlush, doFlush);
  return chain;
}
async function doFlush() {
  if (!store) return;
  const changes = db.prepare('SELECT tbl, k FROM _changes').all() as { tbl: string; k: string }[];
  if (!changes.length) return;
  db.exec('DELETE FROM _changes');
  const writes = changes.map(({ tbl, k }) => ({ path: `${coll(tbl)}/${k}`, tbl, k, body: bodyFor(tbl, k) }));
  writes.forEach((w) => inFlight.add(w.path));
  for (const w of writes) {
    try {
      const ref = store.doc(w.path);
      if (w.body) await ref.set(w.body); else await ref.delete();
      lastWritten.set(w.path, JSON.stringify(w.body));
    } catch (e: any) {
      onError(e?.code === 'invalid_argument'
        ? 'You have view-only access to this page, so changes aren’t saved.'
        : e?.code === 'quota_exceeded' ? 'This page’s storage is full. Delete old records to keep saving.'
        : 'A change couldn’t be saved. Check your connection and try again.');
    } finally {
      inFlight.delete(w.path);
    }
  }
}

/** Load everything from the store and keep listening. Resolves once every collection has arrived. */
export function connect(dbCap: any, handlers: { error: (m: string) => void; remote: () => void }): Promise<void> {
  store = dbCap;
  onError = handlers.error;
  onRemote = handlers.remote;
  const firsts: Promise<void>[] = [];
  const initial = new Map<string, any[]>();
  for (const t of LOAD_ORDER) {
    firsts.push(new Promise<void>((resolve) => {
      let first = true;
      dbCap.collection(coll(t)).onSnapshot((snap: any) => {
        if (first) {
          first = false;
          initial.set(t, snap.docs.filter((d: any) => d.exists).map((d: any) => ({ id: d.id, data: d.data() })));
          return resolve();
        }
        const changes = snap.docChanges().filter((ch: any) => {
          const path = `${coll(t)}/${ch.doc.id}`;
          if (ch.doc.metadata.hasPendingWrites || inFlight.has(path)) return false;
          const body = ch.type === 'removed' ? null : ch.doc.data();
          return lastWritten.get(path) !== JSON.stringify(body);
        });
        if (!changes.length) return;
        quietly(() => changes.forEach((ch: any) => applyDoc(t, ch.doc.id, ch.type === 'removed' ? null : ch.doc.data())));
        onRemote();
      }, (e: any) => { onError(`Live updates stopped (${e?.code ?? 'error'}). Reload the page.`); resolve(); });
    }));
  }
  return Promise.all(firsts).then(() => {
    quietly(() => {
      for (const t of LOAD_ORDER) for (const d of initial.get(t) ?? []) applyDoc(t, d.id, d.data);
    });
  });
}
