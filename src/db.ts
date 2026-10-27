import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;
export type Row = Record<string, any>;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','agent')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE teams (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE team_members (
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, user_id)
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,            -- sha256 do token (o token em si só existe no cookie)
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,     -- somente dígitos, com DDI
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE conversations (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    channel TEXT NOT NULL DEFAULT 'whatsapp',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
    assignee_id INTEGER REFERENCES users(id),
    team_id INTEGER REFERENCES teams(id),
    created_at TEXT NOT NULL,
    last_message_at TEXT NOT NULL,
    last_inbound_at TEXT,
    first_response_at TEXT,
    resolved_at TEXT,
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_preview TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_conv_status ON conversations(status, last_message_at DESC);
  CREATE INDEX idx_conv_customer ON conversations(customer_id);
  CREATE INDEX idx_conv_assignee ON conversations(assignee_id);
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('in','out')),
    kind TEXT NOT NULL CHECK (kind IN ('text','template','note')),
    body TEXT NOT NULL,
    template_name TEXT,
    sender_user_id INTEGER REFERENCES users(id),
    external_id TEXT UNIQUE,        -- id da mensagem no canal (idempotência de webhooks)
    delivery_status TEXT,           -- sent | delivered | read | failed
    error TEXT,
    local_dow INTEGER NOT NULL,     -- dia da semana local (0=dom ... 6=sáb) no momento do evento
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_msg_conv ON messages(conversation_id, id);
  CREATE TABLE templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'pt_BR',
    category TEXT NOT NULL DEFAULT 'UTILITY',
    body TEXT NOT NULL,             -- usa {{1}}, {{2}}... como na Meta
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (name, language)
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `,
];

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON;');
  const current = (db.prepare('PRAGMA user_version').get() as Row).user_version as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const nowIso = () => new Date().toISOString();

export function audit(db: Db, userId: number | null, action: string, entity: string, entityId: number | null, detail?: unknown) {
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?)').run(
    userId, action, entity, entityId, detail === undefined ? null : JSON.stringify(detail),
  );
}
