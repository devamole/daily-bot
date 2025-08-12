// Vercel Serverless Function (TypeScript)
// Reexporta el handler real (con validación de secreto) desde src/entrypoints/http/vercel.webhook
import handler, { config as routeConfig } from '../dist/entrypoints/http/vercel.webhook';

export const config = routeConfig;
export default handler;