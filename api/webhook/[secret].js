import bot from '../../lib/bot.js';
import { migrate } from '../../src/db.js';

// Desactiva el body parser de Next.js para recibir el JSON crudo de Telegram
export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const { secret } = req.query;
  if (secret !== process.env.SECRET) {
    return res.status(403).end();
  }

  // Asegura que la base de datos esté migrada antes de procesar
  await migrate();

  // Pasa la actualización a node-telegram-bot-api
  await bot.processUpdate(req.body);

  return res.status(200).send('OK');
}