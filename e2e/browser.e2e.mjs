/**
 * Browser E2E: a fake microphone (a WAV of real Hinglish speech, made with Sarvam TTS) drives the
 * whole flow in headless Chromium: record → live transcript → save → edit → listen → search → delete.
 *
 *   npx playwright install chromium        # once
 *   npm run dev                            # or: npm run build && npm start (then BASE=http://localhost:3000)
 *   npm run test:e2e                       # Sarvam engine
 *   ENGINE=local npm run test:e2e          # self-hosted Whisper engine (sidecar must be running)
 *
 * Screenshots go to e2e/out/. Needs SARVAM_API_KEY in .env (to synthesise the test audio).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const projectRoot = resolve(import.meta.dirname, '..');
const outDir = join(projectRoot, 'e2e', 'out');
mkdirSync(outDir, { recursive: true });
process.loadEnvFile(join(projectRoot, '.env'));
const BASE = process.env.BASE ?? 'http://localhost:5173';
const ENGINE = process.env.ENGINE === 'local' ? 'local' : 'sarvam';
const shot = (page, name) =>
  page.screenshot({ path: join(outDir, `${ENGINE}-${name}.png`), fullPage: true });

// 1. Make a "microphone" WAV: 1.5 s silence + Hinglish speech + 3 s silence, 16 kHz mono PCM16.
const res = await fetch('https://api.sarvam.ai/text-to-speech', {
  method: 'POST',
  headers: {
    'api-subscription-key': process.env.SARVAM_API_KEY,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    text: 'नमस्ते, kal ki meeting दस बजे है, please sabko time pe join karne ke liye bolo.',
    target_language_code: 'hi-IN',
    speaker: 'shubh',
    model: 'bulbul:v3',
    speech_sample_rate: 16000,
  }),
});
if (!res.ok) throw new Error(`TTS ${res.status} ${await res.text()}`);
const wav = Buffer.from((await res.json()).audios[0], 'base64');
const dataAt = wav.indexOf(Buffer.from('data'));
const pcm = wav.subarray(dataAt + 8, dataAt + 8 + wav.readUInt32LE(dataAt + 4));
const audio = Buffer.concat([Buffer.alloc(16000 * 2 * 1.5), pcm, Buffer.alloc(16000 * 2 * 3)]);
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + audio.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(16000, 24);
header.writeUInt32LE(32000, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(audio.length, 40);
const micFile = join(outDir, 'mic.wav');
writeFileSync(micFile, Buffer.concat([header, audio]));
const speechSeconds = audio.length / 32000;
console.log(`mic file: ${speechSeconds.toFixed(1)} s`);

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${micFile}%noloop`,
  ],
});
const context = await browser.newContext({
  viewport: { width: 1360, height: 900 },
  permissions: ['microphone'],
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const wsEvents = [];
page.on('websocket', (ws) => {
  if (!ws.url().includes('/api/transcribe')) return;
  ws.on(
    'framereceived',
    (f) => typeof f.payload === 'string' && wsEvents.push(JSON.parse(f.payload)),
  );
});

const step = (s) => console.log(`✓ ${s}`);

await page.goto(BASE);
await page.locator('.history .card__head p').waitFor({ timeout: 15000 });
step(`history: ${await page.locator('.history .card__head p').textContent()}`);

// The history is shared with everyone, so this run works only with its own uniquely titled item.
const TITLE = `E2E ${ENGINE} ${Date.now()}`;
const mine = page.locator('.item', { has: page.locator('.item__title', { hasText: TITLE }) });

// Pick the engine (the radio cards come from /api/meta).
const engineName = ENGINE === 'local' ? /Whisper Hinglish/ : /Sarvam/;
const engineRadio = page.getByRole('radio', { name: engineName });
await engineRadio.waitFor();
if (await engineRadio.isDisabled()) throw new Error(`${ENGINE} engine is offline`);
await engineRadio.check({ force: true });
step(`engine: ${ENGINE}`);
await shot(page, '01-start');

// Record
await page.getByRole('button', { name: 'Start recording' }).click();
await page.locator('.status--live').waitFor({ timeout: 15000 });
step('live');
await page.waitForTimeout((speechSeconds - 2.5) * 1000);
await shot(page, '02-live');
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Stop recording' }).click();
const textarea = page.locator('.draft textarea');
await textarea.waitFor({ timeout: 15000 });
const transcript = await textarea.inputValue();
step(`transcript: ${transcript}`);
if (!transcript.trim()) throw new Error('empty transcript');
await shot(page, '03-draft');

// Save
await page.locator('.draft input').fill(TITLE);
await page.getByRole('button', { name: 'Save transcript' }).click();
await page.getByText('Transcript saved').waitFor();
await mine.waitFor();
step('saved + listed');
await shot(page, '04-saved');

// Edit
await mine.getByRole('button', { name: 'Edit' }).click();
await page.locator('.item--editing textarea').fill(`${transcript} (edited)`);
await page.getByRole('button', { name: 'Save changes' }).click();
await page.getByText('Changes saved').waitFor();
await mine.locator('.item__text', { hasText: '(edited)' }).waitFor();
await mine.locator('.tag', { hasText: 'edited' }).waitFor();
step('edited');

// Listen (TTS)
await mine.getByRole('button', { name: 'Listen' }).click();
await mine.getByRole('button', { name: /Stop playback|Listen/ }).waitFor();
await page.waitForTimeout(2500);
const ttsError = await page.locator('.toast--error').count();
step(`listen (tts errors: ${ttsError})`);

// Search
await page.getByPlaceholder('Search titles and text').fill('zzzz-nothing-matches-this');
await page.getByText('No transcripts match').waitFor();
await page.getByPlaceholder('Search titles and text').fill(TITLE);
await mine.waitFor();
step('search');

// Mobile + dark
await page.setViewportSize({ width: 390, height: 844 });
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(300);
await shot(page, '06-mobile-dark');
await page.setViewportSize({ width: 1360, height: 900 });
await page.emulateMedia({ colorScheme: 'light' });

// Delete (still filtered to this run's item)
await mine.getByRole('button', { name: 'Delete' }).click();
await mine
  .getByRole('group', { name: 'Confirm delete' })
  .getByRole('button', { name: 'Delete' })
  .click();
await page.getByText('Transcript deleted').waitFor();
await page.getByText('No transcripts match').waitFor();
step('deleted');

const types = [...new Set(wsEvents.map((e) => e.type))];
console.log('ws event types:', types.join(', '));
console.log(
  'detected languages:',
  [...new Set(wsEvents.map((e) => e.language).filter(Boolean))].join(', '),
);
console.log('console errors:', consoleErrors.length ? consoleErrors : 'none');
await browser.close();
if (consoleErrors.length) process.exitCode = 1;
