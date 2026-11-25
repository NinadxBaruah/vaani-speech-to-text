/**
 * Energy-based voice-activity segmenter for PCM16LE mono 16 kHz audio.
 *
 * Whisper transcribes whole clips, not streams, so the self-hosted engine cuts the live
 * audio into utterances: speech starts after a few loud frames (with pre-roll so the first
 * syllable isn't clipped) and ends after a stretch of silence or a hard length cap.
 * The threshold follows an adaptive noise floor, so a quiet room and a noisy one both work.
 */

export const SAMPLE_RATE = 16_000;
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000; // 32

export interface SegmenterOptions {
  frameMs: number;
  /** Consecutive voiced frames needed to start an utterance. */
  startFrames: number;
  /** Silence that ends an utterance. */
  endSilenceMs: number;
  /** Audio kept from before the start was detected. */
  prerollMs: number;
  /** Hard cap; the utterance is cut here even if speech continues. */
  maxUtteranceMs: number;
  /** Absolute minimum RMS (0..1) for a frame to count as voiced. */
  minThreshold: number;
  /** Voiced if RMS > noiseFloor × this. */
  noiseMultiplier: number;
}

export const DEFAULT_SEGMENTER_OPTIONS: SegmenterOptions = {
  frameMs: 30,
  startFrames: 3,
  endSilenceMs: 700,
  prerollMs: 300,
  maxUtteranceMs: 15_000,
  minThreshold: 0.012,
  noiseMultiplier: 3,
};

export type SegmenterEvent =
  { type: 'start' } | { type: 'end'; audio: Buffer; voicedMs: number; forced: boolean };

/** RMS of a PCM16LE buffer, normalised to 0..1. */
export function rms(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples);
}

export class UtteranceSegmenter {
  private readonly o: SegmenterOptions;
  private readonly frameBytes: number;
  private remainder: Buffer = Buffer.alloc(0);
  private preroll: Buffer[] = [];
  private utterance: Buffer[] = [];
  private utteranceBytes = 0;
  private voicedFrames = 0;
  private silentFrames = 0;
  private streak = 0;
  private noiseFloor = 0.004;
  private inSpeech = false;

  constructor(options: Partial<SegmenterOptions> = {}) {
    this.o = { ...DEFAULT_SEGMENTER_OPTIONS, ...options };
    this.frameBytes = this.o.frameMs * BYTES_PER_MS;
  }

  get speaking(): boolean {
    return this.inSpeech;
  }

  /** Audio of the utterance in progress (for live partials), or null between utterances. */
  currentAudio(): Buffer | null {
    return this.inSpeech ? Buffer.concat(this.utterance, this.utteranceBytes) : null;
  }

  /** Milliseconds of voiced audio in the utterance in progress. */
  currentVoicedMs(): number {
    return this.voicedFrames * this.o.frameMs;
  }

  push(chunk: Buffer): SegmenterEvent[] {
    const events: SegmenterEvent[] = [];
    let data = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk;
    while (data.length >= this.frameBytes) {
      this.onFrame(data.subarray(0, this.frameBytes), events);
      data = data.subarray(this.frameBytes);
    }
    this.remainder = Buffer.from(data);
    return events;
  }

  /** Ends the utterance in progress (used on stop). */
  flush(): SegmenterEvent[] {
    if (!this.inSpeech) return [];
    if (this.remainder.length) this.append(this.remainder);
    this.remainder = Buffer.alloc(0);
    return [this.end(true)];
  }

  private onFrame(frame: Buffer, events: SegmenterEvent[]) {
    const level = rms(frame);
    const threshold = Math.max(this.o.minThreshold, this.noiseFloor * this.o.noiseMultiplier);

    if (!this.inSpeech) {
      const voiced = level > threshold;
      if (!voiced) this.noiseFloor = this.noiseFloor * 0.95 + level * 0.05;
      this.streak = voiced ? this.streak + 1 : 0;
      this.preroll.push(Buffer.from(frame));
      const maxPreroll = Math.ceil(this.o.prerollMs / this.o.frameMs) + this.o.startFrames;
      if (this.preroll.length > maxPreroll) this.preroll.shift();

      if (this.streak >= this.o.startFrames) {
        this.inSpeech = true;
        this.utterance = [];
        this.utteranceBytes = 0;
        for (const f of this.preroll) this.append(f);
        this.preroll = [];
        this.voicedFrames = this.streak;
        this.silentFrames = 0;
        this.streak = 0;
        events.push({ type: 'start' });
      }
      return;
    }

    // In speech: slightly lower bar (hysteresis) so soft word endings don't cut the utterance.
    const voiced = level > threshold * 0.7;
    this.append(frame);
    if (voiced) {
      this.voicedFrames++;
      this.silentFrames = 0;
    } else {
      this.silentFrames++;
    }

    if (this.silentFrames * this.o.frameMs >= this.o.endSilenceMs) {
      events.push(this.end(false));
    } else if (this.utteranceBytes >= this.o.maxUtteranceMs * BYTES_PER_MS) {
      events.push(this.end(true));
    }
  }

  private append(frame: Buffer) {
    this.utterance.push(Buffer.from(frame));
    this.utteranceBytes += frame.length;
  }

  private end(forced: boolean): SegmenterEvent {
    // Drop most of the trailing silence; keep ~200 ms so the last word isn't clipped.
    const keepSilence = Math.ceil(200 / this.o.frameMs);
    const drop = Math.max(0, this.silentFrames - keepSilence);
    const frames = drop ? this.utterance.slice(0, this.utterance.length - drop) : this.utterance;
    const audio = Buffer.concat(frames);
    const voicedMs = this.voicedFrames * this.o.frameMs;

    this.inSpeech = false;
    this.utterance = [];
    this.utteranceBytes = 0;
    this.voicedFrames = 0;
    this.silentFrames = 0;
    this.streak = 0;
    return { type: 'end', audio, voicedMs, forced };
  }
}
