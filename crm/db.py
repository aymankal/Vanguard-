import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.environ.get(
    "CRM_DB_PATH", os.path.join(os.path.dirname(os.path.dirname(__file__)), "crm.db")
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    domain TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    size TEXT DEFAULT '',
    location TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    about TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    company TEXT DEFAULT '',
    title TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'lead',
    tags TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    value REAL NOT NULL DEFAULT 0,
    stage TEXT NOT NULL DEFAULT 'lead',
    close_date TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'Untitled note',
    body TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'note',
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    due_date TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'note',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT '',
    contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
    note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
    occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

# Columns added after the first release. Existing databases are upgraded in place
# by init_db(), so a deployed crm.db never has to be thrown away.
MIGRATIONS = {
    "companies": {
        "renewal_date": "TEXT DEFAULT ''",
        "mrr": "REAL DEFAULT 0",
    },
    "contacts": {
        "company_id": "INTEGER REFERENCES companies(id) ON DELETE SET NULL",
        "linkedin": "TEXT DEFAULT ''",
        "source": "TEXT DEFAULT ''",
        "owner": "TEXT DEFAULT ''",
        "next_follow_up": "TEXT DEFAULT ''",
        "last_contacted_at": "TEXT DEFAULT ''",
        "about": "TEXT DEFAULT ''",
    },
    "deals": {
        "company_id": "INTEGER REFERENCES companies(id) ON DELETE SET NULL",
        "probability": "INTEGER",
        "owner": "TEXT DEFAULT ''",
        "next_step": "TEXT DEFAULT ''",
        "lost_reason": "TEXT DEFAULT ''",
        "stage_changed_at": "TEXT DEFAULT ''",
        "updated_at": "TEXT DEFAULT ''",
    },
    "notes": {
        "company_id": "INTEGER REFERENCES companies(id) ON DELETE SET NULL",
        "meeting_date": "TEXT DEFAULT ''",
        "attendees": "TEXT DEFAULT ''",
        "duration_min": "INTEGER DEFAULT 0",
        "summary": "TEXT DEFAULT ''",
    },
    "tasks": {
        "deal_id": "INTEGER REFERENCES deals(id) ON DELETE SET NULL",
        "company_id": "INTEGER REFERENCES companies(id) ON DELETE SET NULL",
        "priority": "TEXT DEFAULT 'normal'",
        "completed_at": "TEXT DEFAULT ''",
    },
}

INDEXES = """
CREATE INDEX IF NOT EXISTS idx_notes_contact ON notes(contact_id);
CREATE INDEX IF NOT EXISTS idx_notes_deal ON notes(deal_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_note ON tasks(note_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(done, due_date);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_activities_deal ON activities(deal_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_activities_company ON activities(company_id, occurred_at);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def session():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def migrate(conn: sqlite3.Connection) -> None:
    for table, columns in MIGRATIONS.items():
        existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        for column, ddl in columns.items():
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def init_db() -> None:
    with session() as conn:
        conn.executescript(SCHEMA)
        migrate(conn)
        conn.executescript(INDEXES)
