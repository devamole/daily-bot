// src/llmClient.js

import { GoogleGenAI } from "@google/genai";  // SDK oficial
import "dotenv/config";                       // Carga GEMINI_API_KEY

// 2.1 Inicializa el cliente con tu API key
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// 2.2 Función genérica para evaluar la daily
export async function evaluateDaily(planText, updateText) {
  // Construye el prompt combinando plan y resultado
  const contents = `Califica de 1 a 100 qué tanto del plan se logró de acuerdo al resultado. Plan: ${planText}\nResultado: ${updateText}\nPuntúa de 0 a 100. No respondas letras solo número de 1 a 100`;

  // 2.3 Llama al modelo Gemini 2.5 Flash
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",  // Modelo recomendado para balance precio/latencia :contentReference[oaicite:5]{index=5}
    contents
  });

  // 2.4 Extrae el texto generado y parsea a entero
  const raw = response.text.trim();  
  const score = parseInt(raw, 10);

  // Asegura un valor numérico
  return isNaN(score) ? 0 : score;
}

/**
 * Genera la respuesta de coaching tras un follow-up de motivo de incumplimiento.
 */
export async function generateCoachResponse(planText, updateText, reasonText) {
  const systemPrompt = "Eres psicóloga conductual experta en TDAH y coach en WhatsApp. Analiza por qué no cumplió sus metas, ayuda a entender errores y mejorar. Usa mensajes breves, claros, cercanos y alentadores. No hables de TDAH explícitamente"
  const contents =
    `${systemPrompt}\nPlan: ${planText}\nResultado: ${updateText}\nMotivo: ${reasonText}\nRespuesta:`;
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents
  });
  return response.text.trim();
}


export async function generateCongratsMessage(planText, updateText) {
  const systemPrompt =
    "Eres un coach motivacional experto en productividad y refuerzo positivo. " +
    "Felicita al usuario de forma sincera, real y alentadora por haber cumplido al 100% sus objetivos del día.";
  const contents =
    `${systemPrompt}\n\n` +
    `Plan del día: ${planText}\n` +
    `Resultado: ${updateText}\n\n` +
    `Genera un mensaje de felicitación breve, cálido y motivador:`;
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents
  });
  
  return response.text.trim();
}
