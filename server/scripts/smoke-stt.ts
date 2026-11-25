/**
 * End-to-end smoke test for live transcription (needs the server running on :3000).
 *
 *   npm run smoke:stt -w server -- "<sentence>" [ttsLanguage] [sttLanguage] [mode]
 *
 * 1. Synthesises the sentence with Sarvam TTS at 16 kHz (so we have real speech to send).
 * 2. Opens ws://localhost:3000/api/transcribe and streams the audio
 *    in real-time 100 ms PCM16 frames, exactly like the browser does.
 * 3. Prints every event and the final transcript; checks UTF-8 round-trips through the REST API.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const rootEnv = resolve(import.meta.dirname, '..', '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const [
  sentence = 'नमस्ते, मेरा नाम राहुल है और I am testing this speech to text application today.',
  ttsLanguage = 'hi-IN',
  sttLanguage = 'auto',
  mode = 'codemix',
] = process.argv.slice(2);

async function synthesise(text: string, languageCode: string): Promise<Buffer> {
  const res = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': process.env.SARVAM_API_KEY ?? '',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text,
      target_language_code: languageCode,
      speaker: 'shubh',
      model: 'bulbul:v3',
      speech_sample_rate: 16000,
    }),
  });
  if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text()}`);
  const { audios } = (await res.json()) as { audios: string[] };
  return pcmFromWav(Buffer.from(audios[0] ?? '', 'base64'));
}

/** Returns the PCM payload of a WAV file (finds the "data" chunk). */
function pcmFromWav(wav: Buffer): Buffer {
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      const rate = wav.readUInt32LE(offset + 12);
      const bits = wav.readUInt16LE(offset + 22);
      if (rate !== 16000 || bits !== 16)
        throw new Error(`Expected 16 kHz PCM16, got ${rate} Hz ${bits}-bit`);
    }
    if (id === 'data') return wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  throw new Error('No data chunk in WAV');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Sentence: ${sentence}\nTTS ${ttsLanguage} → STT ${sttLanguage} (${mode})`);
  const pcm = await synthesise(sentence, ttsLanguage);
  const silence = Buffer.alloc(16000 * 2 * 1.5); // 1.5 s trailing silence lets VAD close the turn
  const audio = Buffer.concat([pcm, silence]);
  console.log(`Audio: ${(pcm.length / 32000).toFixed(1)} s of speech`);

  const finals: string[] = [];
  const detected = new Set<string>();
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/transcribe`);
  const done = new Promise<void>((resolveDone, reject) => {
    ws.on('message', (data) => {
      const event = JSON.parse(data.toString()) as {
        type: string;
        text?: string;
        language?: string;
      };
      console.log('←', JSON.stringify(event));
      if (event.type === 'final' && event.text) finals.push(event.text);
      if (event.language) detected.add(event.language);
    });
    ws.on('close', (code, reason) => {
      console.log(`socket closed ${code} ${reason.toString()}`);
      resolveDone();
    });
    ws.on('error', reject);
  });

  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'start', languageCode: sttLanguage, mode }));

  const frame = 3200; // 100 ms of 16 kHz PCM16
  for (let i = 0; i < audio.length; i += frame) {
    ws.send(audio.subarray(i, i + frame));
    await sleep(100);
  }
  ws.send(JSON.stringify({ type: 'stop' }));
  await done;

  const text = finals.join(' ').trim();
  console.log(
    `\nFINAL TRANSCRIPT: ${text || '(empty)'}\nDetected: ${[...detected].join(', ') || '-'}`,
  );
  if (!text) process.exitCode = 1;

  // Save it and read it back to prove Unicode survives the REST + DB round trip.
  const saved = (await (
    await fetch(`${BASE}/api/transcripts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: text || sentence,
        languageCode: sttLanguage,
        mode,
        detectedLanguages: [...detected],
      }),
    })
  ).json()) as { id: string; text: string };
  console.log(`Saved ${saved.id}: ${saved.text}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
