export class AudioQueue {
  private chunks: ArrayBuffer[] = [];
  private playing = false;
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private stopped = false;
  private onStateChange?: (playing: boolean) => void;

  constructor(onStateChange?: (playing: boolean) => void) {
    this.onStateChange = onStateChange;
  }

  enqueue(chunk: ArrayBuffer): void {
    if (this.stopped) return;
    this.chunks.push(chunk);
    if (!this.playing) {
      void this.playNext();
    }
  }

  private async playNext(): Promise<void> {
    if (this.stopped || this.chunks.length === 0) {
      this.playing = false;
      this.onStateChange?.(false);
      return;
    }

    this.playing = true;
    this.onStateChange?.(true);

    if (!this.context) {
      this.context = new AudioContext({ sampleRate: 48000 });
    }

    const chunk = this.chunks.shift()!;
    try {
      const audioBuffer = await this.context.decodeAudioData(chunk.slice(0));
      if (this.stopped) return;

      this.source = this.context.createBufferSource();
      this.source.buffer = audioBuffer;
      this.source.connect(this.context.destination);

      await new Promise<void>((resolve) => {
        if (!this.source) {
          resolve();
          return;
        }
        this.source.onended = () => resolve();
        this.source.start();
      });

      this.source = null;
      void this.playNext();
    } catch {
      // Skip malformed chunks
      void this.playNext();
    }
  }

  stop(): void {
    this.stopped = true;
    this.chunks = [];

    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // Already stopped
      }
      this.source = null;
    }

    if (this.context) {
      this.context.close().catch(() => {});
      this.context = null;
    }

    this.playing = false;
    this.onStateChange?.(false);
  }

  clear(): void {
    this.chunks = [];
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isEmpty(): boolean {
    return this.chunks.length === 0;
  }
}
