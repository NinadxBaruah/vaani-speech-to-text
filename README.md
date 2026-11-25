# Vaani — real-time multilingual speech to text

Speak in any of **23 Indian languages, or mix them** (e.g. Hindi + English), and watch the words appear
live. Pick the engine in the UI: a **third-party API** (Sarvam `saaras:v4`) or a **self-hosted open-source
model** ([Whisper Hindi→Hinglish](https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Swift)) running on
our own server. Save transcripts to Postgres and manage them from a history dashboard: search, edit,
delete, copy and listen back with text-to-speech.

> Built for the Procucev AI hiring assignment (Assignment 1: Real-time Transcription).

**Live demo:** <https://vaani.myonlineclipboard.com> · **Stack:** TypeScript (Fastify + React) + Postgres (Neon) + Sarvam AI, plus a Python inference sidecar (faster-whisper)

---

## What it does

|                                  |                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 🎙️ **Live transcription**        | Partial words stream in while you speak and are finalised at each pause.                                                  |
| ⚙️ **Two engines, your choice**  | **Sarvam saaras:v4** (third-party API, 23 languages) or **self-hosted Whisper Hinglish** (open-source, on our CPU).       |
| 🌐 **Multilingual & code-mixed** | `Auto-detect` handles language switching mid-sentence. All 23 languages the model supports can also be picked explicitly. |
| ✍️ **Output styles**             | _Code-mix_ (`नमस्ते, कल की meeting 10 बजे है`), _Transcribe_, _Romanised_, _Translate to English_, _Verbatim_.                |
| 🗂️ **History with full CRUD**    | Save (with an editable title/text), list newest first, search, paginate, edit inline, delete with confirmation.           |
| 🔊 **Listen back**               | Text-to-speech (Sarvam `bulbul:v3`) for the 11 languages it supports.                                                     |
| 🔑 **No sign-up**                | Each browser gets a **workspace key** automatically. Copy it into another browser to open the same history.               |

Example, from the automated browser test (fake mic playing real Hinglish speech):

```
Spoken:      "नमस्ते, kal ki meeting दस बजे है, please sabko time pe join karne ke liye bolo."
Transcribed: नमस्ते, कल की meeting 10 बजे है, please सबको time पे join करने के लिए बोलो।
Detected:    hi-IN, en-IN
```

## The two engines

|                | Sarvam `saaras:v4` (third-party)                   | Whisper Hindi→Hinglish (self-hosted)                                                                                                         |
| -------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Where it runs  | Sarvam's cloud, via our WebSocket proxy            | Our server: `stt-local` container, CPU only, int8                                                                                            |
| Model          | Sarvam realtime STT                                | [`Oriserve/Whisper-Hindi2Hinglish-Swift`](https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Swift) (whisper-base fine-tune, Apache-2.0) |
| Languages      | 23 Indian languages + auto-detect, 5 output styles | Hindi, English and mixed speech → Hinglish in Latin script                                                                                   |
| Live behaviour | Native streaming: word-by-word partials            | Voice-activity segmentation; a quick preview every ~1 s, beam-search final at each pause                                                     |
| Cost / privacy | Per-minute API pricing; audio leaves our server    | No per-use cost; audio never leaves our server                                                                                               |

Whisper isn't a streaming model, so the Node server cuts the live audio into utterances with an energy-based
voice-activity detector (adaptive noise floor, pre-roll, 700 ms end-of-speech, 15 s cap) and calls the sidecar
for a fast greedy preview while you talk and a beam-search final when you pause. The sidecar converts the
**official** model weights (pinned commit) to CTranslate2 int8 at image build time; no third-party conversions.

## How the "no account" workspace key works

The reviewer shouldn't have to sign up, so there are no accounts:

1. On first visit the app calls `POST /api/workspaces` and gets a random key (`stt_` + 256 bits).
2. The key lives in the browser's `localStorage` and is sent as `Authorization: Bearer <key>`.
3. The server stores **only a SHA-256 hash** of the key. Every query is scoped to that workspace, so one
   key can never read or change another key's transcripts (you get a 404).
4. The key chip (top right) shows it, copies it, opens another workspace from a pasted key, or starts a fresh one.

## Architecture

```
Browser (React + Vite)                     Node 22 server (Fastify)                 External
mic → AudioWorklet → 16 kHz PCM16 ──WS──▶  /api/transcribe  (auth + engine) ─┬─WS──▶ Sarvam saaras:v4 (realtime STT)
          ◀── partial / final text ──────     VAD segmenter (local engine) ──────┴HTTP─▶ stt-local: faster-whisper
                                                                                         (Whisper Hinglish, our CPU)
TanStack Query ──────── REST ───────────▶  /api/transcripts → Drizzle ORM ───────▶ Postgres (Neon)
"Listen" ───────────────────────────────▶  /api/tts ─────────────────────────────▶ Sarvam bulbul:v3 (TTS)
                                           (in production also serves the built SPA)
```

- **The Sarvam API key never reaches the browser.** Audio goes through our WebSocket proxy, which also
  enforces the workspace key, frame-size limits, a start timeout and a maximum session length.
- The browser asks for the microphone **before** opening the socket, so a denied permission never starts
  a paid upstream session.
- One process, one port, one origin: simple to deploy and no CORS.

## Run it locally

Requirements: **Node 22+**, a Postgres database (a free [Neon](https://neon.tech) project works) and a
[Sarvam AI](https://dashboard.sarvam.ai) API key.

```bash
npm install
cp .env.example .env          # set SARVAM_API_KEY and DB_URI
npm run db:migrate            # creates the tables
npm run dev                   # API on :3000, web app on http://localhost:5173
```

Open <http://localhost:5173>, allow the microphone, press the mic and speak.

To also run the **self-hosted engine** locally (needs Docker; the first build downloads and converts the model):

```bash
npm run stt-local             # builds + runs the sidecar on http://localhost:8001
# then in .env: LOCAL_STT_URL=http://localhost:8001  and restart npm run dev
```

Without it the app works normally and shows the self-hosted engine as offline.

Production mode (what runs on the server):

```bash
npm run build
NODE_ENV=production npm start # runs migrations, then serves everything on http://localhost:3000
```

### Scripts

| Command                                                 | What it does                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                           | Server (tsx watch) + Vite dev server with `/api` proxy (incl. WebSocket)                                                                                                        |
| `npm run build` / `npm start`                           | Production build / migrate + serve                                                                                                                                              |
| `npm test`                                              | 34 server tests (Vitest): CRUD, workspace isolation, validation, the voice segmenter, and the WS proxy for both engines against fake Sarvam / sidecar servers                   |
| `npm run test:e2e`                                      | Headless Chromium with a **fake microphone** playing real speech: record → save → edit → listen → search → delete (`npx playwright install chromium` once; app must be running) |
| `npm run smoke:stt -w server`                           | Streams synthesised speech through the live WS and prints every event                                                                                                           |
| `npm run typecheck` / `npm run lint` / `npm run format` | TypeScript, ESLint (incl. React hooks rules), Prettier                                                                                                                          |
| `npm run db:generate` / `npm run db:migrate`            | Create / apply Drizzle SQL migrations                                                                                                                                           |

## API

All JSON under `/api`. Authenticated routes need `Authorization: Bearer <workspace key>`.
Errors look like `{ "error": { "code": "validation_error", "message": "…" } }`.

| Method   | Path                                 | Notes                                                                                                                                                                                |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/api/health`                        | DB check                                                                                                                                                                             |
| `GET`    | `/api/meta`                          | Languages, output modes, TTS voices (the UI reads these from here)                                                                                                                   |
| `POST`   | `/api/workspaces`                    | Creates a workspace, returns its key once (rate-limited)                                                                                                                             |
| `GET`    | `/api/workspaces/me`                 | Current workspace + transcript count                                                                                                                                                 |
| `GET`    | `/api/transcripts?q=&limit=&offset=` | Newest first, case-insensitive search in title and text                                                                                                                              |
| `GET`    | `/api/transcripts/:id`               |                                                                                                                                                                                      |
| `POST`   | `/api/transcripts`                   | `{ text, title?, languageCode?, detectedLanguages?, mode?, durationMs? }`                                                                                                            |
| `PATCH`  | `/api/transcripts/:id`               | `{ title?, text? }`                                                                                                                                                                  |
| `DELETE` | `/api/transcripts/:id`               | `204`                                                                                                                                                                                |
| `POST`   | `/api/tts`                           | `{ text, languageCode, speaker? }` → `audio/wav`                                                                                                                                     |
| `WS`     | `/api/transcribe`                    | `{type:"start", key, languageCode, mode}`, then binary PCM16 16 kHz frames, then `{type:"stop"}`. Server sends `ready / partial / final / speech_start / speech_end / error / ended` |

The full contract, close codes and data model are in [`docs/PLAN.md`](docs/PLAN.md).

## Project layout

```
server/     Fastify API + WebSocket proxy + engines (Sarvam, local Whisper + VAD), Drizzle, Vitest tests
stt-local/  Python sidecar: FastAPI + faster-whisper serving the Whisper Hinglish model
web/      React app (Vite); public/pcm-processor.js is the AudioWorklet that resamples the mic
e2e/      Playwright browser test with a fake microphone
deploy/   Docker Compose + Caddy (automatic HTTPS) and EC2 steps
docs/     PLAN.md: decisions, contracts, progress log
```

## Engineering notes

- **Validation everywhere:** zod for env, request bodies, query strings and WebSocket messages.
- **Security:** hashed workspace keys, per-workspace scoping (404s, not 403s), Helmet with a strict CSP,
  a `Permissions-Policy` that allows only the microphone, rate limits (global, workspace creation, TTS, WS),
  body/frame size limits, secrets redacted from logs, LIKE wildcards escaped in search.
- **Testability:** `buildApp(deps)` takes repository interfaces, the TTS client and the upstream URL, so
  tests use in-memory fakes and a fake Sarvam WebSocket server, with no network or DB needed.
- **Database:** Drizzle migrations are committed SQL and run on start. There is an index on
  `(workspace_id, created_at desc)` for the history list. TLS to Postgres is pinned to `verify-full`.
- **Audio:** an AudioWorklet downsamples to 16 kHz mono PCM16 in 100 ms frames. Audio sent while the
  upstream is still connecting is buffered (up to 5 s) so the first words aren't lost.
- **UX:** live partials in grey, finals in black, an editable draft before saving, empty/loading/error
  states, toasts, mic-permission messages, keyboard focus styles, light/dark themes, mobile layout.

## Choices & trade-offs

- **Why two engines?** The brief prefers a self-deployed open-source model but allows third-party APIs.
  Sarvam `saaras:v4` gives the best coverage (23 languages, native code-mix output, true streaming); the
  self-hosted Whisper Hinglish model shows the same app running fully on our own hardware. Both sit behind one
  `EngineSession` interface (`server/src/services/engines/`), so adding a third engine is one file.
- **Why a Python sidecar for the local model?** CPU inference is Python's home: CTranslate2 int8 runs
  whisper-base several times faster than PyTorch, in ~300 MB of RAM, on x86 or ARM (Graviton). The sidecar is
  stateless and only reachable on the internal Docker network.
- **TTS** uses Sarvam `bulbul:v3` for natural Indian voices. An open-source model (e.g. Piper/IndicTTS) could
  sit behind the same `TtsClient` interface.
- **Workspace key vs. accounts:** zero friction for reviewers. Whoever holds the key has full access to that
  workspace, which is acceptable for a demo; real accounts would replace `requireWorkspace` with session auth.
- **Partial transcripts** come from the model's fast path and may look different (e.g. romanised) until the
  final transcript for that utterance arrives in the chosen output style.
- **HTTPS is required in production:** browsers only allow the microphone on `https://` or `localhost`.

## Deploy

See [`deploy/EC2.md`](deploy/EC2.md): Docker Compose with Caddy for automatic HTTPS. One command on the instance.
