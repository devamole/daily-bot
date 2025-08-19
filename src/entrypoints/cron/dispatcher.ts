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

function readAuthorizationHeader(req: any): string | null {
  const hObj =
    (req?.headers?.authorization as string | undefined) ??
    (req?.headers?.Authorization as string | undefined);
  if (typeof hObj === "string") return hObj;

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
    // Permite, solo con fines de desarrollo
    return true;
  }
  const auth = readAuthorizationHeader(req);
  if (!auth) return false;
  const [scheme, token] = auth.split(" ");
  return scheme === "Bearer" && token === expected;
}

export default async function handler(req: any, res: any) {
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
