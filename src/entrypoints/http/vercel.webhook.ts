export const config = { runtime: 'nodejs' } as const;

import  genericWebhook  from "./generic.webhook";

export default async function handler(req: any, res: any) {
  // Seguridad Telegram: X-Telegram-Bot-Api-Secret-Token
  const secret = req.headers['x-telegram-bot-api-secret-token'] ?? req.headers['X-Telegram-Bot-Api-Secret-Token'];
  if (String(secret) !== String(process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return res.status(403).end('forbidden');
  }
  await genericWebhook(req, res);
}