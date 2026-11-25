# Speech-to-Text Assignment — Plan & Handoff

> **For any AI/human continuing this work:** read this file top to bottom first.
> The **Progress** checklist (section 10) is the source of truth for what is done.
> Tick items as you finish them and add a line to the **Session log** (section 12).

## 1. The brief (Procucev AI hiring assignment)

- Web app "Speech to Text": user speaks a sentence in real time, possibly
  **multilingual / code-mixed** (e.g. Hindi + English), and the system transcribes it live.
- Store transcriptions in a **relational DB**; a **dashboard** shows the history with full **CRUD**.
- Text-to-Speech is optional (3rd-party allowed).
- Deliverables: public GitHub repo + deployed link (we deploy to **AWS EC2** later).
- Partial work is acceptable, but we aim for complete + clean.

### Owner's extra requirements

- **TypeScript** everywhere.
- Use **Sarvam AI** (key in `.env` as `SARVAM_API_KEY`) and **Neon Postgres** (`DB_URI` in `.env`).
- Support **every language the latest Sarvam STT model supports**, not just Hindi/English.
- **No sign-up / login.** (2026-11-25) One **shared history** everybody sees; originally per-browser
  "workspace keys", removed in Phase 8.
- Follow best practices. Build and run **locally first**; EC2 deploy comes after.
- (2026-11-25) The UI must offer **two STT engines**: the third-party API (Sarvam) **or** a
  **self-hosted open-source model**, [`Oriserve/Whisper-Hindi2Hinglish-Swift`](https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Swift).
  Both run on the same EC2 box. See section 13.

## 2. Key decisions (already made, don't reopen without a reason)

| Topic              | Decision                                                                                                      | Why                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| STT engine         | Sarvam **`saaras:v4`** via the **realtime WebSocket** `wss://api.sarvam.ai/speech-to-text-realtime/ws`        | Latest model, true partial transcripts, 23 languages + `auto` detection, `codemix` mode |
| Key safety         | Browser → **our server WS proxy** → Sarvam                                                                    | `SARVAM_API_KEY` must never reach the browser                                           |
| Backend            | Node 22 + **Fastify 5** + `@fastify/websocket`, `ws` client for upstream                                      | Fast, typed, first-class WS + schema/plugins                                            |
| DB layer           | **Drizzle ORM** + `pg` Pool, SQL migrations by `drizzle-kit`                                                  | Typed SQL, real migration files in git                                                  |
| Validation         | **zod** (env, request bodies, WS messages)                                                                    | One validation library everywhere                                                       |
| Frontend           | **React 19 + Vite** + **TanStack Query**                                                                      | Standard, fast dev server, cache/invalidation for CRUD                                  |
| Styling            | Hand-written CSS (no UI kit), light + dark via `prefers-color-scheme`                                         | Small bundle, looks deliberate                                                          |
| Auth               | **None, one shared history** (section 5); per-browser workspace keys until Phase 8                            | Owner's requirement: reviewers share one space                                          |
| TTS (bonus)        | Sarvam **`bulbul:v3`** via REST `/text-to-speech`, proxied by our server                                      | "Listen" button on a saved transcript                                                   |
| Deploy shape       | One Node process serves the API, the WS and the built SPA (`web/dist`)                                        | One port, one origin → easy on EC2 behind Caddy/nginx with TLS                          |
| TypeScript version | `~6.0.3` (not 7.x)                                                                                            | `typescript-eslint` peer range is `<6.1.0`                                              |
| Env loading        | Node's built-in `process.loadEnvFile()` (root `.env`)                                                         | No dotenv dependency                                                                    |
| Self-hosted STT    | Separate **Python sidecar** `stt-local/` (FastAPI + **faster-whisper**/CTranslate2 int8). Section 13          | ML inference lives in Python; CTranslate2 int8 is the fastest CPU Whisper on ARM        |
| Model weights      | Convert the **official** Oriserve repo at image build, pinned to commit `cd0d4d0…` (no 3rd-party conversions) | Reproducible, no supply-chain risk from unknown uploaders                               |

## 3. Sarvam facts we rely on (verified from docs on 2026-11-24)

**Realtime STT WebSocket** `wss://api.sarvam.ai/speech-to-text-realtime/ws`

- Auth (server side): header `api-subscription-key: <key>`.
- Query params used: `model=saaras:v4`, `language_code=<code|auto>`, `mode=<transcribe|codemix|translit|translate|verbatim>`,
  `stream_type=balanced`, `encoding=linear16`, `sample_rate=16000`, `endpointing=vad`.
- Client → Sarvam: `{"event":"audio_input","audio":"<base64 PCM16LE mono 16 kHz>"}` (~100 ms chunks),
  `{"event":"flush"}`, `{"event":"end"}`, `{"event":"ping"}`.
- Sarvam → client events: `session.begin`, `vad.speech_start`, `vad.speech_end`,
  `transcript.partial` (`text`, `language` when auto), `transcript.final` (`text`, `language`,
  `language_confidence`), `session.end` (`audio_duration_s`), `error` (`code`, `is_fatal`, `message`), `pong`.
- Close codes: 1003 bad key/quota, 1008 no audio for 60 s, 1011 server error, 4000 bad param.
- `mode` applies to the **final** transcript only.
- **Verified live:** events are flat, e.g. `{"event":"transcript.partial","text":"…","language":"en-IN"}`.
  Partials ignore `mode` (romanised, may flip), the final applies it. `session.end` arrives after `end` with `audio_duration_s`.
- TTS accepted `target_language_code` (verified). Request `speech_sample_rate: 16000` to get 16 kHz WAV.

**STT languages (23)** — `auto` plus: en-IN, hi-IN, bn-IN, ta-IN, te-IN, gu-IN, kn-IN, ml-IN, mr-IN, pa-IN,
od-IN, as-IN, ur-IN, ne-IN, kok-IN, ks-IN, sd-IN, sa-IN, sat-IN, mni-IN, brx-IN, mai-IN, doi-IN.

**TTS** `POST https://api.sarvam.ai/text-to-speech`, header `api-subscription-key`,
body `{ text (≤2500 chars), target_language_code, speaker, model: "bulbul:v3" }` → `{ audios: [base64 wav] }`.
11 languages: en, hi, bn, ta, te, gu, kn, ml, mr, pa, od (all `-IN`). Default speaker `shubh`
(others: priya, aditya, ritu, neha, rahul, kavya, …). `target_language_code` is verified to work (2026-11-24).

## 4. Architecture

```
Browser (React)                         Node server (Fastify)                    External
──────────────                          ─────────────────────                    ────────
mic → AudioWorklet (downsample to       WS  /api/transcribe  ── proxy ──────────▶ Sarvam realtime STT
16 kHz PCM16, 100 ms frames) ──binary──▶   (engine chosen in the
                         ◀──JSON events──   first "start" message)
TanStack Query ──REST /api/*──────────▶ routes → repositories → Drizzle ──────▶ Neon Postgres
"Listen" button ──POST /api/tts──────▶ Sarvam TTS proxy ─────────────────────▶ Sarvam bulbul:v3
                                        In prod also serves web/dist (SPA fallback)
```

## 5. Shared history (no accounts, no keys)

> Changed 2026-11-25 (Phase 8). Originally every browser got its own "workspace key"; the owner asked for
> **one shared history that everybody sees**. The workspace concept was removed entirely.

- There is no auth: anyone with the URL can create, read, edit and delete transcripts. This is deliberate
  for the demo/reviewer use case.
- Abuse limits that remain: global rate limit 300 req/min/IP, WS sessions 30/min/IP, TTS 30/min/IP,
  max live session `MAX_SESSION_SECONDS`, body/frame size caps, zod validation everywhere.
- Migration `0002` moved every existing transcript into the shared history, dropped `transcripts.workspace_id`
  and the `workspaces` table, and indexes `created_at desc` instead.

## 6. Data model (Postgres, via Drizzle)

```
transcripts
  id                  uuid pk default gen_random_uuid()
  title               varchar(200) not null
  text                text not null           (max 20 000 chars, checked by zod)
  language_code       varchar(16)             (the language the user picked, 'auto', or null for the local engine)
  detected_languages  text[] not null default '{}'   (languages Sarvam reported per utterance)
  engine              varchar(16) not null default 'sarvam'   ('sarvam' | 'local')
  mode                varchar(16) not null default 'transcribe'
  duration_ms         integer                 (recording length)
  created_at          timestamptz not null default now()
  updated_at          timestamptz not null default now()
  index (created_at desc)
```

## 7. HTTP API contract (all JSON, prefix `/api`)

| Method & path                 | Auth       | Body / query                                                              | Response                                                                                                                 |
| ----------------------------- | ---------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET `/api/health`             | –          | –                                                                         | `{ ok, db }`                                                                                                             |
| GET `/api/meta`               | –          | –                                                                         | `{ sttModel, autoLanguage, sttLanguages[], ttsLanguages[], modes[], ttsSpeakers[] }` (single source of truth for the UI) |
| GET `/api/transcripts`        | –          | `?q=&limit=20&offset=0` (q = case-insensitive search in title+text)       | `{ items[], total }` newest first                                                                                        |
| GET `/api/transcripts/:id`    | –          | –                                                                         | transcript                                                                                                               |
| POST `/api/transcripts`       | –          | `{ title?, text, languageCode?, detectedLanguages?, mode?, durationMs? }` | `201` transcript (title defaults to first words of text)                                                                 |
| PATCH `/api/transcripts/:id`  | –          | `{ title?, text? }` (at least one)                                        | transcript                                                                                                               |
| DELETE `/api/transcripts/:id` | –          | –                                                                         | `204`                                                                                                                    |
| POST `/api/tts`               | – (30/min) | `{ text, languageCode, speaker? }`                                        | `audio/wav` bytes                                                                                                        |

Errors: `{ error: { code, message } }` with proper status (400 validation incl. non-UUID ids,
404 not found, 429 rate limit, 502 upstream). Global rate limit 300/min/IP.

## 8. Live transcription WS protocol (`/api/transcribe`)

Client → server

1. Text `{ "type":"start", "engine":"sarvam"|"local", "languageCode":"auto"|"hi-IN"|…, "mode":"codemix"|… }`
   — must arrive within 10 s. `engine` defaults to `sarvam`; the local engine ignores language/mode.
2. Binary frames: PCM16LE, mono, 16 kHz, ~100 ms each (≤ 64 KB per frame).
3. Text `{ "type":"stop" }` → server sends `flush` then `end` upstream, waits for `session.end`, then closes.

Server → client (JSON text)
`{type:"ready", engine}`, `{type:"speech_start"}`, `{type:"speech_end"}`,
`{type:"partial", text, language?}`, `{type:"final", text, language?}`,
`{type:"error", message, fatal}`, `{type:"ended", audioDurationS?}`.

Close codes: `1000` normal (after `ended`), `4400` invalid message / bad audio frame (must be PCM16, ≤ 64 KB),
`4408` no `start` within 10 s, `4502` engine failed (Sarvam closed / sidecar down),
`4503` engine not enabled on this server (e.g. `LOCAL_STT_URL` unset).

Limits: one upstream session per socket, max session `MAX_SESSION_SECONDS` (default 600, then a non-fatal
error + graceful stop). Audio that arrives while the upstream is still connecting is buffered (max 5 s).
Upstream is closed whenever the client goes away. `stop` waits up to 8 s for `session.end`.
The browser asks for the mic **before** opening the socket, so a denied permission never starts a paid session.

Client side: the transcript shown = all `final` texts joined + the current `partial` (greyed). A trailing
partial that never got a final is kept. After Stop the user can edit the text and title, then **Save** (POST)
or **Discard**; recording again is disabled until they do.

## 9. Repo layout (actual)

```
/                     package.json (npm workspaces), eslint.config.js, .prettierrc.json, .prettierignore,
                      .env (git-ignored) + .env.example, CLAUDE.md (points here), README.md (phase 5)
docs/PLAN.md          this file
server/
  drizzle.config.ts           drizzle-kit config (loaded as CommonJS: no import.meta, uses process.cwd())
  drizzle/                    generated SQL migrations (committed) — 0000_init.sql applied to Neon
  scripts/smoke-stt.ts        live E2E: Sarvam TTS → our WS → transcript (needs server running)
  src/config/env.ts           zod-validated env (loads root .env with process.loadEnvFile)
  src/db/schema.ts            Drizzle tables
  src/db/client.ts            pg Pool + drizzle; withStrictSsl() pins sslmode=verify-full (silences pg warning)
  src/db/migrate.ts           runs migrations in server/drizzle (npm start runs it first)
  src/lib/languages.ts        STT/TTS language + mode + speaker lists
  src/lib/errors.ts           HttpError + Fastify error handler (zod → 400)
  src/repositories/types.ts   repository interfaces (routes depend on these)
  src/repositories/transcripts.ts   Drizzle implementation
  src/services/sarvamTts.ts   TTS REST call
  src/services/sarvamRealtime.ts  upstream WS URL builder + event normaliser + close-code text
  src/routes/{health,meta,transcripts,tts,transcribe}.ts
  src/app.ts                  buildApp(deps): helmet/CSP, rate limit, routes, SPA static + fallback; no listen
  src/index.ts                wires real deps, listen + graceful shutdown
  test/fakes.ts               in-memory repos + buildTestApp()
  test/lib.test.ts            keys, Sarvam URL/event normaliser, helpers
  test/routes.test.ts         REST via app.inject (CRUD, isolation, validation, pagination, TTS)
  test/transcribe.test.ts     WS proxy against a fake Sarvam ws server
web/
  index.html, vite.config.ts (proxy /api incl. ws → :3000), public/favicon.svg
  public/pcm-processor.js     AudioWorklet: box-filter downsample → Int16 → 100 ms frames + RMS level
  src/lib/api.ts              typed fetch client (parses { error })
  src/lib/recorder.ts         getUserMedia + AudioContext + worklet; friendly mic-permission errors
  src/lib/format.ts           date / duration / language-name helpers
  src/hooks/useTranscriber.ts WS session state machine (idle → connecting → live → stopping → idle)
  src/hooks/useMeta.ts        GET /api/meta (refreshed every 60 s: engine availability)
  src/hooks/useToast.tsx      tiny toast context (aria-live)
  src/components/Studio.tsx          language/mode pickers, record button + level ring, live text, save/discard draft
  src/components/History.tsx         debounced search, list, pagination, empty/loading/error states
  src/components/TranscriptItem.tsx  view / inline edit / delete confirm / copy / listen (TTS)
  src/components/icons.tsx           inline SVG icons
  src/App.tsx, main.tsx, styles.css (light + dark)
e2e/browser.e2e.mjs           Playwright + fake mic: record → save → edit → listen → search → delete (screens → e2e/out/)
Dockerfile, .dockerignore     multi-stage image, runs migrate then server on :3000
deploy/                       docker-compose.yml (app + stt-local + Caddy), Caddyfile, EC2.md
stt-local/                    Python sidecar: app/main.py (FastAPI + faster-whisper), Dockerfile (converts
                              official weights to CT2 int8 at build), requirements*.txt
server/src/services/engines/  types.ts (EngineSession), index.ts (createEngines + /api/meta status),
                              sarvam.ts, localWhisper.ts (+ HTTP client, cached health), segmenter.ts (VAD)
server/drizzle/0001_*.sql     adds transcripts.engine (applied to Neon 2026-11-25)
server/drizzle/0002_*.sql     drops workspaces + transcripts.workspace_id (shared history, applied 2026-11-25)
```

## 13. Self-hosted engine (Phase 7) — design

**Model:** `Oriserve/Whisper-Hindi2Hinglish-Swift` (Apache-2.0), a fine-tune of `openai/whisper-base`
(72.6M params). Input: Hindi / English / mixed speech. Output: **Hinglish in Latin script**
(e.g. "kal ki meeting das baje hai, please join karo"). Pinned revision
`cd0d4d013062d542569135460a79025337df1982`. Model card uses `language="en"`, `task="transcribe"` —
**tested:** `hi` was as good or better (kept "I will" that `en` dropped), so the sidecar default is `hi`.
Measured on a 4-thread x86 laptop (Docker): 0.7–1.7 s per phrase, beam 5 ≈ +0.3 s over greedy;
idle RAM ~160 MB; image 911 MB (faster-whisper pulls PyAV + onnxruntime).

**Why a sidecar:** Whisper is not a streaming model, and CPU inference is a Python strength
(CTranslate2 int8 ≈ 4× faster than PyTorch on CPU, small RAM). The Node app stays the single
public entry point; the sidecar is only reachable on the internal Docker network.

```
Browser ──WS /api/transcribe {engine:"local"}──▶ Node: LocalWhisperSession
                                                   energy VAD → utterances (100 ms frames)
                                                   partial every ~1 s of speech  ─┐ HTTP POST /transcribe
                                                   final at ≥700 ms silence      ─┴▶ stt-local (FastAPI, faster-whisper)
```

### stt-local service (`stt-local/`)

- `GET /health` → `{ ok, model, revision, computeType, threads }`
- `POST /transcribe?beam=1|5&language=en` — body: raw PCM16LE mono 16 kHz (`application/octet-stream`,
  ≤ 30 s = 960 KB) → `{ text, audioS, inferenceMs }`. Greedy (`beam=1`) for partials, beam 5 for finals.
  `vad_filter=False` (Node segments), `condition_on_previous_text=False`, `without_timestamps=True`.
- Dockerfile: stage 1 installs CPU torch + transformers + ctranslate2 and runs
  `ct2-transformers-converter --quantization int8 --copy_files tokenizer.json preprocessor_config.json`;
  stage 2 is slim (faster-whisper + fastapi + uvicorn) + the converted model, non-root, healthcheck.
- No auth: never published to the internet (compose `expose`, not `ports`).

### Node side

- Env `LOCAL_STT_URL` (optional). Unset ⇒ engine shown as unavailable.
- `server/src/services/engines/` — common `EngineSession` interface (`pushAudio`, `stop`, `close`) +
  callbacks (`onEvent`, `onReady`, `onEnded`, `onFatal`):
  - `sarvam.ts` — the existing upstream WS logic moved out of `routes/transcribe.ts`.
  - `localWhisper.ts` — VAD segmenter + HTTP calls to the sidecar. Rules: speech starts after 2 voiced
    frames (keeps 300 ms pre-roll), ends after 700 ms silence, force-cut at 15 s; one inference in flight
    per session; partial results for an utterance are dropped once its final arrives; finals emitted in order;
    utterances with < 400 ms of voiced audio are ignored (Whisper hallucinates on noise).
  - `segmenter.ts` — pure, unit-tested energy VAD (RMS over int16 frames, adaptive noise floor).
- WS `start` message gains `engine: "sarvam" | "local"` (default `sarvam`). Local ignores language/mode.
- `/api/meta` gains `engines: [{ id, label, kind: "third-party"|"self-hosted", model, available, notes }]`;
  local availability = cached (30 s) `GET {LOCAL_STT_URL}/health`. `cache-control: max-age=30`.
- DB: migration `0001` adds `transcripts.engine varchar(16) not null default 'sarvam'`; POST accepts `engine`.

### UI

- Studio gets an **Engine** choice (two radio cards) above the pickers:
  - **Sarvam saaras:v4** — "Third-party API · 23 languages · live word-by-word"
  - **Whisper Hinglish** — "Self-hosted open-source · runs on our server · Hindi/English → Hinglish"
  - Unavailable engine is disabled with an "offline" note.
- With the local engine: language/output pickers hidden, a note explains the Hinglish output and that text
  arrives in short bursts. Engine is saved in prefs and on each transcript; History shows an engine tag.

### Deploy

- `deploy/docker-compose.yml`: add `stt-local` (build `../stt-local`), app gets `LOCAL_STT_URL=http://stt-local:8000`.
- Local dev: `npm run stt-local` (docker build + run on :8001) and `LOCAL_STT_URL=http://localhost:8001` in `.env`.
- EC2 `t4g.large` (2 vCPU Graviton, 8 GB) — ARM64 images build natively there. Security group must allow 80/443
  (they time out today). Domain: `13-228-120-191.sslip.io`.

## 10. Progress

### Phase 0 — scaffold

- [x] `git init -b main`, folders created
- [x] Root `package.json` (workspaces, scripts), `.gitignore`, `.env.example`, `.prettierrc.json`, `.prettierignore`, `eslint.config.js`
- [x] This plan (`docs/PLAN.md`) + root `CLAUDE.md` pointer
- [x] `server/package.json`, `server/tsconfig.json`, `server/tsconfig.build.json`, `server/drizzle.config.ts`
- [x] `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`
- [x] `npm install` at root succeeds

### Phase 1 — server core + DB

- [x] `env.ts`, `db/schema.ts`, `db/client.ts`, `db/migrate.ts`
- [x] Generate first migration (`npm run db:generate`) and apply to Neon (`npm run db:migrate`)
- [x] `apiKey.ts`, `errors.ts`, `languages.ts`
- [x] Repositories (workspaces, transcripts)
- [x] Auth plugin, routes: health, meta, workspaces, transcripts (CRUD)
- [x] `app.ts` (helmet, rate limit, error handler, static SPA in prod) + `index.ts` (graceful shutdown)
- [x] Manual check with curl: create workspace → CRUD a transcript

### Phase 2 — live transcription

- [x] `services/sarvamRealtime.ts` (URL + event normaliser)
- [x] `routes/transcribe.ts` WS proxy with limits
- [x] Smoke test script `server/scripts/smoke-stt.ts`: TTS a Hindi+English sentence → 16 kHz PCM → stream through our WS → print partial/final (confirms Sarvam event shapes)

### Phase 3 — TTS bonus

- [x] `services/sarvamTts.ts` + `routes/tts.ts`

### Phase 4 — frontend

- [x] API client, workspace key hook, WorkspaceBar
- [x] AudioWorklet + recorder + level meter
- [x] useTranscriber + Studio UI (language picker incl. auto, mode picker, live partial/final text)
- [x] Save / discard after stop (editable title + text)
- [x] History dashboard: search, pagination, inline edit, delete with confirm, copy, listen (TTS)
- [x] Error/empty/loading states, mic-permission errors, responsive layout, keyboard access

### Phase 5 — quality

- [x] Vitest tests pass (`npm test`): 23 tests
- [x] `npm run typecheck` and `npm run lint` clean
- [x] Full local run: `npm run dev`, speak Hinglish, save, edit, delete (automate with Playwright + Chromium
      `--use-file-for-fake-audio-capture=<wav>` so no real mic is needed) → `npm run test:e2e` (e2e/browser.e2e.mjs)
- [x] Production build runs: `npm run build && npm start` serves SPA on :3000
- [x] README (setup, architecture, API, decisions, limitations)

### Phase 6 — deploy (later, owner will trigger)

- [x] Dockerfile (multi-stage, non-root, healthcheck, migrates on start) — built + run locally OK (334 MB)
- [x] `deploy/docker-compose.yml` + `deploy/Caddyfile` (auto HTTPS) + `deploy/EC2.md` step-by-step
      (**HTTPS is mandatory** — browsers only allow the microphone on https or localhost; sslip.io works without a domain)
- [x] GitHub repo created and pushed (see README / git remote)
- [x] EC2 deployed: https://vaani.myonlineclipboard.com (Let's Encrypt cert, valid to 2027-02-23); README updated

### Phase 8 — one shared history (section 5)

- [x] Migration 0002: drop `workspace_id` + `workspaces` (keep all transcripts), index `created_at desc`
- [x] Server: remove apiKey/auth/workspace routes+repo; transcripts/TTS/WS without keys
- [x] Web: remove WorkspaceBar/useWorkspace/workspaceKey; API client without keys; "shared" note in History
- [x] Tests + E2E updated (E2E can't assume an empty history any more)
- [x] Docs (README, PLAN 6/7/8/9), push, redeploy EC2

### Phase 7 — self-hosted engine (section 13)

- [x] `stt-local/` FastAPI + faster-whisper service, Dockerfile (convert official weights, pinned)
- [x] Build + run locally; measure latency; pick `language` (en vs hi)
- [x] Engine abstraction in Node (`services/engines/`), Sarvam moved, `LocalWhisperSession` + segmenter
- [x] Meta `engines`, WS `engine` field, migration `0001` (`transcripts.engine`)
- [x] UI engine picker, local-mode note, engine tag in History
- [x] Tests: segmenter unit tests, WS proxy with fake local sidecar; E2E for both engines
- [x] Compose + EC2 docs updated

## 11. Conventions

- Run the self-hosted engine locally: `npm run stt-local` (Docker, port 8001) and start the app with
  `LOCAL_STT_URL=http://localhost:8001 npm run dev`. E2E per engine: `ENGINE=local npm run test:e2e`.

- ESM everywhere (`"type": "module"`); server imports use `.js` suffixes (NodeNext).
- No secrets in code, logs or the client bundle. Logger redacts `authorization` and cookies.
- Validate every input with zod at the edge; repositories trust their inputs.
- Keep `docs/PLAN.md` updated when a decision or contract changes.
- Only commit, push or deploy when the owner asks (nothing is committed yet — `git status` shows all work).

## 12. Session log

- 2026-11-24 — Plan written. Decided stack (section 2), checked Sarvam realtime + TTS docs (section 3).
  Root config files created. Next: Phase 0 remaining items (server/web package files), then Phase 1.
- 2026-11-24 — Phases 0–3 done. Migration `server/drizzle/0000_init.sql` applied to Neon (DB was empty).
  REST CRUD verified with curl; `npm run smoke:stt -w server` (server must be running) streams TTS audio through
  our WS → got final `नमस्ते, मेरा नाम Rahul है और I am testing this speech-to-text application today.` (auto + codemix).
  Next: Phase 5 vitest tests, then Phase 4 frontend.
- 2026-11-24 — Server tests written (23 passing; they caught a duplicate upstream `end`, fixed with `endSent`).
  Frontend (Phase 4) written; `npm run typecheck` + `npm run lint` clean. Sections 3, 5, 7, 8, 9 synced with the code.
  Next: browser E2E of the full flow, production build check, README, then Dockerfile/deploy notes.
- 2026-11-24 — Browser E2E passes on dev and on the production build (fake-mic Hinglish →
  `नमस्ते, कल की meeting 10 बजे है, please सबको time पे join करने के लिए बोलो।`, no console errors).
  UI polish from screenshots (aligned selects, live-preview note). CSP `upgrade-insecure-requests` disabled
  (TLS is at the proxy). README, Dockerfile, deploy/ written; Docker image verified locally.
  Neon now holds a few test workspaces/transcripts from smoke/E2E runs (harmless, scoped to throwaway keys).
  Next (owner): git commit + push to GitHub, then EC2 per deploy/EC2.md.
- 2026-11-25 — Owner asked for a second, self-hosted engine selectable in the UI. EC2 checked: `t4g.large`
  (ARM64, 2 vCPU, 7.6 GB RAM, 17 GB free disk), Ubuntu 24.04, nothing installed, region ap-southeast-1;
  ports 80/443 blocked by the security group. Plan written (section 13, Phase 7). Starting implementation.
- 2026-11-25 — Phase 7 done. `stt-local` image builds (8 min first time) and serves the model; Node engine
  abstraction (Sarvam moved, local Whisper + VAD segmenter); migration 0001 applied; UI engine picker.
  34 server tests pass; browser E2E passes for BOTH engines (local → "Namaste, kal ki 18 das baje hai, please
  sabko time par join karne ke lie bolo." — "meeting"→"18" is the small model's error; Sarvam unchanged).
  `docker compose config` valid. Next (owner): GitHub push, open SG ports 80/443, deploy per deploy/EC2.md.
- 2026-11-25 — Deployed to EC2 (no GitHub yet: project tarball + `.env` copied over SSH to `~/vaani`).
  Docker 29 + Compose v5 installed; `deploy/.env` holds `DOMAIN=vaani.myonlineclipboard.com`. All three
  containers up (app healthy, DB OK, both engines available; stt-local 153 MB RAM). Blocker: the security group
  still drops 80/443, so Caddy can't get the Let's Encrypt cert yet (owner to open; local AWS CLI creds invalid).
- 2026-11-25 — Security group opened; Caddy got the Let's Encrypt cert. Browser E2E passes against the LIVE
  site for both engines (Sarvam: Devanagari+English code-mix; local: "Namaste, kal ki meeting das baje hai, ...").
  Code committed and pushed to GitHub. The server copy in ~/vaani is still the uploaded tarball, not a git clone.
- 2026-11-25 — Phase 8: one shared history. Removed workspace keys end to end (server auth/routes/repo,
  web WorkspaceBar/hooks). Migration 0002 applied to Neon (5 transcripts kept). 28 server tests pass; browser
  E2E passes on both engines (E2E now uses a unique title per run since the history is shared).
  Commit trailers: owner wants NO Claude co-author lines; the first commit was reworded and force-pushed.
