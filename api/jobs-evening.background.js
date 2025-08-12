// ESM wrapper universal para el job nocturno
export const config = { runtime: 'nodejs' };

const modPromise = import('../dist/entrypoints/jobs/vercel.evening.background.js');

export default async function handler(req, res) {
  const mod = await modPromise;
  return mod.default(req, res);
}
