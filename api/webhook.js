// api/webhook.js
import bot from '../lib/bot.js';
import { migrate } from '../src/db.js';

// Desactiva el body parser de Vercel para recibir el JSON crudo
export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  // Solo POST permitido
  if (req.method !== 'POST') {
    return res.status(405).end('Método no permitido');
  }

  const { secret } = req.query;
  if (secret !== process.env.SECRET) {
    return res.status(403).end('Secreto inválido');
  }

  // Asegura que la base de datos esté migrada
  try {
    await migrate();
  } catch (err) {
    console.error('Error en migrate() en webhook:', err);
    return res.status(500).end('Error interno');
  }

  // Procesa la actualización en TelegramBot
  try {
    await bot.processUpdate(req.body);
  } catch (err) {
    console.error('Error en processUpdate:', err);
    // Telegram espera 200 aún si hay errores internos
  }

  return res.status(200).end('OK');
}
