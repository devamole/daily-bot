'use strict';

// Ejecuta el cron lógico y devuelve JSON. Nada más.
module.exports.config = { runtime: 'nodejs20.x' };

function pickDefault(mod) {
  if (typeof mod === 'function') return mod;
  if (mod && typeof mod.default === 'function') return mod.default;
  if (mod && mod.default && typeof mod.default.default === 'function') return mod.default.default;
  throw new Error('Default export not found in dist/entrypoints/cron/dispatcher.js');
}

module.exports = async function handler(req, res) {
  try {
    // Importa la función lógica del cron (sin req/res)
    const mod = await import('../dist/entrypoints/cron/dispatcher.js');
    const run = pickDefault(mod);         // => () => Promise<{ morning, evening }>
    const result = await run();           // ejecútalo SIN argumentos

    // Respuesta HTTP
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (err) {
    // No rompas el workflow: siempre responde 200 con el error en el cuerpo
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
  }
};
