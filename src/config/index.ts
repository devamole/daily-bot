import { DEFAULTS } from "./defaults";

export interface AppConfig {
  telegramToken: string;
  telegramSecret: string;
  tursoUrl: string;
  // Opcionales: solo se agregan si existen (no se asigna undefined)
  tursoAuthToken?: string;
  geminiApiKey?: string;
  llmModel: string;
  llmRubricVersion: string;
  defaultTz: string;
}

export function loadConfig(): AppConfig {
  const telegramToken = must('TELEGRAM_TOKEN');
  const telegramSecret = must('TELEGRAM_WEBHOOK_SECRET');
  const tursoUrl = must('TURSO_DATABASE_URL');

  const cfg: AppConfig = {
    telegramToken,
    telegramSecret,
    tursoUrl,
    llmModel: process.env.LLM_MODEL ?? DEFAULTS.LLM_MODEL,
    llmRubricVersion: process.env.LLM_RUBRIC_VERSION ?? DEFAULTS.LLM_RUBRIC_VERSION,
    defaultTz: process.env.DEFAULT_TZ ?? DEFAULTS.TZ
  };

  // Agrega opcionales SOLO si existen (evita asignar undefined)
  if (process.env.TURSO_AUTH_TOKEN) cfg.tursoAuthToken = process.env.TURSO_AUTH_TOKEN!;
  if (process.env.GEMINI_API_KEY)    cfg.geminiApiKey  = process.env.GEMINI_API_KEY!;

  return cfg;
}

function must(k: string): string {
  const v = process.env[k];
  if (v == null || v === '') throw new Error(`Falta variable de entorno: ${k}`);
  return v;
}
