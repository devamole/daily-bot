import "dotenv/config";
import bot from '../lib/bot';

export const config = {
  api: {
    // no necesitamos bodyParser aquí, es una petición GET
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // Solo GET para configuración manual
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // 1) Calcula el dominio dinámico
    const env   = process.env.VERCEL_ENV;
    const isDev = env === 'development';
    const domain = `https://${isDev
      ? 'fd43-181-237-26-55.ngrok-free.app'
      : "daily-bot-chi.vercel.app" //process.env.VERCEL_URL
      }`;

    // 2) Construye la URL de webhook con query param
    const webhookUrl = `${domain}/api/webhook?secret=${process.env.SECRET}`;

    // 3) Comprueba si ya existe y coincide
    const info = await bot.getWebHookInfo();
    if (info.url === webhookUrl) {
      return res
        .status(200)
        .json({ ok: true, action: 'noop', message: 'Webhook already set', url: info.url });
    }

    // 4) (Re)registra el webhook
    const result = await bot.setWebHook(webhookUrl);

    return res
      .status(200)
      .json({ ok: true, action: 'set', result, webhookUrl });
  } catch (err) {
    console.error('Error setting webhook:', err);
    return res
      .status(500)
      .json({ ok: false, error: err.message });
  }
}

