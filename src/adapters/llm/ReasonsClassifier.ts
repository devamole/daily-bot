// src/adapters/llm/ReasonsClassifier.ts
// Fallback LLM: clasifica a UNA SOLA etiqueta de un conjunto cerrado.

import { ReasonCode } from "../../core/analysis/reasons";

export const ALLOWED_REASON_CODES = [
  "impediment",
  "blocked_dependency",
  "scope_change",
  "overcommitment",
  "unknown_tech",
  "tech_debt",
  "requirements_clarity",
  "tooling_issues",
  "major_incident",
  "meetings_overload",
  "health_issue",
  "personal_emergency",
  "other",
] as const;

export type ReasonCodeLLM = (typeof ALLOWED_REASON_CODES)[number];
export type ReasonsLLMResult = { code: ReasonCodeLLM };

function sanitizeJson(s: string): string {
  return s.replace(/```[\s\S]*?```/g, "").trim();
}
function validateCode(code: string): code is ReasonCodeLLM {
  return (ALLOWED_REASON_CODES as readonly string[]).includes(code);
}

function buildPrompt(plan: string | null, update: string): string {
  const planBlock = plan ? `"""${plan}"""` : "(no disponible)";
  return `Eres un clasificador de razones por las que un objetivo diario Agile NO se cumplió.
Debes elegir EXACTAMENTE UNA etiqueta del siguiente conjunto permitido:

impediment | blocked_dependency | scope_change | overcommitment | unknown_tech |
tech_debt | requirements_clarity | tooling_issues | major_incident |
meetings_overload | health_issue | personal_emergency | other

Definiciones breves:
- impediment: bloqueo genérico (accesos/permisos/colas), sin depender de otro equipo específico.
- blocked_dependency: esperando a otro equipo/tercero/QA/UX/aprobación.
- scope_change: cambio de alcance/prioridad/pivot.
- overcommitment: mala estimación/sobrecarga/falta de tiempo.
- unknown_tech: curva de aprendizaje/tecnología nueva/desconocimiento.
- tech_debt: deuda técnica/refactor/legacy.
- requirements_clarity: requerimientos poco claros/falta de criterios.
- tooling_issues: CI/CD/build/deploy/pipeline/runner/entornos.
- major_incident: incidente mayor/P0/P1/producción.
- meetings_overload: muchas reuniones/back-to-back.
- health_issue: problemas de salud.
- personal_emergency: urgencia personal/familiar.
- other: ninguna de las anteriores aplica razonablemente.

Entrada:
- Plan de la mañana (opcional): ${planBlock}
- Actualización del final del día: """${update}"""

Reglas:
1) Elige la ÚNICA etiqueta que mejor explique la NO completitud (o “other”).
2) Devuelve SOLO JSON, sin texto adicional, con el siguiente formato exacto:
{"code":"<etiqueta_permitida>"}`;
}

export class ReasonsClassifierLLM {
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.LLM_REASON_MODEL || "gemini-2.5-flash"
  ) {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is required for ReasonsClassifierLLM");
  }

  async classify(plan: string | null, update: string, timeoutMs = 2200): Promise<ReasonsLLMResult> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const prompt = buildPrompt(plan, update);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": this.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 40,
            responseMimeType: "application/json",
          },
        }),
        signal: ctrl.signal,
      });

      const raw = await res.text();
      if (!res.ok) throw new Error(`LLM ${res.status}: ${raw.slice(0, 400)}`);

      const data = JSON.parse(raw);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const cleaned = sanitizeJson(text);
      const parsed = JSON.parse(cleaned);

      const code = String(parsed?.code ?? "").trim();
      if (!validateCode(code)) return { code: "other" };
      return { code: code as ReasonCodeLLM };
    } catch {
      return { code: "other" };
    } finally {
      clearTimeout(t);
    }
  }
}
