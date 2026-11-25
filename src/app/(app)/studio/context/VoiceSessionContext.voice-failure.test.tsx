import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import { createInitialTimingMetrics } from "@/features/voice/types";
import { voiceFailureError } from "@/features/voice/lib/voice-failure";

/**
 * Mobile voice failure scenarios (Larry's Android Chrome report: tapping
 * the Studio mic failed silently). These pin the session-state contract
 * the composer renders from:
 *
 *  2. Permission denial lands in the dedicated permission_denied state
 *     carrying the exact recovery message — not the generic error state.
 *  3. Permission recovery: after a denial, the next tap (permission now
 *     granted) reaches listening on the SAME mounted session — no page
 *     reload, no wedged guard.
 *  4. A transport/transcription failure surfaces an honest message —
 *     never silence, never a fabricated transcript.
 *  5. Repeated start/stop cycles — including a stop that captured no
 *     speech — never wedge the state machine or stack stale errors.
 */

type TranscriptOptions = {
  onTranscript?: (text: string, final: boolean, metadata?: { speechDurationMs?: number }) => void;
  onError?: (msg: string) => void;
};

const mocks = vi.hoisted(() => {
  const holder: { options: TranscriptOptions | null } = { options: null };
  const inworld = {
    speakText: vi.fn(async () => {}),
    pauseMic: vi.fn(),
    resumeMic: vi.fn(),
    startListening: vi.fn(async () => {}),
    stopListening: vi.fn(),
    disconnect: vi.fn(),
    interrupt: vi.fn(),
    connect: vi.fn(async () => {}),
    startMicrophone: vi.fn(async () => {}),
    triggerResponse: vi.fn(),
    isMicPaused: vi.fn(() => false),
    getVadState: vi.fn((): string => "idle"),
    getLastSpeechDurationMs: vi.fn(() => 0),
    getPeakLevel: vi.fn(() => 0),
    didLastTtsPlayAudio: vi.fn(() => false),
    isConnected: true,
    isListening: false,
    error: null as string | null,
  };
  const state = {
    activeAgent: "litt",
    audioLevel: 0,
    setTiming: vi.fn(),
    timing: null as unknown,
  };
  const useVoiceStore = (sel?: (s: typeof state) => unknown) =>
    sel ? sel(state) : state;
  (useVoiceStore as { getState?: () => typeof state }).getState = () => state;
  return { holder, inworld, state, useVoiceStore };
});

vi.mock("@/features/voice/hooks/useInworldSession", () => ({
  useInworldSession: (options: TranscriptOptions) => {
    mocks.holder.options = options;
    return mocks.inworld;
  },
}));

vi.mock("@/features/voice/store/useVoiceStore", () => ({
  useVoiceStore: mocks.useVoiceStore,
}));

import { VoiceSessionProvider, useVoiceSession, type VoiceSessionCtx } from "./VoiceSessionContext";

function stubNavigator(withMic: boolean) {
  vi.stubGlobal(
    "navigator",
    Object.defineProperty({}, "mediaDevices", {
      value: withMic
        ? {
            getUserMedia: vi.fn(async () => ({
              getTracks: () => [],
              getAudioTracks: () => [],
            })),
            enumerateDevices: vi.fn(async () => []),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }
        : {
            // No getUserMedia at all — the unsupported-browser shape.
            enumerateDevices: vi.fn(async () => []),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          },
      configurable: true,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.holder.options = null;
  mocks.state.timing = createInitialTimingMetrics();
  mocks.inworld.getLastSpeechDurationMs.mockReturnValue(0);
  mocks.inworld.getVadState.mockReturnValue("idle");
  mocks.inworld.getPeakLevel.mockReturnValue(0);
  mocks.inworld.startListening.mockImplementation(async () => {});
  stubNavigator(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mountSession() {
  let session: VoiceSessionCtx | null = null;
  function Probe() {
    session = useVoiceSession();
    return null;
  }
  render(
    <VoiceSessionProvider>
      <Probe />
    </VoiceSessionProvider>,
  );
  return () => session!;
}

describe("scenario 2 — permission denial is a named state with the recovery message", () => {
  it("lands in permission_denied (not generic error) with the Android Chrome recovery steps", async () => {
    mocks.inworld.startListening.mockRejectedValueOnce(
      voiceFailureError("permission_denied"),
    );
    const getSession = mountSession();

    await act(async () => {
      await getSession().startVoice();
    });

    expect(getSession().voiceState).toBe("permission_denied");
    expect(getSession().errorMessage).toMatch(/Microphone permission denied/);
    expect(getSession().errorMessage).toMatch(/address bar/);
    expect(getSession().errorMessage).toMatch(/Permissions/);
    expect(getSession().errorMessage).toMatch(/reload the page/);
  });

  it("a raw NotAllowedError from the transport also lands in permission_denied", async () => {
    mocks.inworld.startListening.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    const getSession = mountSession();

    await act(async () => {
      await getSession().startVoice();
    });

    expect(getSession().voiceState).toBe("permission_denied");
    expect(getSession().errorMessage).toMatch(/address bar/);
  });
});

describe("scenario 3 — permission recovery without a page reload", () => {
  it("denial then grant: the next tap on the same session reaches listening and clears the error", async () => {
    mocks.inworld.startListening.mockRejectedValueOnce(
      voiceFailureError("permission_denied"),
    );
    const getSession = mountSession();

    await act(async () => {
      await getSession().startVoice();
    });
    expect(getSession().voiceState).toBe("permission_denied");

    // The user follows the message (site permission → Allow) and taps
    // the mic again. No remount, no reload: the same provider instance
    // must accept the start — the state guard must treat
    // permission_denied as startable.
    await act(async () => {
      await getSession().startVoice();
    });

    expect(getSession().voiceState).toBe("listening");
    expect(getSession().errorMessage).toBeNull();
  });
});

describe("scenario 4 — transport/transcription failure is honest, never silent, never fake", () => {
  it("a connect timeout surfaces the check-your-connection message in the error state", async () => {
    mocks.inworld.startListening.mockRejectedValueOnce(
      new Error("Voice connection timed out. Please try again."),
    );
    const getSession = mountSession();

    await act(async () => {
      await getSession().startVoice();
    });

    expect(getSession().voiceState).toBe("error");
    expect(getSession().errorMessage).toMatch(/took too long/i);
    expect(getSession().errorMessage).toMatch(/connection/i);
  });

  it("a mid-session transcription error reaches the user verbatim and writes nothing to the composer", async () => {
    const getSession = mountSession();
    const composer = vi.fn();
    act(() => {
      getSession().setOnTranscriptComplete(composer);
    });
    await act(async () => {
      await getSession().startVoice();
    });
    expect(getSession().voiceState).toBe("listening");

    act(() => {
      mocks.holder.options?.onError?.("Inworld transcription failed");
    });

    expect(getSession().voiceState).toBe("error");
    expect(getSession().errorMessage).toMatch(/transcription failed/i);
    // No fabricated transcript was delivered anywhere.
    expect(composer).not.toHaveBeenCalled();
  });
});

describe("scenario 5 — repeated cycles never wedge", () => {
  it("start → stop-with-no-speech → start → transcript → start: state stays live and errors don't stack", async () => {
    const getSession = mountSession();
    const composer = vi.fn();
    act(() => {
      getSession().setOnTranscriptComplete(composer);
    });

    // Cycle 1: record, stop with nothing heard.
    await act(async () => {
      await getSession().startVoice();
    });
    expect(getSession().voiceState).toBe("listening");

    vi.useFakeTimers();
    act(() => {
      getSession().stopVoice();
    });
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(getSession().voiceState).toBe("idle");
    expect(getSession().errorMessage).toMatch(/didn't hear/i);
    vi.useRealTimers();

    // Cycle 2: the didn't-hear notice must not wedge or carry over —
    // a fresh start clears it and reaches listening.
    await act(async () => {
      await getSession().startVoice();
    });
    expect(getSession().voiceState).toBe("listening");
    expect(getSession().errorMessage).toBeNull();

    // Real speech this time: push-to-talk stop, then the transcript the
    // STT wait was holding for lands in the composer (speechDurationMs 0
    // is the proven PTT-stop delivery shape — see the transcript-delivery
    // suite).
    act(() => {
      getSession().stopVoice();
    });
    act(() => {
      mocks.holder.options?.onTranscript?.("build me a bakery site", true, {
        speechDurationMs: 0,
      });
    });
    expect(composer).toHaveBeenCalledWith("build me a bakery site");
    expect(getSession().voiceState).toBe("idle");

    // Cycle 3: still startable after a completed turn.
    await act(async () => {
      await getSession().startVoice();
    });
    expect(getSession().voiceState).toBe("listening");
    expect(getSession().errorMessage).toBeNull();
  });

  it("two failures in a row leave the latest message, and a later success still starts", async () => {
    mocks.inworld.startListening
      .mockRejectedValueOnce(voiceFailureError("permission_denied"))
      .mockRejectedValueOnce(new Error("Voice connection failed. Please try again."));
    const getSession = mountSession();

    await act(async () => {
      await getSession().startVoice();
    });
    expect(getSession().voiceState).toBe("permission_denied");

    await act(async () => {
      await getSession().startVoice();
    });
    expect(getSession().voiceState).toBe("error");
    expect(getSession().errorMessage).toMatch(/couldn't be reached/i);

    await act(async () => {
      await getSession().startVoice();
    });
    expect(getSession().voiceState).toBe("listening");
    expect(getSession().errorMessage).toBeNull();
  });
});

describe("unsupported browser — the dedicated state is reachable", () => {
  it("no getUserMedia → unsupported state with the try-another-browser message", async () => {
    stubNavigator(false);
    const getSession = mountSession();

    await act(async () => {
      await getSession().startVoice();
    });

    expect(getSession().voiceState).toBe("unsupported");
    expect(getSession().errorMessage).toMatch(/isn't supported/i);
    expect(mocks.inworld.startListening).not.toHaveBeenCalled();
  });
});

describe("mic tap while a transcript waits — never a silent dead button", () => {
  it("sets a visible notice instead of swallowing the tap", async () => {
    const getSession = mountSession();
    // No setOnTranscriptComplete: push-to-talk stop, then a
    // content-bearing transcript that the VAD-duration gate rejects
    // falls back to the transcript_ready draft.
    await act(async () => {
      await getSession().startVoice();
    });
    act(() => {
      getSession().stopVoice();
    });
    act(() => {
      mocks.holder.options?.onTranscript?.("a real sentence here", true, {
        speechDurationMs: 0,
      });
    });
    expect(getSession().voiceState).toBe("transcript_ready");

    await act(async () => {
      await getSession().startVoice();
    });

    // The tap must not vanish: a notice explains why recording didn't
    // restart, and the waiting transcript is left untouched.
    expect(getSession().errorMessage).toMatch(/transcript/i);
    expect(getSession().voiceState).toBe("transcript_ready");
  });
});
