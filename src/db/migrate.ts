import { db } from "./db";

let _migrated: Promise<void> | null = null;

export async function migrateOnce(): Promise<void> {
  if (_migrated) return _migrated;
  _migrated = (async () => {
    await ensureSchema();
  })();
  return _migrated;
}

async function ensureSchema(): Promise<void> {
  // Siempre en transacción para evitar estados intermedios
  await db.execute({ sql: `PRAGMA foreign_keys = ON` });
  await db.execute({ sql: `BEGIN IMMEDIATE` });
  try {
    // 1) Tablas (DDL correcto y consistente con el código)
    await db.execute({
      sql: `
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        tz TEXT DEFAULT 'America/Bogota',
        provider TEXT DEFAULT 'telegram',
        provider_user_id TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )`
    });

    await db.execute({
      sql: `
      CREATE TABLE IF NOT EXISTS daily_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending_morning','pending_update','needs_followup','done','expired')),
        score INTEGER,
        eval_model TEXT,
        eval_version TEXT,
        eval_rationale TEXT,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        UNIQUE (user_id, date)
      )`
    });

    // ⚠️ Esta definición incluye 'provider' y 'update_id' (lo que usa el código)
    await db.execute({
      sql: `
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        message_id INTEGER,
        update_id TEXT,
        provider TEXT DEFAULT 'telegram',
        text TEXT,
        timestamp INTEGER,
        type TEXT CHECK (type IN ('morning','update','followup','chat','system')),
        created_at INTEGER DEFAULT (unixepoch())
      )`
    });

    // 2) Índices (crearlos solo después de la tabla correcta)
    await db.execute({
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_msg_event ON messages(provider, update_id)`
    });
    await db.execute({
      sql: `CREATE INDEX IF NOT EXISTS ix_messages_user_ts ON messages(user_id, timestamp)`
    });

    await db.execute({ sql: `COMMIT` });
  } catch (e) {
    await db.execute({ sql: `ROLLBACK` });
    throw e;
  }
}
