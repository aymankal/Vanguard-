import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/** Point the app at a throwaway database. Call before importing any server module. */
export function tempDb(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-crm-test-'));
  process.env.DB_PATH = path.join(dir, `${name}.db`);
  delete process.env.ANTHROPIC_API_KEY;
  return process.env.DB_PATH;
}
