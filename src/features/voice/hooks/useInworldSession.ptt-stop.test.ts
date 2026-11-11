import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInworldSession } from "./useInworldSession";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";

/**
 * Regression tests for the push-to-talk Stop path (2026-11-10):
 * Larry's production report — "I say something, I hit Stop, nothing happens."
 *
 * The VAD is mocked with a controllable detector that honors the REAL
 * VoiceActivityDetector contract (voice-vad.ts):
 *  - stop() fires onSpeechEnd(totalSpeechMs) when speech was in progress.
 *  - destroy() calls stop() first, then marks itself destroyed.
 * These tests pin what stopListening() sends on the wire around that
 * contract: exactly one commit for an utterance, and no commit at all
 * when no audio was ever captured.
 */

// ---------------------------------------------------------------------------
// Controllable VAD double
// ---------------------------------------------------------------------------

interface FakeVadCallbacks {
  onSpeechStart?: () => void;
  onSpeechEnd?: (durationMs: number) => void;
  onStateChange?: (state: string) => void;
  onLevel?: (rms: number) => void;
}

interface FakeVadInstance {
  state: string;
  totalSpeechMs: number;
  destroyed: boolean;
  callbacks: FakeVadCallbacks;
  start(): void;
  stop(): void;
  destroy(): void;
  getState(): string;
  getSpeechDurationMs(): number;
  __speak(durationMs: number): void;
  __endBySilence(): void;
}

const vadRegistry = vi.hoisted(() => ({ instances: [] as FakeVadInstance[] }));

vi.mock("@/features/voice/lib/voice-vad", () => {
  class FakeVoiceActivityDetector implements FakeVadInstance {
    state = "idle";
    totalSpeechMs = 0;
    destroyed = false;
    constructor(
      public analyser: unknown,
      public callbacks: FakeVadCallbacks = {},
    ) {
      vadRegistry.instances.push(this);
    }
    start() {
      this.state = "listening";
      this.callbacks.onStateChange?.(this.state);
    }
    stop() {
      if (this.state === "speech_detected" && this.totalSpeechMs > 0) {
        this.callbacks.onSpeechEnd?.(this.totalSpeechMs);
      }
      this.state = "idle";
    }
    destroy() {
      this.stop();
      this.destroyed = true;
    }
    getState() {
      return this.state;
    }
    getSpeechDurationMs() {
      return this.totalSpeechMs;
    }
    /** Test helper: enter speech_detected with the given accumulated duration. */
    __speak(durationMs: number) {
      this.state = "speech_detected";
      this.totalSpeechMs = durationMs;
      this.callbacks.onSpeechStart?.();
      this.callbacks.onStateChange?.(this.state);
    }
    /** Test helper: the silence-endpoint path — fires onSpeechEnd and resets. */
    __endBySilence() {
      if (this.state === "speech_detected" && this.totalSpeechMs > 0) {
        this.callbacks.onSpeechEnd?.(this.totalSpeechMs);
      }
      this.totalSpeechMs = 0;
      this.state = "listening";
    }
  }
  return { VoiceActivityDetector: FakeVoiceActivityDetector };
});

vi.mock("@/lib/voice-client", () => ({
  getVoiceConnection: vi.fn(async () => ({
    token: "test-token",
    expiresAt: Date.now() + 120000,
    endpoint: "ws://localhost:4002/voice",
    littVoice: "litt-voice-id",
    sparkVoice: "spark-voice-id",
  })),
}));

// ---------------------------------------------------------------------------
// WebSocket + WebAudio doubles (mirrors useInworldSession.test.ts, plus
// createGain which the mic-capture graph requires)
// ---------------------------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Array<Record<string, unknown>> = [];
  private listeners: Map<string, Set<(ev: { data: string }) => void>> = new Map();

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
  addEventListener(type: string, listener: (ev: { data: string }) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (ev: { data: string }) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  __fireOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  __fireMessage(data: unknown) {
    const ev = { data: JSON.stringify(data) };
    this.onmessage?.(ev);
    this.listeners.get("message")?.forEach((fn) => fn(ev));
  }
  __fireClose(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

class FakeAnalyser {
  fftSize = 512;
  frequencyBinCount = 256;
  smoothingTimeConstant = 0.5;
  getByteTimeDomainData = vi.fn();
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeScriptProcessor {
  onaudioprocess: ((e: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = "running";
  sampleRate: number;
  currentTime = 0;
  destination = {} as AudioNode;
  constructor(opts: { sampleRate?: number } = {}) {
    this.sampleRate = opts.sampleRate ?? 24000;
  }
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  createAnalyser = vi.fn(() => new FakeAnalyser() as unknown as AnalyserNode);
  createScriptProcessor = vi.fn(() => new FakeScriptProcessor() as unknown as ScriptProcessorNode);
  createMediaStreamSource = vi.fn(
    () => ({ connect: vi.fn(), disconnect: vi.fn() }) as unknown as MediaStreamAudioSourceNode,
  );
  createGain = vi.fn(
    () =>
      ({
        gain: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
        context: null,
      }) as unknown as GainNode,
  );
  createBuffer = vi.fn(
    (channels: number, length: number, rate: number) =>
      ({
        duration: length / rate,
        sampleRate: rate,
        numberOfChannels: channels,
        length,
        copyToChannel: vi.fn(),
        getChannelData: () => new Float32Array(length),
      }) as unknown as AudioBuffer,
  );
  createBufferSource = vi.fn(() => {
    const src = {
      buffer: null as AudioBuffer | null,
      onended: null as (() => void) | null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    return src as unknown as AudioBufferSourceNode;
  });
}

function makeMockStream() {
  const track = { stop: vi.fn(), kind: "audio", enabled: true };
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

async function connectAndWait(
  result: { current: ReturnType<typeof useInworldSession> },
): Promise<MockWebSocket> {
  const connectPromise = result.current.connect();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
  act(() => ws.__fireOpen());
  act(() => ws.__fireMessage({ type: "session.created" }));
  act(() => ws.__fireMessage({ type: "session.updated" }));
  await act(async () => {
    await connectPromise;
  });
  return ws;
}

function commitsSent(ws: MockWebSocket): number {
  return ws.sent.filter((m) => m.type === "input_audio_buffer.commit").length;
}

describe("useInworldSession — push-to-talk Stop commit behavior", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vadRegistry.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal(
      "navigator",
      Object.defineProperty({}, "mediaDevices", {
        value: {
          getUserMedia: vi.fn(async () => makeMockStream()),
          enumerateDevices: vi.fn(async () => []),
        },
        configurable: true,
      }),
    );
    useVoiceStore.getState().reset();
    useVoiceStore.setState({ activeAgent: "litt" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends exactly ONE commit when Stop is pressed mid-speech", async () => {
    const { result } = renderHook(() => useInworldSession({}));
    const ws = await connectAndWait(result);

    await act(async () => {
      await result.current.startMicrophone();
    });
    const vad = vadRegistry.instances[vadRegistry.instances.length - 1]!;
    // Larry speaks for ~3s (VAD in speech_detected), then hits Stop before
    // the 1400ms end-of-speech silence elapses.
    act(() => vad.__speak(3000));

    act(() => result.current.stopListening());

    // Teardown fires VAD onSpeechEnd (one commit); stopListening must NOT
    // stack a second commit on the now-empty buffer.
    expect(commitsSent(ws)).toBe(1);
  });

  it("sends NO commit when Stop is pressed with no speech captured", async () => {
    const { result } = renderHook(() => useInworldSession({}));
    const ws = await connectAndWait(result);

    await act(async () => {
      await result.current.startMicrophone();
    });
    // VAD never detected speech (silent/wrong device, muted mixer) — the
    // buffer is empty, so a commit only produces a server error event.
    act(() => result.current.stopListening());

    expect(commitsSent(ws)).toBe(0);
  });

  it("does not re-commit at Stop when the VAD already endpointed the utterance", async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useInworldSession({ onTranscript }));
    const ws = await connectAndWait(result);

    await act(async () => {
      await result.current.startMicrophone();
    });
    const vad = vadRegistry.instances[vadRegistry.instances.length - 1]!;
    act(() => vad.__speak(2000));
    // Utterance endpoints via the silence path while still holding the mic.
    act(() => vad.__endBySilence());
    expect(commitsSent(ws)).toBe(1);

    // The finalized transcript still reaches the consumer stamped with the
    // VAD-measured speech duration.
    act(() =>
      ws.__fireMessage({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "build me a landing page",
      }),
    );
    expect(onTranscript).toHaveBeenCalledWith(
      "build me a landing page",
      true,
      expect.objectContaining({ speechDurationMs: 2000 }),
    );

    // Pressing Stop afterwards must not commit the (empty) buffer again.
    act(() => result.current.stopListening());
    expect(commitsSent(ws)).toBe(1);
  });
});
