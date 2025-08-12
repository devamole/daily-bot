import { createClient, type Client } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("Falta TURSO_DATABASE_URL");

export const db: Client = createClient({
  url,
  ...(process.env.TURSO_AUTH_TOKEN ? { authToken: process.env.TURSO_AUTH_TOKEN } : {})
});