import { EvaluatorPort, EvalResult } from "../../core/ports/EvaluatorPort";

interface GeminiOptions {
  apiKey?: string;
  model?: string;
  rubricVersion?: string;
}

export class GeminiEvaluator extends EvaluatorPort {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly rubricVersion: string;

  constructor(opts: GeminiOptions) {
    super();
    this.apiKey = opts.apiKey;
    this.model = opts.model || 'gemini-1.5-flash';
    this.rubricVersion = opts.rubricVersion || 'v1';
    if (!this.apiKey) {
      console.warn('[GeminiEvaluator] GEMINI_API_KEY ausente: se usará evaluación dummy.');
    }
  }

  async evaluate(planText: string, updateText: string): Promise<EvalResult> {
    console.log('[GeminiEvaluator] Evaluando plan y resultado con Gemini...');
    if (!this.apiKey) {
      console.warn('[GeminiEvaluator] Usando evaluación dummy (API_KEY ausente)');
      const ok = planText.trim().length > 5 && updateText.trim().length > 5;
      return {
        score: ok ? 100 : 60,
        rationale: ok ? 'Plan y resultado coherentes (dummy).' : 'Resultado insuficiente (dummy).',
        advice: ok ? 'Sigue así.' : 'Define objetivos más concretos y medibles.',
        version: this.rubricVersion,
        model: 'dummy'
      };
    }

    const prompt = [
      { text: "Eres un evaluador de dailys Agile. Devuelve JSON con: score (0..100), rationale (<=200), advice (<=200)." },
      { text: `Plan:\n${planText}` },
      { text: `Resultado:\n${updateText}` },
      { text: "Criterios: claridad del plan, alineación plan-resultado, evidencia de cumplimiento. Umbral 100 = cumplimiento total." },
      { text: "Responde SOLO JSON válido." }
    ];
    console.log('[GeminiEvaluator] Prompt:', prompt.map(p => p.text).join('\n'));
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: prompt.map(p => ({ text: p.text })) }] })
    });

    const data: any = await r.json().catch(() => ({}));
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    console.log('[GeminiEvaluator] Respuesta cruda:', raw);
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const score = clamp(parseInt(parsed.score, 10), 0, 100);
    return {
      score,
      rationale: String(parsed.rationale ?? '').slice(0, 200),
      advice: String(parsed.advice ?? '').slice(0, 200),
      version: this.rubricVersion,
      model: this.model
    };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
