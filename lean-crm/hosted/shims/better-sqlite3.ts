// The subset of better-sqlite3 the Lean CRM server uses, implemented over sql.js in the browser.
import { SQL } from './sqlInit';

type Params = unknown[] | Record<string, unknown>;

/** Integer-id tables. New rows get a time-based id so viewers writing at once never collide. */
const ID_TABLES = new Set(['stages', 'clients', 'users', 'companies', 'contacts', 'deals', 'tasks', 'activities', 'weekly_reports']);
let seq = Math.floor(Math.random() * 1000);
export const newId = () => Date.now() * 1000 + (seq++ % 1000);

const INSERT = /^(\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\()([^)]*)(\)\s*VALUES\s*\()/i;

const clean = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

class Statement {
  private sql: string;
  private injectId = false;
  constructor(private owner: Database, sql: string) {
    const m = INSERT.exec(sql);
    if (m && ID_TABLES.has(m[2].toLowerCase()) && !m[3].split(',').map((c) => c.trim().toLowerCase()).includes('id')) {
      this.injectId = true;
      sql = sql.replace(INSERT, `$1id, $3$4?, `);
    }
    this.sql = sql;
  }
  private params(args: unknown[], id?: number): Params {
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const named: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args[0] as Record<string, unknown>)) named[`@${k}`] = clean(v);
      return named;
    }
    const flat = args.flat().map(clean);
    return id !== undefined ? [id, ...flat] : flat;
  }
  private stmt(args: unknown[], id?: number) {
    const st = this.owner.raw.prepare(this.sql);
    st.bind(this.params(args, id));
    return st;
  }
  run(...args: unknown[]) {
    const id = this.injectId ? newId() : undefined;
    const st = this.stmt(args, id);
    try { st.step(); } finally { st.free(); }
    const changes = this.owner.raw.getRowsModified();
    const lastInsertRowid = id ?? (this.owner.raw.exec('SELECT last_insert_rowid()')[0]?.values[0][0] as number);
    return { changes, lastInsertRowid: changes ? lastInsertRowid : 0 };
  }
  get(...args: unknown[]) {
    const st = this.stmt(args);
    try { return st.step() ? st.getAsObject() : undefined; } finally { st.free(); }
  }
  all(...args: unknown[]) {
    const st = this.stmt(args);
    const rows: Record<string, unknown>[] = [];
    try { while (st.step()) rows.push(st.getAsObject()); } finally { st.free(); }
    return rows;
  }
}

export default class Database {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
  private depth = 0;
  constructor(_path?: string) {
    this.raw = new SQL.Database();
  }
  prepare(sql: string) { return new Statement(this, sql); }
  exec(sql: string) { this.raw.exec(sql); return this; }
  pragma(p: string, opts: { simple?: boolean } = {}) {
    if (/journal_mode/i.test(p)) return opts.simple ? 'memory' : [];
    const res = this.raw.exec(`PRAGMA ${p}`);
    if (opts.simple) return res[0]?.values[0]?.[0];
    if (!res[0]) return [];
    const { columns, values } = res[0];
    return values.map((v: unknown[]) => Object.fromEntries(columns.map((c: string, i: number) => [c, v[i]])));
  }
  transaction<T extends (...a: never[]) => unknown>(fn: T): T {
    return ((...args: never[]) => {
      const sp = `sp${this.depth}`;
      this.raw.exec(this.depth ? `SAVEPOINT ${sp}` : 'BEGIN');
      this.depth++;
      try {
        const r = fn(...args);
        this.depth--;
        this.raw.exec(this.depth ? `RELEASE ${sp}` : 'COMMIT');
        return r;
      } catch (e) {
        this.depth--;
        this.raw.exec(this.depth ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
        throw e;
      }
    }) as T;
  }
  close() { this.raw.close(); }
}
