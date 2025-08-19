import { db } from "./db";

let _migrated: Promise<void> | null = null;

export async function migrateOnce(): Promise<void> {
  if (_migrated) return _migrated;
  _migrated = ensureSchema();
  return _migrated;
}

async function ensureSchema(): Promise<void> {
  const tx = await db.transaction("write");
  let committed = false;
  try {
    await tx.execute(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        tz TEXT DEFAULT 'America/Bogota',
        provider TEXT DEFAULT 'telegram',
        provider_user_id TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS daily_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending_morning','pending_update','needs_followup','done','expired')),
        score INTEGER,
        eval_model TEXT,
        eval_version TEXT,
        eval_rationale TEXT,
        morning_prompt_at INTEGER,
        evening_prompt_at INTEGER,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        UNIQUE (user_id, date)
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        daily_id INTEGER,
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        message_id INTEGER,
        update_id TEXT,
        provider TEXT DEFAULT 'telegram',
        text TEXT,
        timestamp INTEGER,
        type TEXT CHECK (type IN ('morning','update','followup','chat','system')),
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);

    // Asegura columnas si ya existían tablas antiguas
    await addColumnIfMissing(tx, "daily_status", "morning_prompt_at", "INTEGER");
    await addColumnIfMissing(tx, "daily_status", "evening_prompt_at", "INTEGER");
    await addColumnIfMissing(tx, "messages", "daily_id", "INTEGER");
    await addColumnIfMissing(tx, "messages", "provider", "TEXT DEFAULT 'telegram'");
    await addColumnIfMissing(tx, "messages", "update_id", "TEXT");

    // Índices
    await tx.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uq_msg_event ON messages(provider, update_id)`);
    await tx.execute(`CREATE INDEX IF NOT EXISTS ix_messages_user_ts ON messages(user_id, timestamp)`);
    await tx.execute(`CREATE INDEX IF NOT EXISTS ix_messages_daily_type ON messages(daily_id, type, id)`);
    await tx.execute(`CREATE INDEX IF NOT EXISTS ix_daily_user_date ON daily_status(user_id, date)`);

    await tx.commit(); committed = true;
  } catch (e) {
    if (!committed) { try { await tx.rollback(); } catch {} }
    throw e;
  }
}

async function addColumnIfMissing(tx: any, table: string, column: string, def: string) {
  const { rows } = await tx.execute(`PRAGMA table_info(${table})`);
  const exists = rows.some((r: any) => String(r.name) === column);
  if (!exists) {
    await tx.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}
