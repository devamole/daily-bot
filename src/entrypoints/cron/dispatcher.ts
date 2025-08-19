export const config = { runtime: "nodejs" } as const;

import { migrateOnce } from "../../db/migrate";
import { TursoRepo } from "../../adapters/repo/TursoRepo";
import { TelegramNotifier } from "../../adapters/channel/telegram/TelegramNotifier";
import { CronService } from "../../cron/cronService";

const repo = new TursoRepo();
const notifier = new TelegramNotifier(process.env.TELEGRAM_TOKEN || "");
const cron = new CronService(repo, notifier, {
  morningHour: 8,
  eveningHour: 18,
  windowMinutes: 10,
});

/** Lee el header Authorization tanto en Node (objeto) como si existiera headers.get() */
function readAuthorizationHeader(req: any): string | null {
  // Node/Express/Next API (Node runtime)
  const hObj =
    (req?.headers?.authorization as string | undefined) ??
    (req?.headers?.Authorization as string | undefined);
  if (typeof hObj === "string") return hObj;

  // Por si algún runtime expone Headers (Edge-like)
  try {
    const hGet =
      req?.headers?.get?.("authorization") ??
      req?.headers?.get?.("Authorization");
    if (typeof hGet === "string") return hGet;
  } catch {
    /* ignore */
  }
  return null;
}

function isAuthorized(req: any): boolean {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected) {
    // Si no hay CRON_SECRET definido, permitimos (útil para pruebas locales)
    return true;
  }
  const auth = readAuthorizationHeader(req);
  if (!auth) return false;
  const [scheme, token] = auth.split(" ");
  return scheme === "Bearer" && token === expected;
}

export default async function handler(req: any, res: any) {
  // Solo GET/HEAD por higiene (Vercel Cron invoca GET)
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).end("Method Not Allowed");
  }

  if (!isAuthorized(req)) {
    return res.status(401).end("Unauthorized");
  }

  await migrateOnce();
  const result = await cron.tick();
  res.status(200).json({ ok: true, result });
}
