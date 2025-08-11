import { migrateOnce } from "../../db/migrate";
import { TelegramAdapter } from "../../adapters/channel/telegram/TelegramAdapter";
import { TelegramNotifier } from "../../adapters/channel/telegram/TelegramNotifier";
import { TursoRepo } from "../../adapters/repo/TursoRepo";
import { GeminiEvaluator } from "../../adapters/llm/GeminiEvaluator";
import { DailyService } from "../../core/daily/DailyService";

const repo = new TursoRepo();
const notifier = new TelegramNotifier(process.env.TELEGRAM_TOKEN || '');
const evaluator = new GeminiEvaluator({
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.LLM_MODEL || 'gemini-1.5-flash',
  rubricVersion: process.env.LLM_RUBRIC_VERSION || 'v1'
});

const defaultTz = process.env.DEFAULT_TZ || 'America/Bogota';
const service = new DailyService(repo, notifier, evaluator, defaultTz);
const adapter = new TelegramAdapter(service);

export async function genericWebhook(req: any, res: any): Promise<void> {
  await migrateOnce();
  const update = await readJson(req);
  await adapter.handleUpdate(update);
  res.status(200).end('OK');
}

async function readJson(req: any): Promise<any> {
  if (req.body) return req.body;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve());
    req.on('error', reject);
  });
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}