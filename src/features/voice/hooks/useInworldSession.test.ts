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

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Test helpers
  __fireOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  __fireMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
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
  act(() => ws.__fireOpen());
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
  // CRITICAL REGRESSION TEST: the "TTS goes silent after first turn" bug.
  // Before the fix, `speech_started` set interruptedRef = true unconditionally
  // and nothing reset it before the agent's reply audio arrived — so every
  // response after the first user utterance was silently dropped.
  // ---------------------------------------------------------------------------
  it("plays agent audio AFTER speech_started (regression: TTS silent after first turn)", async () => {
    const onAgentText = vi.fn();
    const { result } = renderHook(() =>
      useInworldSession({ onAgentText }),
    );

    const ws = await connectAndWait(result);

    // Simulate Inworld session.created -> hook sends session.update
    act(() => ws.__fireMessage({ type: "session.created" }));
    expect(ws.sent.some((m) => m.type === "session.update")).toBe(true);

    // User starts speaking — the hook sets state to "listening".
    // Before the fix, this also set interruptedRef = true unconditionally,
    // which would drop the agent's reply audio.
    act(() => ws.__fireMessage({ type: "input_audio_buffer.speech_started" }));
    expect(useVoiceStore.getState().state).toBe("listening");

    // User stops speaking. interruptedRef must be cleared here so the
    // upcoming agent response audio is not dropped.
    act(() => ws.__fireMessage({ type: "input_audio_buffer.speech_stopped" }));

    // Agent response begins — response.created also clears interruptedRef
    act(() => ws.__fireMessage({ type: "response.created" }));

    // Agent audio chunk arrives — MUST be enqueued (not dropped).
    // The regression bug would have left interruptedRef = true, causing this
    // chunk to be silently dropped and state to stay "listening".
    act(() =>
      ws.__fireMessage({
        type: "response.output_audio.delta",
        delta: btoa("hello audio"),
      }),
    );

    // State MUST transition to "speaking" — proving audio was enqueued.
    expect(useVoiceStore.getState().state).toBe("speaking");

    // Agent response finishes
    act(() => ws.__fireMessage({ type: "response.done" }));
    expect(useVoiceStore.getState().state).toBe("idle");
  });

  it("drops agent audio when user barge-in interrupts a playing response", async () => {
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
    expect(useVoiceStore.getState().state).toBe("speaking");

    // User interrupts via interrupt()
    act(() => result.current.interrupt());
    expect(ws.sent.some((m) => m.type === "response.cancel")).toBe(true);

    // Subsequent audio chunks for the cancelled response MUST be dropped.
    // State should NOT transition back to "speaking" — it should stay
    // "interrupted" (set by interrupt()).
    act(() =>
      ws.__fireMessage({
        type: "response.output_audio.delta",
        delta: btoa("chunk2-late"),
      }),
    );
    expect(useVoiceStore.getState().state).toBe("interrupted");

    // response.cancelled arrives — resets interrupt for the NEXT response
    act(() => ws.__fireMessage({ type: "response.cancelled" }));
    expect(useVoiceStore.getState().state).toBe("idle");

    // A new response starts — audio should play again
    act(() => ws.__fireMessage({ type: "response.created" }));
    act(() =>
      ws.__fireMessage({
        type: "response.output_audio.delta",
        delta: btoa("chunk3-new"),
      }),
    );
    expect(useVoiceStore.getState().state).toBe("speaking");
  });

  it("speakText sends conversation.item.create + response.create", async () => {
    const { result } = renderHook(() => useInworldSession({}));
    const ws = await connectAndWait(result);

    await act(async () => {
      await result.current.speakText("Hello, world.");
    });

    const types = ws.sent.map((m) => m.type);
    expect(types).toContain("conversation.item.create");
    expect(types).toContain("response.create");
    expect(useVoiceStore.getState().state).toBe("speaking");
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
