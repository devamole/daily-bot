// Vercel Background Function (TypeScript)
// Reexporta el job nocturno desde src/entrypoints/jobs/vercel.evening.background
import handler, { config as routeConfig } from '../dist/entrypoints/jobs/vercel.evening.background';

export const config = routeConfig;
export default handler;