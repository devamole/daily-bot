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
  execute: (sql: string, args?: unknown[]) => Promise<any>;
  commit?: () => Promise<void>;
  rollback?: () => Promise<void>;
};

async function ensureSchema(): Promise<void> {
  const tx = (await db.transaction("write")) as Execable;
  let committed = false;
  try {
    // Recomendado en SQLite/libsql cuando usas FKs
    await tx.execute(`PRAGMA foreign_keys=ON`);

    // --- Tabla users (creación idempotente) ---
    await tx.execute(`
      CREATE TABLE IF NOT EXISTS users (
        user_id           TEXT PRIMARY KEY,
        chat_id           TEXT NOT NULL,
        tz                TEXT NOT NULL DEFAULT 'America/Bogota',
        provider          TEXT NOT NULL DEFAULT 'telegram',
        provider_user_id  TEXT,
        created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);

    // --- Corrección de esquema legacy: update_at -> updated_at ---
    await ensureUpdatedAtOnUsers(tx);

    // --- Tabla daily_status ---
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

    // --- Tabla messages ---
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

    // --- Tabla daily_tasks ---
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

    // --- Tabla daily_reasons ---
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

/** Si la tabla users tiene 'update_at' pero no 'updated_at', añade 'updated_at' y copia datos. */
async function ensureUpdatedAtOnUsers(ex: Execable): Promise<void> {
  const cols = await getTableColumns(ex, "users");
  const hasUpdatedAt = cols.includes("updated_at");
  const hasLegacyUpdateAt = cols.includes("update_at"); // typo

  if (!hasUpdatedAt) {
    // Añade updated_at con default unixepoch()
    await ex.execute(`ALTER TABLE users ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (unixepoch())`);
    // Si existe la legacy, copia su valor; si no, deja created_at como base
    if (hasLegacyUpdateAt) {
      await ex.execute(`UPDATE users SET updated_at = COALESCE(update_at, created_at) WHERE updated_at IS NULL`);
      // (Opcional) No intentamos eliminar 'update_at' por compatibilidad.
    } else {
      await ex.execute(`UPDATE users SET updated_at = COALESCE(updated_at, created_at)`);
    }
  }
}

async function addColumnIfMissing(
  ex: Execable,
  table: string,
  column: string,
  type: string
) {
  const cols = await getTableColumns(ex, table);
  if (!cols.includes(column)) {
    await ex.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

async function getTableColumns(ex: Execable, table: string): Promise<string[]> {
  const res = await ex.execute(`PRAGMA table_info(${table})`);
  const rows = (res && (res as any).rows) ? (res as any).rows : [];
  return rows.map((r: any) => String(r.name));
}
