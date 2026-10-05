import os
import sqlite3
from contextlib import contextmanager

ROOT = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.environ.get("APP_DATA_DIR", os.path.join(ROOT, "data"))
DB_PATH = os.path.join(DATA_DIR, "docs.db")
FILES_DIR = os.path.join(DATA_DIR, "files")

SCHEMA = """
CREATE TABLE IF NOT EXISTS modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- module_id is NULL and is_case = 1 for Case File records.
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER REFERENCES modules(id) ON DELETE RESTRICT,
    is_case INTEGER NOT NULL DEFAULT 0,
    seq INTEGER NOT NULL DEFAULT 0,
    ref TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active',
    party TEXT NOT NULL DEFAULT '',
    expiry TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    file_id TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL DEFAULT '',
    file_type TEXT NOT NULL DEFAULT '',
    file_size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Last sequence number issued per module ("case" for the Case File). Never goes down,
-- so a reference number is never issued twice, even after deletes or moves.
CREATE TABLE IF NOT EXISTS ref_counters (
    scope TEXT PRIMARY KEY,
    last_seq INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_documents_module ON documents(is_case, module_id);
"""


def init_db() -> None:
    os.makedirs(FILES_DIR, exist_ok=True)
    with session() as conn:
        conn.executescript(SCHEMA)


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
