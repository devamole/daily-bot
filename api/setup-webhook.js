import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";

export default async function handler(req, res) {
  try {
    // Construye dinámicamente la URL
    const env = process.env.VERCEL_ENV;
    const isDev = env == "development"       
    const domain = `https://${isDev ? "fd43-181-237-26-55.ngrok-free.app" : process.env.VERCEL_URL}`
    const webhookUrl = `${domain}/api/webhook/${process.env.SECRET}`;
    // Instancia un cliente sin webhook
    const bot = new TelegramBot(process.env.TG_TOKEN);
    // (Re)registra el webhook
    const result = await bot.setWebHook(webhookUrl);
    return res.status(200).json({ ok: true, result, webhookUrl });
  } catch (err) {
    console.error("Error setting webhook:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
