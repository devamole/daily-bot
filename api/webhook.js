import "dotenv/config";
import express from "express";
import TelegramBot from "node-telegram-bot-api";
import { db, migrate } from "../src/db.js";
import NotificationService from "../src/notificationService.js";
import { splitText } from "../src/utils.js";

const app = express();
app.use(express.json());

// Inicializa el bot en modo webhook
const bot = new TelegramBot(process.env.TG_TOKEN, { webHook: true });
bot.setWebHook(`${process.env.WEBHOOK_URL}/api/webhook/${process.env.SECRET}`);

await migrate();

const notif = new NotificationService(bot);

app.post("/api/webhook/:secret", async (req, res) => {
  if (req.params.secret !== process.env.SECRET) {
    return res.sendStatus(403);
  }
  const update = req.body;

  if (update.message) {
    const { chat, from, text, message_id, date } = update.message;
    const chatId = chat.id;
    const userId = from.id;
    const ts = date;
    const today = new Date(ts * 1000).toISOString().split("T")[0];

    // 1) /start registra usuario y envía saludo diario
    if (text === "/start") {
      await db.execute({
        sql: `
          INSERT OR IGNORE INTO users (user_id, chat_id)
          VALUES (?, ?)
        `,
        args: [userId, chatId]
      });
      // Envía prompt matutino directamente tras /start
      await notif.promptMorning(userId);
      return res.sendStatus(200);
    }

    // 2) Obtener estado diario
    const { rows: statusRows } = await db.execute({
      sql: `
        SELECT id, state
        FROM daily_status
        WHERE user_id = ? AND date = ?
      `,
      args: [userId, today]
    });

    let type = "other";
    let dailyId = null;

    // 3a) Respuesta matutina
    if (statusRows.length === 0 || statusRows[0].state === "pending_morning") {
      type = "morning";
      if (statusRows.length === 0) {
        const insert = await db.execute({
          sql: `
            INSERT INTO daily_status (user_id, date, state)
            VALUES (?, ?, 'pending_update')
          `,
          args: [userId, today]
        });
        dailyId = insert.lastInsertRowid;
      } else {
        dailyId = statusRows[0].id;
        await db.execute({
          sql: `
            UPDATE daily_status
            SET state = 'pending_update'
            WHERE id = ?
          `,
          args: [dailyId]
        });
      }
      // Ack de recibido
      await notif.ackDaily(userId);

    // 3b) Respuesta vespertina
    } else if (statusRows[0].state === "pending_update") {
      type = "update";
      dailyId = statusRows[0].id;

      // Recuperar plan matutino
      const { rows: morningRows } = await db.execute({
        sql: `
          SELECT text
          FROM messages
          WHERE user_id = ? AND type = 'morning' AND date(timestamp, 'unixepoch') = ?
          ORDER BY id ASC
          LIMIT 1
        `,
        args: [userId, today]
      });
      const planText = morningRows[0]?.text || "";

      // Evaluar
      const score = await notif.evaluatePlan(planText, text);

      // Felicitación o follow-up
      if (score === 100) {
        await notif.sendCongrats(userId, planText, text);
      } else {
        await notif.promptFollowUp(userId);
      }

      // Actualizar estado
      const newState = score === 100 ? "done" : "needs_followup";
      await db.execute({
        sql: `
          UPDATE daily_status
          SET state = ?, score = ?
          WHERE id = ?
        `,
        args: [newState, score, dailyId]
      });

    // 3c) Procesar follow-up
    } else if (statusRows[0].state === "needs_followup") {
      type = "followup";
      dailyId = statusRows[0].id;

      // Guardar la razón del usuario
      const { rows: pendingRows } = await db.execute({
        sql: `
          SELECT id
          FROM pending_responses
          WHERE user_id = ? AND daily_id = ? AND sent = FALSE
          ORDER BY id ASC
          LIMIT 1
        `,
        args: [userId, dailyId]
      });
      if (pendingRows.length) {
        const pendingId = pendingRows[0].id;
        await db.execute({
          sql: `
            INSERT INTO follow_up_responses (pending_id, text, timestamp)
            VALUES (?, ?, ?)
          `,
          args: [pendingId, text, ts]
        });
        await db.execute({
          sql: `
            UPDATE pending_responses
            SET sent = TRUE
            WHERE id = ?
          `,
          args: [pendingId]
        });
        await db.execute({
          sql: `
            UPDATE daily_status
            SET state = 'done'
            WHERE id = ?
          `,
          args: [dailyId]
        });

        // Recuperar plan/update
        const { rows: morningRows2 } = await db.execute({
          sql: `
            SELECT text FROM messages
            WHERE user_id = ? AND type='morning' AND date(timestamp,'unixepoch')=?
            ORDER BY id LIMIT 1
          `,
          args: [userId, today]
        });
        const planText2 = morningRows2[0]?.text || "";
        const { rows: updateRows } = await db.execute({
          sql: `
            SELECT text FROM messages
            WHERE user_id = ? AND type='update' AND date(timestamp,'unixepoch')=?
            ORDER BY id LIMIT 1
          `,
          args: [userId, today]
        });
        const updateText = updateRows[0]?.text || "";

        // Enviar feedback de coach
        await notif.sendCoachReply(userId, planText2, updateText, text);
      }

    // 4) Conversación libre tras daily
    } else if (statusRows[0].state === "done") {
      type = "chat";
      await notif.sendCoachReply(userId, null, null, text);
    }

    // 5) Guardar mensaje de usuario
    await db.execute({
      sql: `
        INSERT INTO messages
          (chat_id, user_id, message_id, text, timestamp, type)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [chatId, userId, message_id, text, ts, type]
    });
  }

  res.sendStatus(200);
});

export default app;
