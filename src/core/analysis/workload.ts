export type TaskComplexity = "XS" | "S" | "M" | "L" | "XL";
export type ExtractedTask = {
  pos: number;
  text: string;
  est_complexity: TaskComplexity;
  est_points: number; // XS=1, S=2, M=3, L=5, XL=8
};

const POINTS: Record<TaskComplexity, number> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };

export function extractTasksHeuristic(plan: string): ExtractedTask[] {
  if (!plan) return [];
  const lines = plan
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    // bullets: -, *, •, or "1. ", "2) ", etc.
    .map(l => l.replace(/^[\-\*\u2022]\s+/, "").replace(/^\d+[\.\)]\s+/, "").trim())
    .filter(Boolean);

  const tasks: ExtractedTask[] = [];
  let pos = 1;

  for (const raw of lines) {
    const text = raw.replace(/["“”]/g, "").trim();
    if (!text) continue;

    // heurística simple: conteo de palabras, conectores, keywords “grandes”
    const wc = text.split(/\s+/).length;
    const connectors = (text.match(/\b(y|and|;|,)\b/gi) || []).length;
    const big = /\b(migrar|refactor|infraestructura|integrar|desplegar|deploy|migrat|refactor|infra|integration)\b/i.test(text);
    const research = /\b(investigar|aprender|tutorial|documentacion|investigate|learn)\b/i.test(text);

    let complexity: TaskComplexity = "S";
    if (wc <= 5 && !connectors && !big) complexity = "XS";
    else if (wc <= 10 && connectors <= 1 && !big) complexity = "S";
    else if (wc <= 18 && connectors <= 2) complexity = "M";
    else if (big || connectors >= 2 || wc > 18) complexity = "L";
    if (big && connectors >= 2) complexity = "XL";
    if (research && complexity === "XS") complexity = "S";

    tasks.push({
      pos: pos++,
      text,
      est_complexity: complexity,
      est_points: POINTS[complexity],
    });
  }
  return tasks;
}

export type WorkloadLevel = "low" | "normal" | "high";

export function classifyWorkload(totalPoints: number, baselinePointsPerDay = 5): WorkloadLevel {
  const lowT = 0.7 * baselinePointsPerDay;
  const highT = 1.3 * baselinePointsPerDay;
  if (totalPoints < lowT) return "low";
  if (totalPoints > highT) return "high";
  return "normal";
}
