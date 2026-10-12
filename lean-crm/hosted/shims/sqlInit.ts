// sql.js (SQLite compiled to asm.js: no WebAssembly, so no CSP surprises). Top-level await makes every
// module that opens the database wait until SQLite is ready.
// @ts-expect-error — no types for the asm build
import initSqlJs from 'sql.js/dist/sql-asm.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SQL: any = await initSqlJs();
