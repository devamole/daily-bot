export const config = { runtime: 'nodejs' } as const;

import { runEveningJob } from "./generic.evening";

export default async function handler(_req: any, res: any) {
  await runEveningJob();
  res.status(200).end('OK');
}