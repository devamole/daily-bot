import "dotenv/config";
import express from "express";
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import { db, migrate } from "./db.js";
import { evaluateDaily, generateCoachResponse, generateCongratsMessage } from "./llmClient.js";
import { splitText } from "./utils.js";

// Variables de entorno
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const TG_TOKEN = process.env.TG_TOKEN;

// Inicializa el bot en modo webhook
const bot = new TelegramBot(TG_TOKEN, { webHook: true });
bot.setWebHook(`${WEBHOOK_URL}/webhook/${SECRET}`);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Opcional: para depurar la configuración del webhook
console.log(await bot.getWebHookInfo());

// Aplica migraciones en Turso
await migrate();

const app = express();
app.use(express.json());

const mensajeDaily =
        "👋 ¡Buen día! Recuerda tomar tu Daily ✨\n\n" +
        "Aquí tienes un formato sencillo que puedes seguir:\n\n" +
        "📌 Hoy me enfocaré en:\n" +
        "1. Resolver el algoritmo \"Two Sum\".\n" +
        "2. Aprender sobre \"Reactive Forms en Angular\".\n\n" +
        "Recuerda: sé breve y específico para mantener el enfoque.\n" +
        "¡Tú puedes con todo! 🌟🚀";

/** Enviar prompt matutino a todos los usuarios */
async function sendMorningPrompt() {
  const today = new Date().toISOString().split("T")[0];
  const { rows: users } = await db.execute({
    sql: "SELECT user_id FROM users",
    args: []
  });

  for (const { user_id } of users) {
    await db.execute({
      sql: `
        INSERT OR IGNORE INTO daily_status (user_id, date, state)
        VALUES (?, ?, 'pending_morning')
      `,
      args: [user_id, today]
    });
    await bot.sendMessage(user_id, mensajeDaily);
  }
}

/** Enviar prompt vespertino a quienes están pending_update */
async function sendEveningPrompt() {
  const today = new Date().toISOString().split("T")[0];
  const { rows } = await db.execute({
    sql: `
      SELECT user_id
      FROM daily_status
      WHERE date = ? AND state = 'pending_update'
    `,
    args: [today]
  });

  const mensajeCierreDaily =
    "👋 ¡Hola de nuevo! Espero que hayas tenido un día increíble. ✨\n\n" +
    "Cuéntame, ¿cómo te fue hoy? ¿Lograste cumplir los objetivos que te propusiste esta mañana?\n\n" +
    "Recuerda que cada pequeño logro cuenta mucho, ¡estoy seguro que diste lo mejor de ti! 🌟😊";

  for (const { user_id } of rows) {
    await bot.sendMessage(user_id, mensajeCierreDaily);
  }
}

// Scheduling con node-cron (08:00 y 18:00 Bogotá)
cron.schedule("0 8 * * *", sendMorningPrompt,  { timezone: "America/Bogota" });
cron.schedule("0 18 * * *", sendEveningPrompt, { timezone: "America/Bogota" });

/** Webhook handler */
app.post(`/webhook/:secret`, async (req, res) => {
  if (req.params.secret !== SECRET) return res.sendStatus(403);
  const update = req.body;

  if (update.message) {
    const { chat, from, text, message_id, date } = update.message;
    const chatId = chat.id;
    const userId = from.id;
    const ts = date; // timestamp en segundos
    const today = new Date(ts * 1000).toISOString().split("T")[0];

    // 1) Registro de usuario al /start
    if (text === "/start") {
      await db.execute({
        sql: `
          INSERT OR IGNORE INTO users (user_id, chat_id)
          VALUES (?, ?)
        `,
        args: [userId, chatId]
      });

      const mensajeDaily =
        "👋 ¡Buen día! Te ayudaré a tomar tu Daily ✨\n\n" +
        "Aquí tienes un formato sencillo que puedes seguir:\n\n" +
        "📌 Hoy me enfocaré en:\n" +
        "1. Resolver el algoritmo \"Two Sum\".\n" +
        "2. Aprender sobre \"Reactive Forms en Angular\".\n\n" +
        "Recuerda: sé breve y específico para mantener el enfoque.\n" +
        "¡Tú puedes con todo! 🌟🚀";

      await bot.sendMessage(chatId, mensajeDaily);
      return res.sendStatus(200);
    }

    // 2) Obtener estado actual en daily_status
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

    // 3a) Primera respuesta (morning)
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

        const ack = 
            "✅ ¡Recibido! Gracias por compartir tu daily.\n" +
            "🌞 ¡Que tengas un día productivo y lleno de logros! 🚀";
        await bot.sendMessage(chatId, ack);
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

    // 3b) Update vespertino
    } else if (statusRows[0].state === "pending_update") {
      type = "update";
      dailyId = statusRows[0].id;

      // Recuperar el plan matutino
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

      // Evaluar plan vs update
      const score = await evaluateDaily(planText, text);

      if (score === 100) {
        const congrats = await generateCongratsMessage(planText, text);
        await bot.sendMessage(chatId, congrats);
      }

      // Actualizar estado y score
      const newState = score === 100 ? "done" : "needs_followup";
      await db.execute({
        sql: `
          UPDATE daily_status
          SET state = ?, score = ?
          WHERE id = ?
        `,
        args: [newState, score, dailyId]
      });

      // Si no cumple 100 → follow-up
      if (score < 100) {
        await db.execute({
          sql: `
            INSERT INTO pending_responses (user_id, daily_id, type)
            VALUES (?, ?, 'followup_question')
          `,
          args: [userId, dailyId]
        });
        const mensajeObjetivosNoCumplidos =
          "🌈 ¡Ánimo! A veces los días no salen como planeamos, y está bien. 😊\n\n" +
          "¿Me cuentas qué te dificultó cumplir con tus objetivos hoy? Entenderlo nos ayudará a mejorar mañana.\n\n" +
          "Recuerda que lo importante es intentarlo y seguir adelante. ¡Estoy aquí para apoyarte! ✨💪";
        await bot.sendMessage(chatId, mensajeObjetivosNoCumplidos);
        type = "followup";
      }

    // 3c) Procesar respuesta de follow-up
    } else if (statusRows[0].state === "needs_followup") {
      type = "followup";
      dailyId = statusRows[0].id;

      // Obtener pending_response abierto
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
        // Guardar la respuesta del usuario
        await db.execute({
          sql: `
            INSERT INTO follow_up_responses (pending_id, text, timestamp)
            VALUES (?, ?, ?)
          `,
          args: [pendingId, text, ts]
        });
        // Marcar pending como enviado
        await db.execute({
          sql: `
            UPDATE pending_responses
            SET sent = TRUE
            WHERE id = ?
          `,
          args: [pendingId]
        });
        // Marcar daily como done
        await db.execute({
          sql: `
            UPDATE daily_status
            SET state = 'done'
            WHERE id = ?
          `,
          args: [dailyId]
        });

        // Generar y enviar respuesta de coach
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

        const { rows: updateRows } = await db.execute({
          sql: `
            SELECT text
            FROM messages
            WHERE user_id = ? AND type = 'update' AND date(timestamp, 'unixepoch') = ?
            ORDER BY id ASC
            LIMIT 1
          `,
          args: [userId, today]
        });
        const updateText = updateRows[0]?.text || "";

        const coachReply = await generateCoachResponse(planText, updateText, text);

        const chunks = splitText(coachReply);
        for (const chunk of chunks) {
            await bot.sendMessage(chatId, chunk);
            await sleep(2000);
        }

      }

    // 5) Conversación libre coach ↔ usuario hasta la próxima daily
    } else if (statusRows[0].state === "done") {
      type = "chat";

      // El mensaje actual del usuario es `text`
      const chatReply = await generateCoachResponse(text);
      const chunks = splitText(chatReply);
        for (const chunk of chunks) {
            await bot.sendMessage(chatId, chunk);
            await sleep(2000);
        }

    }

    // 6) Guardar el mensaje del usuario
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

app.post("/__test__/evening", async (req, res) => {
  try {
    await sendEveningPrompt();
    return res.status(200).send("Evening prompt triggered");
  } catch (error) {
    console.error("Error triggering evening prompt:", error);
    return res.status(500).send("Error triggering evening prompt");
  }
});

// Inicia el servidor
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
