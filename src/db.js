import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";
import { config } from "dotenv";

// 6.1 Carga de .env
config();

// Cliente Turso
export const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

/**
 * Ejecuta las migraciones SQL dividiendo por sentencias individuales
 */
export async function migrate() {
  const migrationsPath = path.join(process.cwd(), "migrations", "create_tables.sql");
  const sqlContent = fs.readFileSync(migrationsPath, "utf8");
  // Separar por ‘;’ seguido de salto de línea y limpiar sentencias vacías
  const statements = sqlContent
    .split(/;\s*\n/)
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0);

  for (const stmt of statements) {
    await db.execute({ sql: stmt });
  }
}
