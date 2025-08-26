'use strict';

// Vercel leerá esto:
module.exports.config = { runtime: 'nodejs' };

function pickHandler(mod) {
  if (typeof mod === 'function') return mod;                          // CJS: module.exports = handler
  if (mod && typeof mod.default === 'function') return mod.default;   // ESM/CJS: export default handler
  if (mod && typeof mod.handler === 'function') return mod.handler;   // por si exportaste { handler }
  if (mod && mod.default && typeof mod.default.default === 'function') return mod.default.default; // doble wrap raro
  throw new Error('Handler export not found in dist/entrypoints/http/vercel.webhook.js');
}

// Wrapper universal: carga el handler (ESM o CJS) *cuando Vercel lo llama*
module.exports = async function handler(req, res) {
  console.log('HTTP', req.method, req.url);
  const mod = await import('../dist/entrypoints/http/vercel.webhook.js');
  const fn = pickHandler(mod);
  return fn(req, res);
};
