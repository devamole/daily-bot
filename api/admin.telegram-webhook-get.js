'use strict';
module.exports = async function handler(req, res) {
  try {
    const token = process.env.TG_TOKEN;
    const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const j = await r.json();
    res.status(200).json(j);
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
};