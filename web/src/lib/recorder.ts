/**
 * Microphone capture → 16 kHz PCM16 frames (via public/pcm-processor.js).
 */

export interface RecorderCallbacks {
  onFrame: (pcm: ArrayBuffer) => void;
  onLevel: (level: number) => void;
}

export class MicPermissionError extends Error {}

export class MicRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;

  async start({ onFrame, onLevel }: RecorderCallbacks): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicPermissionError(
        'This browser cannot record audio here. Use a recent Chrome, Edge, Firefox or Safari over HTTPS.',
      );
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new MicPermissionError(
          'Microphone access was blocked. Allow it from the address bar and try again.',
        );
      }
      if (name === 'NotFoundError') throw new MicPermissionError('No microphone was found.');
      throw new MicPermissionError('Could not open the microphone.');
    }

    this.context = new AudioContext();
    await this.context.audioWorklet.addModule('/pcm-processor.js');
    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'pcm-processor');
    this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
      onFrame(e.data.pcm);
      onLevel(e.data.level);
    };
    // Route through a muted gain so the graph is pulled without echoing the mic.
    const mute = this.context.createGain();
    mute.gain.value = 0;
    source.connect(this.node).connect(mute).connect(this.context.destination);
    if (this.context.state === 'suspended') await this.context.resume();
  }

  async stop(): Promise<void> {
    if (this.node) this.node.port.onmessage = null;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.context?.close().catch(() => undefined);
    this.node = null;
    this.stream = null;
    this.context = null;
  }
}
