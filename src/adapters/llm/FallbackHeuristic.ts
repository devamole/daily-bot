import { EvaluatorPort, type EvalResult } from "../../core/ports/EvaluatorPort";

export class FallbackHeuristic extends EvaluatorPort {
  private readonly model: string;
  private readonly version: string;

  constructor(model = "heuristic", version = "v1") {
    super();
    this.model = model;
    this.version = version;
  }

  async evaluate(_planText: string, updateText: string): Promise<EvalResult> {
    const ok = /cumpl[ií]|logr[eé]|hecho|termin/i.test(updateText) ? 100 : 70;
    return { score: ok, model: this.model, version: this.version, rationale: "heuristic", advice: "heuristic"};
  }
}
