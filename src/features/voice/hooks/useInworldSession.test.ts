import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInworldSession } from "./useInworldSession";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// A controllable WebSocket stub. Tests call `ws.__fireMessage({ type: ... })`
// to simulate Inworld server messages and `ws.__fireOpen()` for connection.
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
  sent: any[] = [];
  private listeners: Map<string, Set<(ev: any) => void>> = new Map();

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  addEventListener(type: string, listener: (ev: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (ev: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  // Test helpers
  __fireOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  __fireMessage(data: any) {
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
  onaudioprocess: ((e: any) => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeMediaStreamSource {
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
  createScriptProcessor = vi.fn(
    () => new FakeScriptProcessor() as unknown as ScriptProcessorNode,
  );
  createMediaStreamSource = vi.fn(
    () => new FakeMediaStreamSource() as unknown as MediaStreamAudioSourceNode,
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
  return {
    getTracks: () => [{ stop: vi.fn(), kind: "audio" }],
  } as unknown as MediaStream;
}

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
// Helper: connect the transport and wait for the WebSocket to be created.
// connect() awaits getVoiceConnection() before `new WebSocket()`, so we must
// flush microtasks before the instance appears in MockWebSocket.instances.
// ---------------------------------------------------------------------------
async function connectAndWait(
  result: { current: ReturnType<typeof useInworldSession> },
): Promise<MockWebSocket> {
  const connectPromise = result.current.connect();
  // Flush microtasks so getVoiceConnection() resolves and `new WebSocket()` runs
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
  // connect() now waits for session.updated before resolving (race condition
  // fix: previously resolved on ws.onopen only, causing speakText to send
  // conversation.item.create before the session was configured on fast
  // desktop connections).
  act(() => ws.__fireOpen());
  act(() => ws.__fireMessage({ type: "session.created" }));
  act(() => ws.__fireMessage({ type: "session.updated" }));
  await act(async () => {
    await connectPromise;
  });
  return ws;
}

describe("useInworldSession — TTS state machine", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
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
    process.env.NEXT_PUBLIC_VOICE_WS_URL = "ws://localhost:4002/voice";
    useVoiceStore.getState().reset();
    useVoiceStore.setState({ activeAgent: "litt" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_VOICE_WS_URL;
  });

  // ---------------------------------------------------------------------------
  // STT-ONLY MODE: Inworld is used for speech-to-text only. Agent audio is
  // dropped — TTS is handled by browser speechSynthesis in VoiceSessionContext,
  // which reads the EXACT stored chat message verbatim. These tests verify
  // that agent audio does NOT trigger playback state.
  // ---------------------------------------------------------------------------
  it("drops agent audio in STT-only mode (no playback state transition)", async () => {
    const onAgentText = vi.fn();
    const { result } = renderHook(() =>
      useInworldSession({ onAgentText }),
    );

    const ws = await connectAndWait(result);

    // Simulate Inworld session.created -> hook sends session.update
    act(() => ws.__fireMessage({ type: "session.created" }));
    expect(ws.sent.some((m) => m.type === "session.update")).toBe(true);

    // User starts speaking
    act(() => ws.__fireMessage({ type: "input_audio_buffer.speech_started" }));
    expect(useVoiceStore.getState().state).toBe("listening");

    // User stops speaking
    act(() => ws.__fireMessage({ type: "input_audio_buffer.speech_stopped" }));

    // Agent response begins
    act(() => ws.__fireMessage({ type: "response.created" }));

    // Agent audio chunk arrives — MUST be dropped (STT-only mode).
    // State should NOT transition to "speaking".
    act(() =>
      ws.__fireMessage({
        type: "response.output_audio.delta",
        delta: btoa("hello audio"),
      }),
    );

    // State stays "listening" (or idle) — NOT "speaking"
    expect(useVoiceStore.getState().state).not.toBe("speaking");

    // Agent response finishes
    act(() => ws.__fireMessage({ type: "response.done" }));
  });

  it("drops agent audio on barge-in in STT-only mode (no playback)", async () => {
    const { result } = renderHook(() => useInworldSession({}));
    const ws = await connectAndWait(result);

    act(() => ws.__fireMessage({ type: "session.created" }));
    // Agent starts speaking
    act(() => ws.__fireMessage({ type: "response.created" }));
    act(() =>
      ws.__fireMessage({
        type: "response.output_audio.delta",
        delta: btoa("chunk1"),
      }),
    );
    // STT-only mode: state should NOT be "speaking"
    expect(useVoiceStore.getState().state).not.toBe("speaking");

    // User interrupts via interrupt()
    act(() => result.current.interrupt());
    expect(ws.sent.some((m) => m.type === "response.cancel")).toBe(true);

    // Subsequent audio chunks are still dropped
    act(() =>
      ws.__fireMessage({
        type: "response.output_audio.delta",
        delta: btoa("chunk2-late"),
      }),
    );
    // State should NOT be "speaking" in STT-only mode
    expect(useVoiceStore.getState().state).not.toBe("speaking");

    // response.cancelled arrives
    act(() => ws.__fireMessage({ type: "response.cancelled" }));

    // A new response starts — audio still dropped
    act(() => ws.__fireMessage({ type: "response.created" }));
    act(() =>
      ws.__fireMessage({
        type: "response.output_audio.delta",
        delta: btoa("chunk3-new"),
      }),
    );
    // STT-only mode: state should NOT be "speaking"
    expect(useVoiceStore.getState().state).not.toBe("speaking");
  });

  it("speakText sends conversation.item.create + response.create", async () => {
    const { result } = renderHook(() => useInworldSession({}));
    const ws = await connectAndWait(result);

    // speakText waits for response.done per chunk. Capture the sent messages
    // and state BEFORE firing response.done (which resets state to idle).
    let types: string[] = [];
    let stateBeforeDone = "";
    const speakPromise = act(async () => {
      const p = result.current.speakText("Hello, world.");
      // Give the hook a tick to send the messages
      await Promise.resolve();
      await Promise.resolve();
      types = ws.sent.map((m) => m.type);
      stateBeforeDone = useVoiceStore.getState().state;
      // Now fire response.done so the promise resolves
      ws.__fireMessage({ type: "response.done" });
      await p;
    });
    await speakPromise;

    expect(types).toContain("conversation.item.create");
    expect(types).toContain("response.create");
    expect(stateBeforeDone).toBe("speaking");
  });

  it("speakText with empty/whitespace text is a no-op", async () => {
    const { result } = renderHook(() => useInworldSession({}));
    const ws = await connectAndWait(result);
    const sentBefore = ws.sent.length;
    await act(async () => {
      await result.current.speakText("   ");
    });
    expect(ws.sent.length).toBe(sentBefore);
  });

  it("errors from the server set state to 'error' and call onError", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useInworldSession({ onError }));
    const ws = await connectAndWait(result);

    act(() =>
      ws.__fireMessage({ type: "error", message: "Inworld rate limited" }),
    );
    expect(useVoiceStore.getState().state).toBe("error");
    expect(useVoiceStore.getState().error).toContain("Inworld rate limited");
    expect(onError).toHaveBeenCalledWith("Inworld rate limited");
  });

  it("disconnect closes the WebSocket and resets state to idle", async () => {
    const { result } = renderHook(() => useInworldSession({}));
    await connectAndWait(result);
    expect(result.current.isConnected).toBe(true);

    act(() => result.current.disconnect());
    expect(useVoiceStore.getState().state).toBe("idle");
  });

  it("startMicrophone throws if the transport is not connected", async () => {
    const { result } = renderHook(() => useInworldSession({}));
    await expect(
      act(async () => {
        await result.current.startMicrophone();
      }),
    ).rejects.toThrow(/not active/i);
  });

  it("transcript events update the store and call onTranscript", async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() =>
      useInworldSession({ onTranscript }),
    );
    const ws = await connectAndWait(result);

    act(() =>
      ws.__fireMessage({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "hello LiTT",
      }),
    );
    expect(useVoiceStore.getState().transcript).toBe("hello LiTT");
    expect(onTranscript).toHaveBeenCalledWith("hello LiTT", true);
  });
});
