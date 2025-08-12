import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const mod = require('../dist/entrypoints/jobs/vercel.evening.background.js');

export const config = mod.config;
export default mod.default;