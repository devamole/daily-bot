// src/scheduler.js

import { db } from "./db.js";
import TelegramBot from "node-telegram-bot-api";
import NotificationService from "./notificationService.js";

// Inicializa el bot (modo polling no usado aquí, solo para enviar)
const bot = new TelegramBot(process.env.TG_TOKEN);
const notif = new NotificationService(bot);

/**
 * Envía la daily matutina a todos los usuarios registrados.
 */
export async function sendMorningPrompt() {
  const today = new Date().toISOString().split("T")[0];
  const { rows: users } = await db.execute({
    sql: "SELECT user_id FROM users",
    args: []
  });

  for (const { user_id } of users) {
    // 1) Eliminar cualquier estado previo de hoy
    await db.execute({
      sql: `DELETE FROM daily_status WHERE user_id = ? AND date = ?`,
      args: [user_id, today]
    });

    // 2) Crear un nuevo estado 'pending_morning'
    await db.execute({
      sql: `
        INSERT INTO daily_status (user_id, date, state)
        VALUES (?, ?, 'pending_morning')
      `,
      args: [user_id, today]
    });

    // 3) Enviar prompt matutino
    await notif.promptMorning(user_id);
  }
}



/**
 * Envía la actualización vespertina a quienes están en 'pending_update'.
 */
export async function sendEveningPrompt() {
  const today = new Date().toISOString().split("T")[0];
  const { rows } = await db.execute({
    sql: `
      SELECT user_id
      FROM daily_status
      WHERE date = ? AND state = 'pending_update'
    `,
    args: [today]
  });

  for (const { user_id } of rows) {
    await notif.promptEvening(user_id);
  }
}
