import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInworldSession } from "./useInworldSession";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { getVoiceConnection } from "@/lib/voice-client";

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

  // Test helpers
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

function stubVoiceConn(secretFp?: string) {
  const conn = {
    token: "test-token",
    expiresAt: Date.now() + 120000,
    endpoint: "ws://localhost:4002/voice",
    littVoice: "litt-voice-id",
    sparkVoice: "spark-voice-id",
    secretFp,
  };
  // connect() calls getVoiceConnection() then getVoiceConnection(true) — one
  // stubbed value per call, then the default mock factory resumes.
  vi.mocked(getVoiceConnection).mockResolvedValueOnce(conn).mockResolvedValueOnce(conn);
}

function stubVoiceHealth(authSecretFp: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      expect(url).toBe("http://localhost:4002/health");
      return {
        ok: true,
        json: async () => (authSecretFp === null ? {} : { authSecretFp }),
      };
    }),
  );
}

// Drives connect() through two consecutive pre-session 4001 closes and
// returns the thrown error.
async function doubleClose4001(
  firstReason = "Invalid or expired token",
  secondReason = "Invalid or expired token",
): Promise<Error> {
  const { result } = renderHook(() => useInworldSession({}));
  const connectPromise = result.current.connect();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const firstWs = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
  act(() => firstWs.__fireClose(4001, firstReason));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const secondWs = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
  act(() => secondWs.__fireClose(4001, secondReason));
  let caught: unknown = null;
  await act(async () => {
    try {
      await connectPromise;
    } catch (e) {
      caught = e;
    }
  });
  return caught as Error;
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

    // User starts speaking — server-side VAD is disabled, so this is a no-op.
    // Client-side VAD controls the flow now.
    act(() => ws.__fireMessage({ type: "input_audio_buffer.speech_started" }));
    // State should NOT change from server-side VAD event
    // (it stays in whatever state it was — "connecting" from the connect flow)

    // User stops speaking — audio buffer committed by client-side VAD
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
      types = ws.sent.map((m) => m.type as string);
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

  it("speakText prepends the TTS-2 style steering tag to the spoken text", async () => {
    const { result } = renderHook(() => useInworldSession({}));
    const ws = await connectAndWait(result);

    const speakPromise = act(async () => {
      const p = result.current.speakText("Hello, world.");
      await Promise.resolve();
      await Promise.resolve();
      const itemCreate = ws.sent.find((m) => m.type === "conversation.item.create") as {
        item: { content: Array<{ text: string }> };
      };
      const spoken = itemCreate.item.content[0].text;
      expect(spoken.startsWith("[deep, calm")).toBe(true);
      expect(spoken).toContain("Hello, world.");
      ws.__fireMessage({ type: "response.done" });
      await p;
    });
    await speakPromise;
  });

  it("speakText sends a single response.create for short text (no chunk stitching)", async () => {
    const { result } = renderHook(() => useInworldSession({}));
    const ws = await connectAndWait(result);

    const speakPromise = act(async () => {
      const p = result.current.speakText("Short spoken summary.");
      await Promise.resolve();
      await Promise.resolve();
      const responseCreates = ws.sent.filter((m) => m.type === "response.create");
      expect(responseCreates).toHaveLength(1);
      ws.__fireMessage({ type: "response.done" });
      await p;
    });
    await speakPromise;
  });

  it("didLastTtsPlayAudio is false when no audio was played", async () => {
    const { result } = renderHook(() => useInworldSession({}));
    const ws = await connectAndWait(result);

    expect(result.current.didLastTtsPlayAudio()).toBe(false);
    const speakPromise = act(async () => {
      const p = result.current.speakText("Hello, world.");
      await Promise.resolve();
      await Promise.resolve();
      ws.__fireMessage({ type: "response.done" });
      await p;
    });
    await speakPromise;
    expect(result.current.didLastTtsPlayAudio()).toBe(false);
  });

  it("didLastTtsPlayAudio is true after an audio delta arrives", async () => {
    const { result } = renderHook(() => useInworldSession({}));
    const ws = await connectAndWait(result);

    const speakPromise = act(async () => {
      const p = result.current.speakText("Hello, world.");
      await Promise.resolve();
      await Promise.resolve();
      expect(result.current.didLastTtsPlayAudio()).toBe(false);
      // Two silent PCM16 samples, base64-encoded
      ws.__fireMessage({
        type: "response.output_audio.delta",
        delta: btoa("\x00\x00\x01\x00"),
      });
      await Promise.resolve();
      expect(result.current.didLastTtsPlayAudio()).toBe(true);
      ws.__fireMessage({ type: "response.done" });
      await p;
    });
    await speakPromise;
    expect(result.current.didLastTtsPlayAudio()).toBe(true);
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

  it("propagates microphone permission failures instead of reporting listening", async () => {
    const getUserMedia = navigator.mediaDevices.getUserMedia as unknown as {
      mockRejectedValueOnce: (error: unknown) => void;
    };
    getUserMedia.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));

    const { result } = renderHook(() => useInworldSession({}));
    await connectAndWait(result);

    await expect(
      act(async () => {
        await result.current.startMicrophone();
      }),
    ).rejects.toThrow(/microphone permission denied/i);

    expect(result.current.isListening).toBe(false);
    expect(useVoiceStore.getState().state).toBe("error");
    expect(useVoiceStore.getState().error).toContain("Microphone permission denied");
  });

  it("connect() retries exactly once with a force-refreshed credential on a 4001 close", async () => {
    vi.mocked(getVoiceConnection).mockClear();
    const { result } = renderHook(() => useInworldSession({}));

    const connectPromise = result.current.connect();
    // Flush microtasks so the first getVoiceConnection() resolves and the
    // first WebSocket is constructed.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const firstWs = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;

    // Proxy rejects the token pre-session with close code 4001.
    act(() => firstWs.__fireClose(4001, "auth failed"));

    // connect() should force-refresh the credential and open a second socket.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(MockWebSocket.instances.length).toBe(2);
    const secondWs = MockWebSocket.instances[1]!;

    act(() => secondWs.__fireOpen());
    act(() => secondWs.__fireMessage({ type: "session.created" }));
    act(() => secondWs.__fireMessage({ type: "session.updated" }));
    await act(async () => {
      await connectPromise;
    });

    expect(result.current.isConnected).toBe(true);
    expect(useVoiceStore.getState().state).not.toBe("error");
    expect(vi.mocked(getVoiceConnection).mock.calls).toEqual([[], [true]]);
  });

  it("connect() surfaces a real auth error when a second attempt also gets 4001", async () => {
    const { result } = renderHook(() => useInworldSession({}));

    const connectPromise = result.current.connect();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const firstWs = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    act(() => firstWs.__fireClose(4001, "auth failed"));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const secondWs = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    act(() => secondWs.__fireClose(4001, "auth failed again"));

    let caught: unknown = null;
    await act(async () => {
      try {
        await connectPromise;
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect(useVoiceStore.getState().state).toBe("error");
    expect(result.current.isConnected).toBe(false);
    // The thrown error must carry the surfaced diagnosis — VoiceSessionContext
    // displays the thrown message, so the raw transport error must not leak.
    expect((caught as Error).message).not.toContain(
      "Voice connection closed before session was ready",
    );
  });

  it("double-4001 with mismatched credential fingerprints names the Railway fix", async () => {
    stubVoiceConn("webfingerprint");
    stubVoiceHealth("proxyfingerprint");
    const err = await doubleClose4001();

    expect(err.message).toContain("different credentials");
    expect(err.message).toContain("VOICE_AUTH_SECRET");
    expect(err.message).toContain("localhost:4002");
    expect(err.message).toContain('The voice server said: "Invalid or expired token"');
    expect(err.message).not.toContain("Voice connection closed before session was ready");
    // The hook's surfaced error state matches the thrown message.
    expect(useVoiceStore.getState().error).toBe(err.message);
  });

  it("double-4001 with matching fingerprints suggests restarting the voice server", async () => {
    stubVoiceConn("samefingerprint");
    stubVoiceHealth("samefingerprint");
    const err = await doubleClose4001();

    expect(err.message).toContain("stale configuration");
    expect(err.message).toContain("restart the voice-server service");
  });

  it("double-4001 with an unreachable voice server names the outage", async () => {
    stubVoiceConn("webfingerprint");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const err = await doubleClose4001();

    expect(err.message).toContain("didn't answer its health check");
    expect(err.message).toContain("localhost:4002");
  });

  it("double-4001 without comparable fingerprints falls back to the generic auth message", async () => {
    stubVoiceConn("webfingerprint");
    stubVoiceHealth(null); // old proxy build predates authSecretFp
    const err = await doubleClose4001();

    expect(err.message).toContain("could not be verified");
    expect(err.message).toContain('The voice server said: "Invalid or expired token"');
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
    expect(onTranscript).toHaveBeenCalledWith("hello LiTT", true, expect.objectContaining({
      speechDurationMs: expect.any(Number),
    }));
  });
});
