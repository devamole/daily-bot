/**
 * Parte un texto largo en chunks de máximo maxLen caracteres, respetando saltos de línea.
 */
export function splitText(text, maxLen = 2000) {
  const lines = text.split("\n");
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if ((current + "\n" + line).length > maxLen) {
      if (current) {
        chunks.push(current);
        current = line;
      } else {
        // línea individual demasiado larga, la partimos a lo bruto
        for (let i = 0; i < line.length; i += maxLen) {
          chunks.push(line.slice(i, i + maxLen));
        }
        current = "";
      }
    } else {
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Envía un texto largo dividiéndolo en varios mensajes si es necesario.
 */
export async function safeSendMessage(chatId, text, options = {}) {
  const parts = splitText(text);
  for (const part of parts) {
    await bot.sendMessage(chatId, part, options);
  }
}
