import { EvaluatorPort, type EvalResult } from "../../core/ports/EvaluatorPort";

/**
 * Opciones de inicialización del evaluador Deepseek.
 */
type DeepseekOptions = {
  apiKey?: string;          // Se normaliza a string interno ('' si falta)
  model?: string;           // p.ej. "deepseek-chat" | "deepseek-reasoner"
  rubricVersion?: string;   // p.ej. "v1"
  timeoutMs?: number;       // timeout por request
  maxRetries?: number;      // número de reintentos ante 429/5xx/abort
  baseUrl?: string;         // override del endpoint (por defecto https://api.deepseek.com/v1)
};

/**
 * Evaluador basado en Deepseek (API OpenAI-compatible).
 * - Endpoint: POST {baseUrl}/chat/completions   (baseUrl por defecto: https://api.deepseek.com/v1)
 * - Headers: Authorization: Bearer <API_KEY>
 * - Retries con backoff exponencial + jitter
 * - Timeout con AbortController
 * - Fallback heurístico determinista
 * - Parser tolerante (quita fences Markdown y extrae primer JSON válido)
 */
export class DeepseekEvaluator extends EvaluatorPort {
  private readonly apiKey: string;        // Nunca undefined ('' si falta)
  private readonly model: string;
  private readonly rubricVersion: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;       // Debe terminar SIN slash final

  constructor(opts: DeepseekOptions) {
    super();
    // Normaliza para satisfacer exactOptionalPropertyTypes
    this.apiKey = (opts.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "").trim();
    this.model = (opts.model ?? process.env.LLM_MODEL ?? "deepseek-chat").trim();
    this.rubricVersion = (opts.rubricVersion ?? process.env.LLM_RUBRIC_VERSION ?? "v1").trim();
    this.timeoutMs =
      typeof opts.timeoutMs === "number"
        ? opts.timeoutMs
        : Number.parseInt(process.env.DEEPSEEK_TIMEOUT_MS ?? "", 10) || 6000;
    this.maxRetries =
      typeof opts.maxRetries === "number"
        ? opts.maxRetries
        : Number.parseInt(process.env.DEEPSEEK_MAX_RETRIES ?? "", 10) || 2;
    // Deepseek recomienda base https://api.deepseek.com (OpenAI-compatible). Usamos /v1 aquí.
    this.baseUrl = (opts.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1")
      .replace(/\/+$/, "");

    if (!this.apiKey) {
      console.warn("[DeepseekEvaluator] DEEPSEEK_API_KEY ausente: se usará evaluación heurística local.");
    }
  }

  /**
   * Evalúa el cumplimiento del plan con el resultado reportado.
   */
  async evaluate(planText: string, updateText: string): Promise<EvalResult> {
    // Fallback determinista si no hay API key configurada
    if (!this.apiKey) {
      console.warn("[DeepseekEvaluator] Usando heurística local por falta de API key.");
      return heuristic(planText, updateText, this.rubricVersion, "deepseek-fallback");
    }

    // Instrucciones estrictas: SOLO JSON
    const system =
      "Eres un evaluador de dailys Agile. Debes responder ÚNICAMENTE un JSON válido con la forma: " +
      '{"score":0..100,"rationale":"<=200 chars","advice":"<=200 chars"}. ' +
      "No incluyas nada más (sin texto extra ni bloques de código).";

    const user =
      `Plan:\n${planText || "(sin plan)"}\n\n` +
      `Resultado:\n${updateText}\n\n` +
      `Criterios: claridad del plan, alineación plan-resultado, evidencia de cumplimiento. ` +
      `Umbral 100 = cumplimiento total.\n` +
      `Responde SOLO JSON válido.`;

    const payload = {
      model: this.model,
      temperature: 0,
      max_tokens: 200,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };

    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), this.timeoutMs);

        const url = `${this.baseUrl}/chat/completions`; // baseUrl ya incluye /v1
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(tid);

        const raw = await res.text().catch(() => "");

        if (res.ok) {
          // OpenAI-like: { choices: [{ message: { content: "<JSON>" } }] }
          let text = "{}";
          try {
            const data: any = raw ? JSON.parse(raw) : {};
            text = data?.choices?.[0]?.message?.content ?? "{}";
          } catch {
            // si falla JSON de la capa externa, intentamos parsear texto crudo
            text = raw || "{}";
          }
          const parsed = safeParseModelJSON(String(text));
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
          console.warn(`[DeepseekEvaluator] HTTP ${res.status} reintento en ${b}ms.`);
          await sleep(b);
          continue;
        }

        // No reintetable: rompe el bucle
        console.error(`[DeepseekEvaluator] Respuesta no reintetable ${res.status}: ${raw.slice(0, 200)}`);
        lastErr = new Error(`Deepseek ${res.status}`);
        break;
      } catch (e: any) {
        lastErr = e;
        if (attempt < this.maxRetries) {
          const b = backoffMs(attempt);
          console.warn(`[DeepseekEvaluator] Falla de red/timeout (${e?.name || e}); reintento en ${b}ms.`);
          await sleep(b);
          continue;
        }
      }
    }

    console.error(`[DeepseekEvaluator] Fallback heurístico por error: ${(lastErr as any)?.message || String(lastErr)}`);
    return heuristic(planText, updateText, this.rubricVersion, `${this.model}-fallback`);
  }
}

/* ===================== Fallback heurístico (mismo criterio) ===================== */

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

/* ===================== Utilidades robustas (idénticas a GeminiEvaluator) ===================== */

function safeParseModelJSON(s: string): any {
  if (!s) return {};
  try { return JSON.parse(s); } catch {}
  const unfenced = stripFences(s).trim();
  if (unfenced !== s.trim()) {
    try { return JSON.parse(unfenced); } catch {}
  }
  const extracted = extractFirstJsonObject(unfenced);
  if (extracted) {
    try { return JSON.parse(extracted); } catch {}
  }
  return {};
}

function stripFences(s: string): string {
  let t = s.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "");
    t = t.replace(/```$/i, "");
  }
  t = t.replace(/```/g, "");
  return t;
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === "\\") {
        esc = true;
      } else if (ch === "\"") {
        inStr = false;
      }
      continue;
    }
    if (ch === "\"") {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function clampNumber(n: unknown, lo: number, hi: number, def: number): number {
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
