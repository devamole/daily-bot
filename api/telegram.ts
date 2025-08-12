import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const mod = require('../dist/entrypoints/http/vercel.webhook.js');

export const config = mod.config;
export default mod.default;
