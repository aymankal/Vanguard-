// A v1 (single-user) database upgrades in place with every row kept and moved to the default workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { tempDb } from './helpers.js';

const path = tempDb('migration');

test('v1 data survives the upgrade to v2', async () => {
  // Importing db.ts above already created a fresh v2 file, so build a separate v1 file by hand.
  const file = path.replace('.db', '-v1.db');
  const { V1_SQL: sql, migrate } = await import('../db.js');
  const d = new Database(file);
  d.exec(sql);
  d.exec(`INSERT INTO stages (name, position) VALUES ('New', 0), ('Won', 1);
    INSERT INTO companies (name, website) VALUES ('Acme', 'acme.com');
    INSERT INTO contacts (name, company_id, email) VALUES ('Sara', 1, 's@acme.com');
    INSERT INTO deals (title, value, stage_id, company_id, contact_id, nba_text) VALUES ('Acme deal', 15000, 1, 1, 1, 'Call Sara');
    INSERT INTO tasks (title, due_date, contact_id, deal_id, done) VALUES ('Follow up', '2026-10-16', 1, 1, 0);
    INSERT INTO activities (type, body, contact_id, company_id, deal_id, created_at) VALUES ('note', 'Discovery call', 1, 1, 1, '2026-10-01 10:00:00'),
      ('stage_change', 'Stage: New → Won', 1, 1, 1, '2026-10-02 10:00:00');`);
  assert.equal(d.pragma('user_version', { simple: true }), 0);

  migrate(d);

  assert.equal(d.pragma('user_version', { simple: true }), 2);
  assert.equal(d.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(d.pragma('foreign_key_check'), []);
  assert.deepEqual(d.prepare('SELECT id, name FROM clients').all(), [{ id: 1, name: 'My workspace' }].map((c) => ({ ...c })));
  for (const t of ['companies', 'contacts', 'deals', 'tasks', 'activities']) {
    const rows = d.prepare(`SELECT client_id FROM ${t}`).all() as { client_id: number }[];
    assert.ok(rows.length > 0, t);
    assert.ok(rows.every((r) => r.client_id === 1), `${t} moved to client 1`);
  }
  assert.deepEqual(d.prepare('SELECT title, value, stage_id, company_id, contact_id, nba_text FROM deals').get(),
    { title: 'Acme deal', value: 15000, stage_id: 1, company_id: 1, contact_id: 1, nba_text: 'Call Sara' });
  assert.deepEqual(d.prepare('SELECT type, body, created_at FROM activities ORDER BY id').all(), [
    { type: 'note', body: 'Discovery call', created_at: '2026-10-01 10:00:00' },
    { type: 'stage_change', body: 'Stage: New → Won', created_at: '2026-10-02 10:00:00' },
  ]);
  // New columns are enforced: no client_id default, so an unscoped insert fails loudly.
  assert.throws(() => d.prepare("INSERT INTO contacts (name) VALUES ('x')").run(), /NOT NULL/);
  // Running again is a no-op.
  migrate(d);
  assert.equal((d.prepare('SELECT COUNT(*) n FROM activities').get() as { n: number }).n, 2);
  d.close();
});
