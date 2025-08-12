// ESM wrapper universal: carga dinámicamente el handler desde dist (ESM o CJS)
export const config = { runtime: 'nodejs' };

const modPromise = import('../dist/entrypoints/http/vercel.webhook.js');

export default async function handler(req, res) {
  const mod = await modPromise;
  // mod.default existe en ESM; en CJS Node mapea a .default también
  return mod.default(req, res);
}
