import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AudioQueue } from "./audioQueue";

// jsdom doesn't ship a real AudioContext. We stub the handful of methods the
// AudioQueue uses so we can verify queueing / stop / state semantics without
// a browser.
class FakeAudioBufferSourceNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  start = vi.fn(() => {
    // Fire onended asynchronously so callers can await
    setTimeout(() => this.onended?.(), 0);
  });
  stop = vi.fn();
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = "running";
  sampleRate: number;
  constructor(opts: { sampleRate?: number } = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
  }
  decodeAudioData = vi.fn(async (buf: ArrayBuffer) => ({
    duration: 0.1,
    sampleRate: this.sampleRate,
    numberOfChannels: 1,
    length: 100,
    getChannelData: () => new Float32Array(100),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  }) as unknown as AudioBuffer);
  createBufferSource = vi.fn(() => new FakeAudioBufferSourceNode() as unknown as AudioBufferSourceNode);
  close = vi.fn(async () => {});
  resume = vi.fn(async () => {});
}

describe("AudioQueue", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts in a non-playing, empty state", () => {
    const q = new AudioQueue();
    expect(q.isPlaying).toBe(false);
    expect(q.isEmpty).toBe(true);
  });

  it("reports onStateChange(true) when playback starts", async () => {
    const onState = vi.fn();
    const q = new AudioQueue(onState);
    q.enqueue(new ArrayBuffer(8));
    await new Promise((r) => setTimeout(r, 10));
    expect(onState).toHaveBeenCalledWith(true);
  });

  it("reports onStateChange(false) when queue drains", async () => {
    const onState = vi.fn();
    const q = new AudioQueue(onState);
    q.enqueue(new ArrayBuffer(8));
    await new Promise((r) => setTimeout(r, 20));
    expect(onState).toHaveBeenCalledWith(false);
  });

  it("stop() halts playback and closes the AudioContext", async () => {
    const q = new AudioQueue();
    q.enqueue(new ArrayBuffer(8));
    await new Promise((r) => setTimeout(r, 5));
    q.stop();
    expect(q.isPlaying).toBe(false);
    // After stop, enqueuing more does nothing
    q.enqueue(new ArrayBuffer(8));
    expect(q.isEmpty).toBe(true);
  });

  it("clear() empties the queue without stopping the context", () => {
    const q = new AudioQueue();
    q.enqueue(new ArrayBuffer(8));
    q.enqueue(new ArrayBuffer(8));
    expect(q.isEmpty).toBe(false);
    q.clear();
    expect(q.isEmpty).toBe(true);
  });

  it("enqueue after stop() is a no-op", () => {
    const q = new AudioQueue();
    q.stop();
    q.enqueue(new ArrayBuffer(8));
    expect(q.isEmpty).toBe(true);
    expect(q.isPlaying).toBe(false);
  });
});
