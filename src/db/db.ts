import { createClient, Client } from "@libsql/client";

export const db: Client = createClient({
  url: process.env.TURSO_DATABASE_URL || '',
  authToken: process.env.TURSO_AUTH_TOKEN
});

export type QueryResult = Awaited<ReturnType<Client['execute']>>;