import { db } from "./db";

let _migrated: Promise<void> | null = null;

export async function migrateOnce(): Promise<void> {
  if (_migrated) return _migrated;
  _migrated = ensureSchema();
  return _migrated;
}

async function ensureSchema(): Promise<void> {
  // Usa la API de transacciones del cliente (seguro en Turso/libSQL)
  const tx = await db.transaction("write");
  let committed = false;
  try {
    // Tablas (incluyen las columnas que usa tu código: provider y update_id)
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
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        UNIQUE (user_id, date)
      )
    `);

    await tx.execute(`
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
      )
    `);

    // Índices después de asegurar tablas/columnas
    await tx.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uq_msg_event ON messages(provider, update_id)`);
    await tx.execute(`CREATE INDEX IF NOT EXISTS ix_messages_user_ts ON messages(user_id, timestamp)`);

    await tx.commit();
    committed = true;
  } catch (err) {
    // Si la transacción estaba abierta, ciérrala; si ya no, ignora el rollback
    if (!committed) {
      try { await tx.rollback(); } catch {}
    }
    throw err;
  }
}
