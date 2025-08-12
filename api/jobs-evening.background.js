// ESM wrapper que carga el job compilado (CJS) desde dist
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const mod = require('../dist/entrypoints/jobs/vercel.evening.background.js');

export const config = mod.config ?? { runtime: 'nodejs' };
export default mod.default || mod;
