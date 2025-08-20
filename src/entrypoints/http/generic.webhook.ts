// src/entrypoints/http/generic.webhook.ts
import { migrateOnce } from "../../db/migrate";
import { db } from "../../db/db";
import { TursoRepo } from "../../adapters/repo/TursoRepo";
import { TelegramHttpNotifier } from "../../adapters/notifier/TelegramHttpNotifier";
import { DailyService } from "../../core/daily/DailyService";
import TelegramAdapter from "../../adapters/channel/telegram/TelegramAdapter";

/** Evaluador: usa Gemini JSON; si falla, devuelve heurístico simple. */
async function evaluate(planText: string, updateText: string): Promise<{
  score: number; rationale?: string; advice?: string; model?: string; version?: string;
}> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  const model = process.env.LLM_MODEL || "gemini-2.5-flash";
  const version = process.env.LLM_RUBRIC_VERSION || "v1";

  if (!apiKey) {
    // Fallback: si no hay API key, heurística mínima
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
      "content-type": "application/json"
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 200,
        responseMimeType: "application/json"
      }
    })
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
      version
    };
  } catch {
    const ok = /cumpl[ií]|logr[eé]|hecho|termin/i.test(updateText) ? 100 : 70;
    return { score: ok, model, version, rationale: "fallback-parse-error" };
  }
}

/**
 * Webhook genérico: procesa updates de Telegram.
 * Este método lo invoca tu wrapper de Vercel (`api/telegram.js`).
 */
export default async function genericWebhook(body: any): Promise<{ ok: true }> {
  await migrateOnce();

  const repo = new TursoRepo(db); // <-- requiere 1 argumento
  const token = process.env.TG_TOKEN || "";
  if (!token) throw new Error("TG_TOKEN is required");

  const notifier = new TelegramHttpNotifier(token);
  const service = new DailyService(repo, notifier, evaluate); // <-- 3 args
  const adapter = new TelegramAdapter(repo, service);         // <-- 2 args

  await adapter.handleUpdate(body);
  return { ok: true };
}
