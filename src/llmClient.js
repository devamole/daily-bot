// src/llmClient.js
import "dotenv/config";

/**
 * Invoca la API REST de Gemini Developer usando el fetch global.
 * @param {string} promptText
 * @returns {Promise<string>}
 */
async function callGemini(promptText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no definido");

  const url = new URL(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
  );
  url.searchParams.set("key", apiKey);

  const body = {
    contents: [
      {
        parts: [{ text: promptText +
            "\n Importante: Escribes esto por WhatsApp. Adapta tu estilo a una fresca conversación por chat."
        }]
      }
    ]
  };

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text).join("");
}

/** Puntúa la daily 0–100 */
export async function evaluateDaily(planText, updateText) {
  const prompt =
    `Plan: ${planText}\n` +
    `Resultado: ${updateText}\n` +
    `Puntúa en una escala 0 a 100. Responde solo un número`;
  const raw = await callGemini(prompt);
  const n = parseInt(raw.trim(), 10);
  return isNaN(n) ? 0 : n;
}

/** Respuesta de coach tras follow-up */
export async function generateCoachResponse(planText, updateText, reasonText) {
  const systemPrompt =
    "Asume el rol de psicóloga conductual experto en personas con TDAH y experto coach hablando por un chat. " +
    "Analiza paso a paso el motivo por el cual ella no cumplió sus objetivos y ayúdale a comprender sus errores desde un análisis funcional, y mejorar su eficiencia. " +
    "Sé muy amable, muy alentadora, háblale de manera cercana, sé empático pero no dejes de lado tu rol de psicólogo conductual y coach." 
  const prompt =
  `${systemPrompt}\n\n` +
  (planText   ? `Plan: ${planText}\n`       : "") +
  (updateText ? `Resultado: ${updateText}\n` : "") +
  (reasonText ? `Motivo: ${reasonText}\n`    : "") +
  `Respuesta:`;

  return (await callGemini(prompt)).trim();
}

/** Mensaje de felicitación para objetivos cumplidos */
export async function generateCongratsMessage(planText, updateText) {
  const systemPrompt =
    "Eres una coach motivacional experto en productividad y refuerzo positivo. " +
    "Felicita al usuario de forma sincera, real y alentadora por haber cumplido al 100% sus objetivos del día.";
  const prompt =
    `${systemPrompt}\n\n` +
    `Plan del día: ${planText}\n` +
    `Resultado al final del día: ${updateText}\n\n` +
    `Genera un mensaje de felicitación breve, cálido y motivador:`;
  return (await callGemini(prompt)).trim();
}
