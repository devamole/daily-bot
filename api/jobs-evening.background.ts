// Vercel Background Function (TypeScript)
// Reexporta el job nocturno desde src/entrypoints/jobs/vercel.evening.background
import handler, { config as routeConfig } from '../src/entrypoints/jobs/vercel.evening.background.js';

export const config = routeConfig;
export default handler;