export const config = { runtime: 'nodejs20.x' };
export default async function handler(_req, res) {
  res.status(200).end('ok');
}
