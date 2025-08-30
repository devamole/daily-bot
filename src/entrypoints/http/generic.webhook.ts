import { migrateOnce } from "../../db/migrate";
import { db } from "../../db/db";
import { TursoRepo } from "../../adapters/repo/TursoRepo";
import { TelegramHttpNotifier } from "../../adapters/notifier/TelegramHttpNotifier";
import { DailyService } from "../../core/daily/DailyService";
import { TelegramAdapter } from "../../adapters/channel/telegram/TelegramAdapter";
import { createEvaluatorFromEnv } from "../../adapters/llm"; // <-- nuevo factory

/**
 * Webhook genérico: puede recibir (req, res) o un body crudo.
 * - Si recibe (req, res): responde HTTP aquí mismo (Vercel/Next API).
 * - Si recibe solo (body): devuelve { ok: true } (modo programático).
 */
export default async function genericWebhook(
  reqOrBody: any,
  res?: {
    status?: (code: number) => any;
    setHeader?: (k: string, v: string) => void;
    end?: (body?: any) => void;
    statusCode?: number;
  }
): Promise<{ ok: true } | void> {
  await migrateOnce();

  const repo = new TursoRepo(db);

  const token = process.env.TG_TOKEN || "";
  if (!token) throw new Error("TG_TOKEN is required");

  const notifier = new TelegramHttpNotifier(token);

  // --- Evaluador desacoplado (Gemini / Deepseek / Fallback) ---
  const evaluator = createEvaluatorFromEnv();

  // Inyectamos solo la función (no acoplamos DailyService a implementaciones)
  const service = new DailyService(repo, notifier, evaluator.evaluate.bind(evaluator));
  const adapter = new TelegramAdapter(repo, notifier, service);

  // Extrae el body: si nos pasaron (req,res), usa req.body; si no, trata el primer arg como body.
  const body = (reqOrBody && typeof reqOrBody === "object" && "body" in reqOrBody)
    ? (reqOrBody as any).body
    : reqOrBody;

  try {
    await adapter.handleUpdate(body ?? {});
  } catch (err) {
    console.error("Error handling update:", err);
    if (res) {
      res.status?.(200);
      res.setHeader?.("Content-Type", "text/plain; charset=utf-8");
      res.end?.("OK");
      return;
    }
    return { ok: true };
  }

  if (res) {
    res.status?.(200);
    res.setHeader?.("Content-Type", "application/json; charset=utf-8");
    res.end?.('{"ok":true}');
    return;
  }
  return { ok: true };
}
