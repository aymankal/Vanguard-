// Export a Lean CRM SQLite database as the documents the hosted page's sync layer reads
// (one file per document: <out>/<collection>/<doc id>.json). Used to seed the claude.ai page.
//   npx tsx hosted/export-seed.ts data/demo.db hosted/seed-out
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const [src = 'data/demo.db', out = 'hosted/seed-out'] = process.argv.slice(2);
const db = new Database(src, { readonly: true });
fs.rmSync(out, { recursive: true, force: true });

const ROW_TABLES: Record<string, string[]> = {
  stages: ['id'], clients: ['id'], users: ['id'], user_clients: ['user_id', 'client_id'], settings: ['key'],
  companies: ['id'], contacts: ['id'], deals: ['id'], tasks: ['id'], weekly_reports: ['id'],
};
const BUCKET = "'c'||client_id||'_u'||COALESCE(user_id,0)||'_'||strftime('%Y-%W',created_at)";
const write = (coll: string, id: string, body: object) => {
  fs.mkdirSync(path.join(out, coll), { recursive: true });
  fs.writeFileSync(path.join(out, coll, `${id}.json`), JSON.stringify(body));
};
let n = 0;
for (const [t, pk] of Object.entries(ROW_TABLES)) {
  // Hosted users sign in with claude.ai: no password hashes or invite tokens are copied.
  for (const row of db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]) {
    if (t === 'users') Object.assign(row, { password_hash: null, invite_token_hash: null, invite_expires: null });
    if (t === 'clients') Object.assign(row, { health_key: null, health_text: null });
    const k = pk.length === 1 ? String(row[pk[0]]) : `${row.user_id}_${row.client_id}`;
    write(`t_${t}`, k, { k, ...row });
    n++;
  }
}
const buckets = db.prepare(`SELECT DISTINCT ${BUCKET} b FROM activities`).all() as { b: string }[];
let biggest = 0;
for (const { b } of buckets) {
  const rows = db.prepare(`SELECT * FROM activities WHERE ${BUCKET} = ? ORDER BY id`).all(b);
  const body = { k: b, rows };
  biggest = Math.max(biggest, JSON.stringify(body).length);
  write('t_activities', b, body);
  n++;
}
console.log(`${n} documents (${buckets.length} activity buckets, largest ${Math.round(biggest / 1024)} KiB) → ${out}`);
