import { describe, expect, it } from 'vitest';
import { UtteranceSegmenter, rms, type SegmenterEvent } from '../src/services/engines/segmenter.js';

const RATE = 16_000;

function tone(seconds: number, amplitude = 0.3): Buffer {
  const n = Math.round(seconds * RATE);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * 220 * i) / RATE) * amplitude * 32767;
    buf.writeInt16LE(Math.round(v), i * 2);
  }
  return buf;
}

function noise(seconds: number, amplitude: number): Buffer {
  const n = Math.round(seconds * RATE);
  const buf = Buffer.alloc(n * 2);
  let seed = 42;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    buf.writeInt16LE(Math.round(((seed / 0x7fffffff) * 2 - 1) * amplitude * 32767), i * 2);
  }
  return buf;
}

const silence = (seconds: number) => Buffer.alloc(Math.round(seconds * RATE) * 2);

/** Feeds audio in browser-sized 100 ms chunks. */
function feed(seg: UtteranceSegmenter, audio: Buffer): SegmenterEvent[] {
  const events: SegmenterEvent[] = [];
  for (let i = 0; i < audio.length; i += 3200) {
    events.push(...seg.push(audio.subarray(i, i + 3200)));
  }
  return events;
}

const ends = (events: SegmenterEvent[]) =>
  events.filter((e): e is Extract<SegmenterEvent, { type: 'end' }> => e.type === 'end');

describe('UtteranceSegmenter', () => {
  it('measures RMS', () => {
    expect(rms(silence(0.1))).toBe(0);
    expect(rms(tone(0.1, 0.5))).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('finds one utterance, keeping pre-roll and dropping long trailing silence', () => {
    const seg = new UtteranceSegmenter();
    const events = feed(seg, Buffer.concat([silence(1), tone(1.5), silence(1)]));
    expect(events.map((e) => e.type)).toEqual(['start', 'end']);
    const [end] = ends(events);
    const seconds = end!.audio.length / 32_000;
    expect(seconds).toBeGreaterThan(1.5); // speech + pre-roll
    expect(seconds).toBeLessThan(2.1); // not the whole trailing second of silence
    expect(end!.voicedMs).toBeGreaterThanOrEqual(1400);
    expect(end!.forced).toBe(false);
  });

  it('splits two utterances separated by a pause', () => {
    const seg = new UtteranceSegmenter();
    const events = feed(seg, Buffer.concat([tone(1), silence(1), tone(1), silence(1)]));
    expect(events.map((e) => e.type)).toEqual(['start', 'end', 'start', 'end']);
  });

  it('does not end the utterance on a short gap between words', () => {
    const seg = new UtteranceSegmenter();
    const events = feed(seg, Buffer.concat([tone(0.8), silence(0.3), tone(0.8), silence(1)]));
    expect(events.map((e) => e.type)).toEqual(['start', 'end']);
  });

  it('ignores steady low background noise', () => {
    const seg = new UtteranceSegmenter();
    expect(feed(seg, noise(3, 0.005))).toEqual([]);
  });

  it('force-cuts very long speech', () => {
    const seg = new UtteranceSegmenter({ maxUtteranceMs: 2000 });
    const cuts = ends(feed(seg, tone(5)));
    expect(cuts.length).toBeGreaterThanOrEqual(2);
    expect(cuts[0]!.forced).toBe(true);
  });

  it('exposes the utterance in progress and flushes it on stop', () => {
    const seg = new UtteranceSegmenter();
    feed(seg, Buffer.concat([silence(0.5), tone(1.2)]));
    expect(seg.speaking).toBe(true);
    expect(seg.currentAudio()!.length / 32_000).toBeGreaterThan(1.2);
    expect(seg.flush().map((e) => e.type)).toEqual(['end']);
    expect(seg.speaking).toBe(false);
    expect(seg.flush()).toEqual([]);
  });
});
