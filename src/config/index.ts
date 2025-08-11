import { DEFAULTS } from "./defaults";

export interface AppConfig {
  telegramToken: string;
  telegramSecret: string;
  tursoUrl: string;
  tursoAuthToken?: string;
  geminiApiKey?: string;
  llmModel: string;
  llmRubricVersion: string;
  defaultTz: string;
}

export function loadConfig(): AppConfig {
  const telegramToken = mustGet('TELEGRAM_TOKEN');
  const telegramSecret = mustGet('TELEGRAM_WEBHOOK_SECRET');
  const tursoUrl = mustGet('TURSO_DATABASE_URL');

  return {
    telegramToken,
    telegramSecret,
    tursoUrl,
    tursoAuthToken: process.env.TURSO_AUTH_TOKEN,
    geminiApiKey: process.env.GEMINI_API_KEY,
    llmModel: process.env.LLM_MODEL || DEFAULTS.LLM_MODEL,
    llmRubricVersion: process.env.LLM_RUBRIC_VERSION || DEFAULTS.LLM_RUBRIC_VERSION,
    defaultTz: process.env.DEFAULT_TZ || DEFAULTS.TZ
  };
}

function mustGet(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Falta variable de entorno: ${k}`);
  return v;
}