'use strict';
module.exports = async function handler(req, res) {
  try {
    const token = process.env.TG_TOKEN;
    const base = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
    const url = `${base}/api/telegram`; // sin query ni auth extra
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({ url }),
    });
    const j = await r.json();
    res.status(200).json({ set_to: url, telegram: j });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
};
