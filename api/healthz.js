export const config = { runtime: 'nodejs' };

export default async function handler(_req, res) {
  res.status(200).end('ok');
}
