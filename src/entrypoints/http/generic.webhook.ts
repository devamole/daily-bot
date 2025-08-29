import { migrateOnce } from "../../db/migrate";
import { db } from "../../db/db";
import { TursoRepo } from "../../adapters/repo/TursoRepo";
import { TelegramHttpNotifier } from "../../adapters/notifier/TelegramHttpNotifier";
import { DailyService } from "../../core/daily/DailyService";
import {TelegramAdapter} from "../../adapters/channel/telegram/TelegramAdapter";

/** Evaluador con Gemini (JSON estricto) + fallback heurístico */
async function evaluate(planText: string, updateText: string): Promise<{
  score: number; rationale?: string; advice?: string; model?: string; version?: string;
}> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  const model = process.env.LLM_MODEL || "gemini-2.5-flash";
  const version = process.env.LLM_RUBRIC_VERSION || "v1";

  // Fallback si no hay API key
  if (!apiKey) {
    const ok = /cumpl[ií]|logr[eé]|hecho|termin/i.test(updateText) ? 100 : 70;
    return { score: ok, model, version, rationale: "fallback-no-key" };
  }

  const prompt = `Eres un evaluador de dailys Agile. Devuelve JSON con:
{"score":0..100,"rationale":"<=200 chars","advice":"<=200 chars"}
Plan:
${planText || "(sin plan)"}
Resultado:
${updateText}
Criterios: claridad del plan, alineación plan-resultado, evidencia de cumplimiento. Umbral 100 = cumplimiento total.
Responde SOLO JSON válido.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 200,
        responseMimeType: "application/json",
      },
    }),
  });

  const raw = await res.text();
  try {
    const data = JSON.parse(raw);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const cleaned = String(text).replace(/```[\s\S]*?```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const s = Number(parsed?.score ?? 0);
    return {
      score: isFinite(s) ? Math.max(0, Math.min(100, Math.round(s))) : 0,
      rationale: parsed?.rationale,
      advice: parsed?.advice,
      model,
      version,
    };
  } catch {
    const ok = /cumpl[ií]|logr[eé]|hecho|termin/i.test(updateText) ? 100 : 70;
    return { score: ok, model, version, rationale: "fallback-parse-error" };
  }
}

/**
 * Webhook genérico: puede recibir (req, res) o un body crudo.
 * - Si recibe (req, res): escribe la respuesta HTTP aquí mismo (Vercel/Next API).
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
  const service = new DailyService(repo, notifier, evaluate);
  const adapter = new TelegramAdapter(repo, notifier, service);

  // Extrae el body: si nos pasaron (req,res), usa req.body; si no, trata el primer arg como body.
  const body = (reqOrBody && typeof reqOrBody === "object" && "body" in reqOrBody)
    ? (reqOrBody as any).body
    : reqOrBody;

  try {
    await adapter.handleUpdate(body ?? {});
  } catch (err) {
    // Telegram prefiere 200 aunque haya errores internos.
    if (res) {
      try {
        res.status?.(200);
        res.setHeader?.("Content-Type", "text/plain; charset=utf-8");
        res.end?.("OK");
      } catch {}
      return;
    }
    // Modo programático: no explotes
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
