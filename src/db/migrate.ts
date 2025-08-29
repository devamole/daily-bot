// src/db/migrate.ts
import { db } from "./db";

let _migrated: Promise<void> | null = null;

export async function migrateOnce(): Promise<void> {
  if (_migrated) return _migrated;
  _migrated = ensureSchema();
  return _migrated;
}

// Tipo mínimo compatible con Client y Transaction de @libsql/client
type Execable = {
  execute: (sql: string, args?: unknown[]) => Promise<any>; // ResultSet u otros
  commit?: () => Promise<void>;
  rollback?: () => Promise<void>;
};

async function ensureSchema(): Promise<void> {
  const tx = (await db.transaction("write")) as Execable;
  let committed = false;
  try {
    // --- Tablas base (idempotentes) ---
    await tx.execute(`
      CREATE TABLE IF NOT EXISTS users (
        user_id           TEXT PRIMARY KEY,
        chat_id           TEXT NOT NULL,
        tz                TEXT NOT NULL DEFAULT 'America/Bogota',
        provider          TEXT NOT NULL DEFAULT 'telegram',
        provider_user_id  TEXT,
        created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
        update_at         INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS daily_status (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id            TEXT NOT NULL,
        date               TEXT NOT NULL,
        state              TEXT NOT NULL CHECK (state IN ('pending_morning','pending_update','needs_followup','done','expired')),
        score              INTEGER,
        eval_model         TEXT,
        eval_version       TEXT,
        eval_rationale     TEXT,
        morning_prompt_at  INTEGER,
        evening_prompt_at  INTEGER,
        created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at         INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (user_id, date),
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      )
    `);

    await tx.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        daily_id    INTEGER,
        chat_id     TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        message_id  INTEGER,
        update_id   TEXT,
        provider    TEXT NOT NULL DEFAULT 'telegram',
        text        TEXT,
        timestamp   INTEGER,
        type        TEXT CHECK (type IN ('morning','update','followup','chat','system')),
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (daily_id) REFERENCES daily_status(id),
        FOREIGN KEY (user_id)  REFERENCES users(user_id)
      )
    `);

    // --- Asegurar columnas nuevas en daily_status (idempotente) ---
    await addColumnIfMissing(tx, "daily_status", "first_morning_at", "INTEGER");
    await addColumnIfMissing(tx, "daily_status", "first_update_at", "INTEGER");
    await addColumnIfMissing(tx, "daily_status", "closed_at", "INTEGER");
    await addColumnIfMissing(tx, "daily_status", "workload_points", "INTEGER");
    await addColumnIfMissing(tx, "daily_status", "workload_level", "TEXT");

    // --- Índices recomendados ---
    await tx.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uq_msg_event ON messages(provider, update_id)`);
    await tx.execute(`CREATE INDEX IF NOT EXISTS ix_messages_user_ts ON messages(user_id, timestamp)`);
    await tx.execute(`CREATE INDEX IF NOT EXISTS ix_messages_daily_type ON messages(daily_id, type, id)`);
    await tx.execute(`CREATE INDEX IF NOT EXISTS ix_daily_user_date ON daily_status(user_id, date)`);
    await tx.execute(`CREATE INDEX IF NOT EXISTS ix_daily_closed_at ON daily_status(closed_at)`);
    await tx.execute(`CREATE INDEX IF NOT EXISTS ix_daily_workload ON daily_status(workload_level)`);

    // --- Nueva: daily_tasks ---
    await tx.execute(`
      CREATE TABLE IF NOT EXISTS daily_tasks (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        daily_id        INTEGER NOT NULL,
        user_id         TEXT    NOT NULL,
        pos             INTEGER NOT NULL,
        text            TEXT    NOT NULL,
        est_complexity  TEXT    NOT NULL CHECK (est_complexity IN ('XS','S','M','L','XL')),
        est_points      INTEGER NOT NULL,
        source          TEXT    NOT NULL CHECK (source IN ('heuristic','llm')),
        created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (daily_id) REFERENCES daily_status(id)
      )
    `);
    await tx.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_daily_pos ON daily_tasks(daily_id, pos)`);
    await tx.execute(`CREATE INDEX IF NOT EXISTS ix_tasks_daily ON daily_tasks(daily_id)`);

    // --- Nueva: daily_reasons (multi-etiqueta) ---
    await tx.execute(`
      CREATE TABLE IF NOT EXISTS daily_reasons (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        daily_id      INTEGER NOT NULL,
        code          TEXT    NOT NULL,
        confidence    REAL    NOT NULL,
        source        TEXT    NOT NULL CHECK (source IN ('heuristic','llm','manual')),
        raw           TEXT,
        message_id    INTEGER,
        model_version TEXT,
        created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (daily_id) REFERENCES daily_status(id)
      )
    `);
    await tx.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uq_reasons_daily_code ON daily_reasons(daily_id, code)`);
    await tx.execute(`CREATE INDEX IF NOT EXISTS ix_reasons_daily ON daily_reasons(daily_id)`);

    await tx.commit?.();
    committed = true;
  } finally {
    if (!committed) await tx.rollback?.();
  }
}

async function addColumnIfMissing(
  ex: Execable,
  table: string,
  column: string,
  type: string
) {
  // Consulta PRAGMA dentro de la MISMA transacción/conn
  const res = await ex.execute(`PRAGMA table_info(${table})`);
  // En @libsql/client, res.rows es un array de objetos con 'name'
  const rows = (res && (res as any).rows) ? (res as any).rows : [];
  const exists = rows.some((r: any) => String(r.name) === column);
  if (!exists) {
    await ex.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
