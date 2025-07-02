import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";

export default async function handler(req, res) {
  try {
    // Construye dinámicamente la URL
    const domain = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://localhost:${process.env.PORT || 3000}`;
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
