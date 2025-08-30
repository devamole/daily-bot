import type { EvaluatorPort } from "../../core/ports/EvaluatorPort";
import { GeminiEvaluator } from "./GeminiEvaluator";
import { DeepseekEvaluator } from "./DeepseekEvaluator";
import { FallbackHeuristic } from "./FallbackHeuristic";

/**
 * Crea un EvaluatorPort según variables de entorno:
 *  - LLM_PROVIDER: "gemini" | "deepseek" | "auto" (default: "auto")
 *  - LLM_MODEL:    nombre del modelo (default según provider)
 *  - GEMINI_API_KEY / DEEPSEEK_API_KEY
 *  - LLM_RUBRIC_VERSION
 */
export function createEvaluatorFromEnv(): EvaluatorPort {
  const provider = (process.env.LLM_PROVIDER || "auto").toLowerCase();
  const version = process.env.LLM_RUBRIC_VERSION || "v1";

  if (provider === "gemini" || provider === "auto") {
    const key = (process.env.GEMINI_API_KEY ?? "").trim();
    const model = (process.env.LLM_MODEL || "gemini-2.5-flash").trim();
    if (provider === "gemini") {
      if (!key) return new FallbackHeuristic("gemini-fallback", version);
      return new GeminiEvaluator({ apiKey: key, model, rubricVersion: version });
    }
    if (provider === "auto" && key) {
      return new GeminiEvaluator({ apiKey: key, model, rubricVersion: version });
    }
  }

  if (provider === "deepseek" || provider === "auto") {
    const key = (process.env.DEEPSEEK_API_KEY ?? "").trim();
    const model = (process.env.LLM_MODEL || "deepseek-chat").trim();
    if (provider === "deepseek") {
      if (!key) return new FallbackHeuristic("deepseek-fallback", version);
      return new DeepseekEvaluator({ apiKey: key, model, rubricVersion: version });
    }
    if (provider === "auto" && key) {
      return new DeepseekEvaluator({ apiKey: key, model, rubricVersion: version });
    }
  }

  // Último recurso
  return new FallbackHeuristic("heuristic", version);
}
