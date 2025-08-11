export interface EvalResult {
  score: number;              // 0..100
  rationale: string;          // <= 200 chars
  advice: string;             // <= 200 chars
  version: string;            // rubric version
  model: string;              // model id
}

export abstract class EvaluatorPort {
  abstract evaluate(planText: string, updateText: string): Promise<EvalResult>;
}
