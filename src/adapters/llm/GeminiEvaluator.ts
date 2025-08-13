import { EvaluatorPort, EvalResult } from "../../core/ports/EvaluatorPort";

type GeminiOptions = {
  apiKey?: string;       // opcional de entrada; internamente se normaliza a string
  model?: string;
  rubricVersion?: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseUrl?: string;      // opcional (override), por defecto el endpoint público
};

export class GeminiEvaluator extends EvaluatorPort {
  private readonly apiKey: string;        // nunca undefined
  private readonly model: string;
  private readonly rubricVersion: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;

  constructor(opts: GeminiOptions) {
    super();
    // Normaliza para satisfacer exactOptionalPropertyTypes
    this.apiKey = (opts.apiKey ?? process.env.GEMINI_API_KEY ?? "").trim();
    this.model = opts.model ?? (process.env.LLM_MODEL ?? "gemini-2.5-flash");
    this.rubricVersion = opts.rubricVersion ?? (process.env.LLM_RUBRIC_VERSION ?? "v1");
    this.timeoutMs =
      typeof opts.timeoutMs === "number"
        ? opts.timeoutMs
        : Number.parseInt(process.env.GEMINI_TIMEOUT_MS ?? "", 10) || 6000;
    this.maxRetries =
      typeof opts.maxRetries === "number"
        ? opts.maxRetries
        : Number.parseInt(process.env.GEMINI_MAX_RETRIES ?? "", 10) || 2;
    this.baseUrl = (opts.baseUrl ?? process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com").replace(
      /\/+$/,
      ""
    );

    if (!this.apiKey) {
      console.warn("[GeminiEvaluator] GEMINI_API_KEY ausente: se usará evaluación heurística local.");
    }
  }

  async evaluate(planText: string, updateText: string): Promise<EvalResult> {
    // Fallback determinista si no hay API key
    if (!this.apiKey) {
      return heuristic(planText, updateText, this.rubricVersion, "dummy");
    }

    const prompt = this.buildPrompt(planText, updateText);
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
    };

    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), this.timeoutMs);

        const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // ✅ API key en header (no loguear nunca este valor)
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(tid);
        console.log(`[GeminiEvaluator] Respuesta HTTP ${res.text} (${this.model})`);
        if (res.ok) {
          const data: any = await res.json().catch(() => ({}));
          const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
          console.log(`[GeminiEvaluator] Respuesta JSON: ${raw.slice(0, 200)}`);
          const parsed = safeParseJSON(raw);
          console.log(`[GeminiEvaluator] Evaluación: ${parsed}`);
          const score = clampNumber(parsed.score, 0, 100, 60);
          const out: EvalResult = {
            score,
            rationale: String(parsed.rationale ?? "").slice(0, 200),
            advice: String(parsed.advice ?? "").slice(0, 200),
            version: this.rubricVersion,
            model: this.model,
          };
          return out;
        }

        // Reintentar para 429/5xx
        if ([429, 500, 502, 503, 504].includes(res.status)) {
          const b = backoffMs(attempt);
          console.warn(`[GeminiEvaluator] HTTP ${res.status}; reintento en ${b}ms (intento ${attempt + 1}/${this.maxRetries}).`);
          await sleep(b);
          continue;
        }

        const txt = await res.text();
        console.error(`[GeminiEvaluator] Respuesta no reintetable ${res.status}: ${txt.slice(0, 200)}`);
        lastErr = new Error(`Gemini ${res.status}`);
        break;
      } catch (e: any) {
        lastErr = e;
        if (attempt < this.maxRetries) {
          const b = backoffMs(attempt);
          console.warn(`[GeminiEvaluator] Falla de red/timeout (${e?.name || e}); reintento en ${b}ms.`);
          await sleep(b);
          continue;
        }
      }
    }

    // Fallback heurístico si agotamos reintentos
    console.error(`[GeminiEvaluator] Fallback heurístico por error: ${(lastErr as any)?.message || String(lastErr)}`);
    return heuristic(planText, updateText, this.rubricVersion, `${this.model}-fallback`);
  }

  private buildPrompt(planText: string, updateText: string): string {
    return [
      "Eres un evaluador de dailys Agile. Devuelve JSON con: score (0..100), rationale (<=200), advice (<=200).",
      `Plan:\n${planText}`,
      `Resultado:\n${updateText}`,
      "Criterios: claridad del plan, alineación plan-resultado, evidencia de cumplimiento. Umbral 100 = cumplimiento total.",
      "Responde SOLO JSON válido.",
    ].join("\n");
  }
}

/* ================= Fallback heurístico ================= */

function heuristic(plan: string, result: string, version: string, model: string): EvalResult {
  const score = computeHeuristicScore(plan, result);
  const advice =
    score === 100 ? "Sigue con la misma disciplina." : "Define 1–3 objetivos concretos y medibles para mañana.";
  const rationale =
    score === 100 ? "Plan y resultado alineados (heurística)." : "No se encontró evidencia fuerte de cumplimiento (heurística).";
  return { score, advice, rationale, version, model };
}

function computeHeuristicScore(plan: string, result: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const A = new Set(norm(plan).split(" ").filter((w) => w.length > 2));
  const B = new Set(norm(result).split(" ").filter((w) => w.length > 2));
  if (!B.size) return 50;

  let overlap = 0;
  for (const w of B) if (A.has(w)) overlap++;
  const ratio = overlap / Math.max(1, A.size);

  if (/(\bno\b|\bno logré\b|\bno pude\b|pendiente)/i.test(result)) return 60;
  if (ratio >= 0.5 && result.length >= 20) return 100;
  if (ratio >= 0.3 && result.length >= 20) return 90;
  return 70;
}

/* ================= Utilidades ================= */

function safeParseJSON(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    console.warn(`[GeminiEvaluator] JSON inválido: ${s}`);
    return {};
  }
}

function clampNumber(n: any, lo: number, hi: number, def: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return def;
  return Math.max(lo, Math.min(hi, x));
}

function backoffMs(attempt: number): number {
  const base = 300; // ms
  const factor = 2 ** attempt;
  const jitter = Math.floor(Math.random() * 200);
  return base * factor + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
