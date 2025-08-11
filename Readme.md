# Daily Bot — Telegram + Vercel + Turso + Gemini (TypeScript)

Bot de seguimiento de dailys (Agile). Por la mañana registra el plan, por la noche consulta el resultado, evalúa con LLM (Gemini), da feedback y persiste en Turso. Arquitectura hexagonal, abierta a Slack/Teams/WhatsApp y a cambiar el LLM.

## Requisitos
- Node.js **>= 20**
- Cuenta en Vercel (o entorno Node serverless)
- Base de datos Turso / libSQL
- Token de bot de Telegram
- (Opcional) API Key de Gemini

## Estructura
- `api/` — **wrappers Vercel** (TypeScript) → reexportan handlers en `src/`
- `src/` — **core + adapters + entrypoints** (TypeScript)
- `scripts/` — utilidades (p.ej., `setWebhook.telegram.js`)

## Variables de entorno
Copia `.env.example` a tu sistema (Vercel Project Settings → Environment Variables):

- `TELEGRAM_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- `GEMINI_API_KEY` (opcional para prod; en dev usa dummy)
- `DEFAULT_TZ` (por defecto `America/Bogota`)
- `LLM_MODEL`, `LLM_RUBRIC_VERSION`

## Desarrollo local
```bash
pnpm install
pnpm typecheck
pnpm dev