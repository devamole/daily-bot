'use strict';

module.exports.config = { runtime: 'nodejs' };

function pickHandler(mod) {
  if (typeof mod === 'function') return mod;
  if (mod && typeof mod.default === 'function') return mod.default;
  if (mod && typeof mod.handler === 'function') return mod.handler;
  if (mod && mod.default && typeof mod.default.default === 'function') return mod.default.default;
  throw new Error('Handler export not found in dist/entrypoints/jobs/vercel.evening.background.js');
}

module.exports = async function handler(req, res) {
  const mod = await import('../dist/entrypoints/jobs/vercel.evening.background.js');
  const fn = pickHandler(mod);
  return fn(req, res);
};
