import { generateCoachResponse, generateCongratsMessage } from "./llmClient.js";
import { escapeTelegramMarkdown } from "./utils.js";
import { splitText, sleep } from "./utils.js";

export default class NotificationService {
  /**
   * @param {import('node-telegram-bot-api')} bot - Instancia de TelegramBot
   */
  constructor(bot) {
    this.bot = bot;
  }

  // Mensaje matutino
  async promptMorning(userId) {
    const mensajeDaily =
      "👋 ¡Buen día! Recuerda tomar tu Daily ✨\n\n" +
      "Aquí tienes un formato sencillo que puedes seguir:\n\n" +
      "📌 Hoy me enfocaré en:\n" +
      "1. Resolver el algoritmo \"Two Sum\".\n" +
      "2. Aprender sobre \"Reactive Forms en Angular\".\n\n" +
      "Recuerda: sé breve y específico para mantener el enfoque.\n" +
      "¡Tú puedes con todo! 🌟🚀";

    try {
      console.log("Antes de formatear el mensaje")
      let scapeMsg = escapeTelegramMarkdown(mensajeDaily)
      console.log("Después de formatear mensaje", scapeMsg)
      let result = await this.bot.sendMessage(userId, scapeMsg, {parse_mode: "Markdown"});
      console.log("DEBUG: sendMessage SUCCESS:", result);
    } catch (error) {
      console.error("DEBUG: sendMessage ERROR:", error);
    }
  }

  
  // Acuse de recibido de la daily
  async ackDaily(userId) {
    const ack =
      "✅ ¡Recibido! Gracias por compartir tu daily.\n" +
      "🌞 ¡Que tengas un día productivo y lleno de logros! 🚀";
    let scapeMsg = escapeTelegramMarkdown(ack)
    await this.bot.sendMessage(userId, scapeMsg, {parse_mode: "Markdown"});
  }

  // Mensaje vespertino
  async promptEvening(userId) {
    const mensajeCierreDaily =
      "👋 ¡Hola de nuevo! Espero que hayas tenido un día increíble. ✨\n\n" +
      "Cuéntame, ¿cómo te fue hoy? ¿Lograste cumplir los objetivos que te propusiste esta mañana?\n\n" +
      "Recuerda que cada pequeño logro cuenta mucho, ¡estoy seguro que diste lo mejor de ti! 🌟😊";
    let scapeMsg = escapeTelegramMarkdown(mensajeCierreDaily)
    
    await this.bot.sendMessage(userId, scapeMsg, {parse_mode: "Markdown"});
  }

  // Pregunta de follow-up si no se cumple al 100%
  async promptFollowUp(userId) {
    const mensajeObjetivosNoCumplidos =
      "🌈 ¡Ánimo! A veces los días no salen como planeamos, y está bien. 😊\n\n" +
      "¿Me cuentas qué te dificultó cumplir con tus objetivos hoy? Entenderlo nos ayudará a mejorar mañana.\n\n" +
      "Recuerda que lo importante es intentarlo y seguir adelante. ¡Estoy aquí para apoyarte! ✨💪";
    let scapeMsg = escapeTelegramMarkdown(mensajeObjetivosNoCumplidos)
    await this.bot.sendMessage(userId, scapeMsg, {parse_mode: "Markdown"});
  }

  /**
   * Genera y envía mensaje de felicitación mediante LLM
   */
  async sendCongrats(userId, planText, updateText) {
    const congrats = await generateCongratsMessage(planText, updateText);
    await this._sendChunks(userId, congrats);
  }

  /**
   * Genera y envía respuesta de coaching mediante LLM
   */
  async sendCoachReply(userId, planText, updateText, reasonText) {
    const coachReply = await generateCoachResponse(
      planText,
      updateText,
      reasonText
    );
    await this._sendChunks(userId, coachReply);
  }

  /**
   * Envía texto largo en fragmentos con delay
   * @private
   */
  async _sendChunks(userId, text) {
    const chunks = splitText(text);
    for (const chunk of chunks) {
      let scapeMsg = escapeTelegramMarkdown(chunk)
      await this.bot.sendMessage(userId, scapeMsg, {parse_mode: "Markdown"});
      await sleep(2000);
    }
  }
}
