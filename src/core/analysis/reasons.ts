// src/core/analysis/reasons.ts
// Heurística multi-etiqueta robusta para razones de no-compleción.
// - ES/EN, normalización sin acentos
// - ventana de negación, patrones ponderados, boosts por co-ocurrencia
// - calibración a [0,1], O(tokens)
// - lista de códigos consistente para integrarse con LLM

export type ReasonCode =
  | "impediment"
  | "tech_debt"
  | "unknown_tech"
  | "major_incident"
  | "scope_change"
  | "overcommitment"
  | "blocked_dependency"
  | "meetings_overload"
  | "requirements_clarity"
  | "tooling_issues"
  | "health_issue"
  | "personal_emergency";

export type TaggedReason = {
  code: ReasonCode;
  confidence: number;      // [0,1]
  evidence?: string[];     // frases que aportaron score (debug)
};

export type ReasonTaggerOptions = {
  topK?: number;           // default 3
  minConfidence?: number;  // default 0.45
  debug?: boolean;         // evidencia
};

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
function normalizeText(s: string): string {
  return stripDiacritics(s.toLowerCase()).replace(/\s+/g, " ").trim();
}
function splitSentences(s: string): string[] {
  return (s || "")
    .split(/[\.\!\?\;\n\r]+/g)
    .map(x => x.trim())
    .filter(Boolean);
}
function tokenize(s: string): string[] {
  return s.split(/[^a-z0-9_áéíóúüñ]+/i).filter(Boolean);
}

type Pat = { re: RegExp; w: number };

const LEXICON: Record<ReasonCode, Pat[]> = {
  impediment: [
    { re: /\b(bloquead[oa]s?|bloqueo|bloquear|atasc[ao]|trabad[oa])\b/, w: 2.2 },
    { re: /\b(esperand[oa]|pendiente de|en cola|sin respuesta)\b/, w: 1.6 },
    { re: /\b(acceso|permis[oa]s?|credenciales?)\b/, w: 1.8 },
    { re: /\b(dependenc(ia|ias)|dependant|blocked by)\b/, w: 1.6 },
  ],
  tech_debt: [
    { re: /\b(deuda tecnica|tech debt|legacy|monolit[oa])\b/, w: 2.0 },
    { re: /\b(refactor(e|izar|izacion)?|re-estructurar)\b/, w: 1.6 },
    { re: /\b(adecuar|sanear|limpieza de codigo)\b/, w: 1.2 },
  ],
  unknown_tech: [
    { re: /\b(no (sabia|conocia)|desconoc(ia|ido))\b/, w: 1.6 },
    { re: /\b(aprend(iendo|izaje)|investig(ar|ando)|tutorial|docu(mentacion)?)\b/, w: 1.6 },
    { re: /\b(por primera vez|rampa|ramp ?up)\b/, w: 1.2 },
  ],
  major_incident: [
    { re: /\b(incidente|caida|outage|severidad|sev[0-2]|p0|p1)\b/, w: 2.6 },
    { re: /\b(prod(uction)?|en produccion|servicio critico)\b/, w: 1.8 },
  ],
  scope_change: [
    { re: /\b(cambio de alcance|scope change|pivot|repriorizar|reprioritiz(e|ed|ing))\b/, w: 2.0 },
    { re: /\b(prioridad(es)?|replanificar|plan cambio)\b/, w: 1.4 },
  ],
  overcommitment: [
    { re: /\b(no alcance|no me dio el tiempo|me falt[oó] tiempo|time ran out)\b/, w: 2.0 },
    { re: /\b(much[ao] trabajo|sobrecarg[ao]|overcommit|demasiadas tareas)\b/, w: 1.6 },
    { re: /\b(subestim[ée]?)\b/, w: 1.4 },
  ],
  blocked_dependency: [
    { re: /\b(esperand[oa].*(equipo|tercero|proveedor|qa|ux|devops))\b/, w: 2.0 },
    { re: /\b(dependenc(ia|ias) externas|third-?party)\b/, w: 1.6 },
  ],
  meetings_overload: [
    { re: /\b(reuniones?|meetings?)\b/, w: 1.4 },
    { re: /\b(back-?to-?back|bloque.*(reunion|meeting))\b/, w: 2.0 },
  ],
  requirements_clarity: [
    { re: /\b(requerimientos? (poco )?clar[oa]s?|ambig[uü]edad|no claro)\b/, w: 2.0 },
    { re: /\b(falt[aó] (contexto|detalles|criterios?))\b/, w: 1.4 },
  ],
  tooling_issues: [
    { re: /\b(ci\/cd|pipeline|build|deploy|runner|pipelines?)\b/, w: 1.6 },
    { re: /\b(fallo|fallas|rompio|errores?)\b/, w: 1.2 },
  ],
  health_issue: [
    { re: /\b(enfermo|salud|gripa|covid|malestar|cita medica)\b/, w: 2.2 },
  ],
  personal_emergency: [
    { re: /\b(emergencia (personal|familiar)|imprevisto familiar|urgencia)\b/, w: 2.4 },
  ],
};

const NEGATIONS = [
  /\b(no|nunca|ya no|sin|dejo de|deje de|dejamos de)\b/,
  /\b(not|never|no longer|without)\b/,
];
const NEGATION_WINDOW = 5;

const BOOSTS: Array<{ codes: [ReasonCode] | [ReasonCode, ReasonCode]; delta: number }> = [
  { codes: ["impediment"], delta: 0.4 },
  { codes: ["impediment", "blocked_dependency"], delta: 0.6 },
  { codes: ["major_incident", "tooling_issues"], delta: 0.5 },
  { codes: ["overcommitment", "meetings_overload"], delta: 0.4 },
];

function toConfidence(score: number, alpha = 2.7): number {
  if (score <= 0) return 0;
  const c = 1 - Math.exp(-score / alpha);
  return Math.max(0, Math.min(1, c));
}

function sentenceScore(sent: string) {
  const tNorm = normalizeText(sent);
  const tokens = tokenize(tNorm).map(stripDiacritics);
  const perCode: Map<ReasonCode, number> = new Map();

  function hasNegationBefore(idxToken: number): boolean {
    const start = Math.max(0, idxToken - NEGATION_WINDOW);
    const window = tokens.slice(start, idxToken).join(" ");
    return NEGATIONS.some(re => re.test(window));
  }

  for (const code of Object.keys(LEXICON) as ReasonCode[]) {
    let score = 0;
    for (const pat of LEXICON[code]) {
      let m: RegExpExecArray | null;
      const re = new RegExp(pat.re.source, pat.re.flags.includes("g") ? pat.re.flags : pat.re.flags + "g");
      let occurrences = 0;
      while ((m = re.exec(tNorm)) && occurrences < 3) {
        occurrences++;
        const prefix = tNorm.slice(0, m.index);
        const idxToken = tokenize(prefix).length;
        const neg = hasNegationBefore(idxToken);
        const w = neg ? pat.w * 0.35 : pat.w;
        score += w;
      }
    }
    if (score > 0) perCode.set(code, (perCode.get(code) || 0) + score);
  }

  for (const b of BOOSTS) {
    const present = b.codes.every(c => (perCode.get(c) ?? 0) > 0);
    if (present) for (const c of b.codes) perCode.set(c, (perCode.get(c) || 0) + b.delta);
  }

  return { perCode };
}

export function tagReasonsHeuristic(
  text: string,
  options: ReasonTaggerOptions = {}
): TaggedReason[] {
  const { topK = 3, minConfidence = 0.45, debug = false } = options;
  const sentences = splitSentences(text || "");
  if (sentences.length === 0) return [];

  const global: Map<ReasonCode, number> = new Map();
  const evidence: Map<ReasonCode, Array<{ s: string; gain: number }>> = new Map();

  for (const s of sentences) {
    const { perCode } = sentenceScore(s);
    for (const [code, gain] of perCode) {
      const prev = global.get(code) || 0;
      global.set(code, prev + gain);
      if (debug) {
        const arr = evidence.get(code) || [];
        if (arr.length < 5) arr.push({ s, gain });
        evidence.set(code, arr);
      }
    }
  }

  const scored = Array.from(global.entries())
    .map(([code, score]) => ({ code, score, confidence: toConfidence(score) }))
    .filter(x => x.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, topK);

  if (!debug) return scored.map(({ code, confidence }) => ({ code, confidence }));

  return scored.map(({ code, confidence }) => {
    const ev = (evidence.get(code) || []).sort((a, b) => b.gain - a.gain).slice(0, 3).map(x => x.s);
    return { code, confidence, evidence: ev };
  });
}

export const REASONS_HEURISTIC_VERSION = "heuristic-v2";
