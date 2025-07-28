// lib/bot.js
import TelegramBot from 'node-telegram-bot-api';
import { db } from '../src/db.js';
import { migrate } from '../src/db.js';               // Si usas migrate en bootstrapping
import NotificationService from '../src/notificationService.js';
import { evaluateDaily } from '../src/llmClient.js';

// Detecta entorno y dominio dinámico
const env = process.env.VERCEL_ENV;
const isDev = env === 'development';
const domain = `https://${isDev
  ? 'fd43-181-237-26-55.ngrok-free.app'
  : "https://daily-bot-chi.vercel.app" //process.env.VERCEL_URL
}`;

// Crea la URL del webhook (usando query param)
const hookUrl = `${domain}/api/webhook?secret=${process.env.SECRET}`;

// Inicializa el bot en modo webhook
const bot = new TelegramBot(process.env.TG_TOKEN, { webHook: true });

(async () => {
  // Asegura que la base de datos esté lista antes de configurar webhook
  try {
    await migrate();
  } catch (err) {
    console.error('Error en migrate() antes de setWebHook:', err);
  }

  await bot.setWebHook(hookUrl);
  console.log(`Webhook configurado en: ${hookUrl}`);
})();

// Servicio de notificaciones (prompts y respuestas)
const notif = new NotificationService(bot);

// Handler principal de mensajes entrantes
bot.on('message', async (msg) => {
    console.log("Recibiendo mensaje", msg)
  try {
    const { chat, from, text, message_id, date } = msg;
    const chatId = chat.id;
    const userId = from.id;
    const ts = date;
    const today = new Date(ts * 1000).toISOString().split('T')[0];

    // 1) /start → registro y prompt matutino
    if (text === '/start') {
      await db.execute({
        sql: `INSERT OR IGNORE INTO users (user_id, chat_id) VALUES (?, ?)`,
        args: [userId, chatId],
      });

      const todayDate = new Date().toISOString().split('T')[0];
      await db.execute({
        sql: `DELETE FROM daily_status WHERE user_id = ? AND date = ?`,
        args: [userId, todayDate],
      });

      await db.execute({
        sql: `INSERT INTO daily_status (user_id, date, state) VALUES (?, ?, 'pending_morning')`,
        args: [userId, todayDate],
      });

      await notif.promptMorning(userId);
      return;
    }

    // 2) Obtiene el estado diario actual
    const { rows: statusRows } = await db.execute({
      sql: `SELECT id, state FROM daily_status WHERE user_id = ? AND date = ?`,
      args: [userId, today],
    });

    let type = 'other';
    let dailyId = null;

    // 3a) Respuesta matutina
    if (statusRows.length === 0 || statusRows[0].state === 'pending_morning') {
      type = 'morning';
      if (statusRows.length === 0) {
        const insert = await db.execute({
          sql: `INSERT INTO daily_status (user_id, date, state) VALUES (?, ?, 'pending_update')`,
          args: [userId, today],
        });
        dailyId = insert.lastInsertRowid;
      } else {
        dailyId = statusRows[0].id;
        await db.execute({
          sql: `UPDATE daily_status SET state = 'pending_update' WHERE id = ?`,
          args: [dailyId],
        });
      }
      await notif.ackDaily(userId);

    // 3b) Respuesta vespertina
    } else if (statusRows[0].state === 'pending_update') {
      type = 'update';
      dailyId = statusRows[0].id;

      const { rows: morningRows } = await db.execute({
        sql: `
          SELECT text
          FROM messages
          WHERE user_id = ? AND type = 'morning' AND date(timestamp, 'unixepoch') = ?
          ORDER BY id ASC
          LIMIT 1
        `,
        args: [userId, today],
      });
      const planText = morningRows[0]?.text || '';

      const score = await evaluateDaily(planText, text);

      if (score === 100) {
        await notif.sendCongrats(userId, planText, text);
      } else {
        await db.execute({
          sql: `
            INSERT INTO pending_responses (user_id, daily_id, type)
            VALUES (?, ?, 'followup_question')
          `,
          args: [userId, dailyId],
        });
        await notif.promptFollowUp(userId);
      }

      const newState = score === 100 ? 'done' : 'needs_followup';
      await db.execute({
        sql: `UPDATE daily_status SET state = ?, score = ? WHERE id = ?`,
        args: [newState, score, dailyId],
      });

    // 3c) Procesa follow‑up
    } else if (statusRows[0].state === 'needs_followup') {
      type = 'followup';
      dailyId = statusRows[0].id;

      const { rows: pendingRows } = await db.execute({
        sql: `
          SELECT id
          FROM pending_responses
          WHERE user_id = ? AND daily_id = ? AND sent = FALSE
          ORDER BY id ASC
          LIMIT 1
        `,
        args: [userId, dailyId],
      });

      if (pendingRows.length) {
        const pendingId = pendingRows[0].id;
        await db.execute({
          sql: `
            INSERT INTO follow_up_responses (pending_id, text, timestamp)
            VALUES (?, ?, ?)
          `,
          args: [pendingId, text, ts],
        });
        await db.execute({
          sql: `UPDATE pending_responses SET sent = TRUE WHERE id = ?`,
          args: [pendingId],
        });
        await db.execute({
          sql: `UPDATE daily_status SET state = 'done' WHERE id = ?`,
          args: [dailyId],
        });

        const { rows: morningRows2 } = await db.execute({
          sql: `
            SELECT text
            FROM messages
            WHERE user_id = ? AND type = 'morning' AND date(timestamp,'unixepoch') = ?
            ORDER BY id ASC
            LIMIT 1
          `,
          args: [userId, today],
        });
        const planText2 = morningRows2[0]?.text || '';

        const { rows: updateRows } = await db.execute({
          sql: `
            SELECT text
            FROM messages
            WHERE user_id = ? AND type = 'update' AND date(timestamp,'unixepoch') = ?
            ORDER BY id ASC
            LIMIT 1
          `,
          args: [userId, today],
        });
        const updateText = updateRows[0]?.text || '';

        await notif.sendCoachReply(userId, planText2, updateText, text);
      }

    // 3d) Conversación libre tras daily completado
    } else if (statusRows[0].state === 'done') {
      type = 'chat';
      await notif.sendCoachReply(userId, null, null, text);
    }

    // 4) Guarda el mensaje en la base de datos
    await db.execute({
      sql: `
        INSERT INTO messages
          (chat_id, user_id, message_id, text, timestamp, type)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [chatId, userId, message_id, text, ts, type],
    });

  } catch (err) {
    console.error('Error manejando mensaje:', err);
  }
});

export default bot;
