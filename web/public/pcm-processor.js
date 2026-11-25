/**
 * AudioWorklet: turns the mic stream (usually 44.1/48 kHz float) into what Sarvam wants —
 * 16 kHz, mono, 16-bit little-endian PCM — in 100 ms frames (1600 samples = 3200 bytes).
 * Also reports an RMS level per frame for the UI meter.
 *
 * Plain JS on purpose: worklets are loaded by URL, outside the Vite/TS pipeline.
 */
const TARGET_RATE = 16000;
const FRAME_SAMPLES = 1600;

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // `sampleRate` is a global in AudioWorkletGlobalScope.
    this.ratio = sampleRate / TARGET_RATE;
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
    this.sumSquares = 0;
    // Fractional read position carried across render quanta (128 samples each).
    this.position = 0;
    this.carry = new Float32Array(0);
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    // Join leftover input with the new block, then box-filter downsample:
    // each output sample is the mean of the input samples it covers (cheap anti-aliasing).
    const input = new Float32Array(this.carry.length + channel.length);
    input.set(this.carry, 0);
    input.set(channel, this.carry.length);

    let pos = this.position;
    while (pos + this.ratio <= input.length) {
      const start = Math.floor(pos);
      const end = Math.min(input.length, Math.floor(pos + this.ratio));
      let sum = 0;
      for (let i = start; i < end; i++) sum += input[i];
      const value = end > start ? sum / (end - start) : input[start];
      this.push(value);
      pos += this.ratio;
    }

    const consumed = Math.floor(pos);
    this.carry = input.slice(consumed);
    this.position = pos - consumed;
    return true;
  }

  push(value) {
    const clamped = Math.max(-1, Math.min(1, value));
    this.frame[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    this.sumSquares += clamped * clamped;
    if (this.filled === FRAME_SAMPLES) {
      const pcm = this.frame.buffer.slice(0);
      const level = Math.sqrt(this.sumSquares / FRAME_SAMPLES);
      this.port.postMessage({ pcm, level }, [pcm]);
      this.filled = 0;
      this.sumSquares = 0;
    }
  }
}

registerProcessor('pcm-processor', PcmProcessor);
