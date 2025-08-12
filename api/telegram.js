// ESM wrapper que carga el handler compilado (CJS) desde dist
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const mod = require('../dist/entrypoints/http/vercel.webhook.js');

export const config = mod.config ?? { runtime: 'nodejs' };
export default mod.default || mod;