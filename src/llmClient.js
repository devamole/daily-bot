// src/llmClient.js
import fetch from "node-fetch";

/**
 * Helper para invocar la API REST de Gemini Developer.
 * @param {string} promptText El texto completo del prompt.
 * @returns {Promise<string>} La respuesta generada.
 */
async function callGemini(promptText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no definido");

  const url = new URL(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
  );
  url.searchParams.set("key", apiKey);

  const body = {
    // Según REST API: un array de objetos con partes de texto
    contents: [
      {
        parts: [
          { text: promptText }
        ]
      }
    ],
    // Controles opcionales: límite de tokens, temperatura, etc.
    // generationConfig: { maxOutputTokens: 50, temperature: 0.7 }
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
  // El path hasta el texto: data.candidates[0].content.parts[*].text
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text).join("");
}

/**
 * Evalúa el cumplimiento de la daily: devuelve un puntaje 0–100.
 */
export async function evaluateDaily(planText, updateText) {
  const prompt = 
    `Plan: ${planText}\n` +
    `Resultado: ${updateText}\n` +
    `Puntúa de 0 a 100.`;
  const raw = await callGemini(prompt);
  const n = parseInt(raw.trim(), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Genera respuesta de coach tras follow-up.
 */
export async function generateCoachResponse(planText, updateText, reasonText) {
  const systemPrompt =
    "Asume el rol de psicólogo conductual experto en personas con TDAH y experto coach. " +
    "Analiza paso a paso el motivo por el cual no cumplió sus objetivos y ayúdale a comprender sus errores y mejorar su eficiencia. " +
    "Sé muy amable, muy alentador, háblale como si fuese su mejor amigo, sé empático pero no dejes de lado tu rol de psicólogo conductual experto en personas con TDAH y experto coach.";
  const prompt =
    `${systemPrompt}\n\n` +
    `Plan: ${planText}\n` +
    `Resultado: ${updateText}\n` +
    `Motivo: ${reasonText}\n` +
    `Respuesta:`;
  return (await callGemini(prompt)).trim();
}

/**
 * Genera un mensaje de felicitación auténtico y motivador.
 */
export async function generateCongratsMessage(planText, updateText) {
  const systemPrompt =
    "Eres un coach motivacional experto en productividad y refuerzo positivo. " +
    "Felicita al usuario de forma sincera, real y alentadora por haber cumplido al 100% sus objetivos del día.";
  const prompt =
    `${systemPrompt}\n\n` +
    `Plan del día: ${planText}\n` +
    `Resultado: ${updateText}\n\n` +
    `Genera un mensaje de felicitación breve, cálido y motivador:`;
  return (await callGemini(prompt)).trim();
}


// // src/llmClient.js

// import { GoogleGenAI } from "@google/genai";  // SDK oficial
// import "dotenv/config";                       // Carga GEMINI_API_KEY

// // 2.1 Inicializa el cliente con tu API key
// const ai = new GoogleGenAI({
//   apiKey: process.env.GEMINI_API_KEY
// });

// // 2.2 Función genérica para evaluar la daily
// export async function evaluateDaily(planText, updateText) {
//   // Construye el prompt combinando plan y resultado
//   const contents = `Califica de 1 a 100 qué tanto del plan se logró de acuerdo al resultado. Plan: ${planText}\nResultado: ${updateText}\nPuntúa de 0 a 100. No respondas letras solo número de 1 a 100`;

//   // 2.3 Llama al modelo Gemini 2.5 Flash
//   const response = await ai.models.generateContent({
//     model: "gemini-2.5-flash",  // Modelo recomendado para balance precio/latencia :contentReference[oaicite:5]{index=5}
//     contents
//   });

//   // 2.4 Extrae el texto generado y parsea a entero
//   const raw = response.text.trim();  
//   const score = parseInt(raw, 10);

//   // Asegura un valor numérico
//   return isNaN(score) ? 0 : score;
// }

// /**
//  * Genera la respuesta de coaching tras un follow-up de motivo de incumplimiento.
//  */
// export async function generateCoachResponse(planText, updateText, reasonText) {
//   const systemPrompt = "Eres psicóloga conductual experta en TDAH y coach en WhatsApp. Analiza por qué no cumplió sus metas, ayuda a entender errores y mejorar. Usa mensajes breves, claros, cercanos y alentadores. No hables de TDAH explícitamente"
//   const contents =
//     `${systemPrompt}\nPlan: ${planText}\nResultado: ${updateText}\nMotivo: ${reasonText}\nRespuesta:`;
//   const response = await ai.models.generateContent({
//     model: "gemini-2.5-flash",
//     contents
//   });
//   return response.text.trim();
// }


// export async function generateCongratsMessage(planText, updateText) {
//   const systemPrompt =
//     "Eres un coach motivacional experto en productividad y refuerzo positivo. " +
//     "Felicita al usuario de forma sincera, real y alentadora por haber cumplido al 100% sus objetivos del día.";
//   const contents =
//     `${systemPrompt}\n\n` +
//     `Plan del día: ${planText}\n` +
//     `Resultado: ${updateText}\n\n` +
//     `Genera un mensaje de felicitación breve, cálido y motivador:`;
  
//   const response = await ai.models.generateContent({
//     model: "gemini-2.5-flash",
//     contents
//   });
  
//   return response.text.trim();
// }
