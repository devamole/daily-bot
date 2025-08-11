// Healthcheck ligero para debugging/uptime
export const config = { runtime: 'nodejs' } as const;

export default async function handler(_req: any, res: any) {
  res.status(200).end('ok');
}