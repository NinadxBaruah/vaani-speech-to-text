# stt-assignment

Real-time multilingual speech-to-text web app (Procucev hiring assignment).
TypeScript monorepo: `server/` (Fastify + Drizzle + Neon Postgres; STT engines: Sarvam saaras:v4 proxy and a
self-hosted Whisper engine) and `web/` (React + Vite), plus `stt-local/` (Python faster-whisper sidecar).

**Before doing anything, read `docs/PLAN.md`.** It holds the decisions, API/WS contracts,
data model and the progress checklist. Tick the checklist and append to its session log as you work.

- Secrets live in the root `.env` (`SARVAM_API_KEY`, `DB_URI`) — never print, commit or send them to the browser.
- Self-hosted engine: `npm run stt-local` (Docker, :8001) + `LOCAL_STT_URL=http://localhost:8001 npm run dev`.
- Dev: `npm run dev` (server :3000, web :5173 with proxy). Tests: `npm test` (unit/integration), `npm run test:e2e` (browser, app must be running).
- Checks: `npm run typecheck && npm run lint`. Prod: `npm run build && NODE_ENV=production npm start` or the Dockerfile.
- Do not push to GitHub or deploy unless the owner asks.
