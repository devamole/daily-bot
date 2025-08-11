#!/usr/bin/env node
/* eslint-disable no-console */

// Uso:
// TELEGRAM_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy node scripts/setWebhook.telegram.js https://<tu-app>.vercel.app/api/telegram
// o define WEBHOOK_URL en env: WEBHOOK_URL=https://... node scripts/setWebhook.telegram.js

const token = process.env.TELEGRAM_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const urlArg = process.argv[2] || process.env.WEBHOOK_URL;

if (!token) {
  console.error('ERROR: Falta TELEGRAM_TOKEN');
  process.exit(1);
}
if (!secret) {
  console.error('ERROR: Falta TELEGRAM_WEBHOOK_SECRET');
  process.exit(1);
}
if (!urlArg) {
  console.error('ERROR: Proporciona la URL del webhook como argumento o en WEBHOOK_URL');
  console.error('Ej: node scripts/setWebhook.telegram.js https://<app>.vercel.app/api/telegram');
  process.exit(1);
}

async function main() {
  try {
    // 1) setWebhook con secret_token
    const setWebhookRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: urlArg,
        secret_token: secret
      })
    });

    const setWebhookText = await setWebhookRes.text();
    console.log('setWebhook status:', setWebhookRes.status, setWebhookText);

    // 2) getWebhookInfo para verificación
    const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const infoText = await infoRes.text();
    console.log('getWebhookInfo status:', infoRes.status, infoText);

    if (!setWebhookRes.ok) process.exit(1);
  } catch (err) {
    console.error('Fallo configurando webhook:', err);
    process.exit(1);
  }
}

main();