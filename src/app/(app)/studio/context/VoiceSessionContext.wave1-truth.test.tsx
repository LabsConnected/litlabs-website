import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import { createInitialTimingMetrics } from "@/features/voice/types";
import { readAutoSendEnabled } from "@/features/voice/lib/voice-prefs";
import { VOICE_GATE_CONFIG } from "@/features/voice/lib/voice-gate-config";

/**
 * Wave-1 voice-truth regressions (full Studio audit 2026-11-10, Lane B):
 *
 *  B-01 — #882 silently reverted #880's auto-send default in the live
 *         session: with nothing stored, VoiceSessionContext defaulted
 *         auto-send OFF while voice-prefs/Settings default it ON
 *         (VOICE_GATE_CONFIG.ptt.autoSendDefault). Session, prefs, and
 *         Settings must agree; a stored pref always wins.
 *  B-02 — the "sending" state wedged forever when TTS was off or the
 *         turn handler failed: the only exit ran through speakText,
 *         which early-returns when TTS is disabled, and send errors were
 *         swallowed. The session must leave "sending" when the turn
 *         handler settles — resolve OR reject — independent of TTS, and
 *         a rejection must surface an error.
 *  B-04 — a mid-session WebSocket close never reached the voice context:
 *         the UI sat on "Listening" over a dead mic. An onClose from the
 *         transport must move the session to a surfaced error state.
 */

type SessionOptions = {
  onTranscript?: (text: string, final: boolean, metadata?: { speechDurationMs?: number }) => void;
  onClose?: (message: string) => void;
};

const mocks = vi.hoisted(() => {
  const holder: { options: SessionOptions | null } = { options: null };
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
  useInworldSession: (options: SessionOptions) => {
    mocks.holder.options = options;
    return mocks.inworld;
  },
}));

vi.mock("@/features/voice/store/useVoiceStore", () => ({
  useVoiceStore: mocks.useVoiceStore,
}));

import { VoiceSessionProvider, useVoiceSession, type VoiceSessionCtx } from "./VoiceSessionContext";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.holder.options = null;
  mocks.state.timing = createInitialTimingMetrics();
  mocks.inworld.getLastSpeechDurationMs.mockReturnValue(0);
  mocks.inworld.getVadState.mockReturnValue("idle");

  vi.stubGlobal(
    "navigator",
    Object.defineProperty({}, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [],
          getAudioTracks: () => [],
        })),
        enumerateDevices: vi.fn(async () => []),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    }),
  );
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

/** A promise that rejects but is pre-handled so vitest doesn't flag it
 *  as an unhandled rejection when the code under test ignores it. */
function handledRejection(message: string): Promise<never> {
  const p = Promise.reject(new Error(message));
  p.catch(() => {});
  return p;
}

describe("B-01 — auto-send default: session, prefs, and Settings agree", () => {
  it("defaults to the config default (ON) when nothing is stored", () => {
    const getSession = mountSession();
    expect(VOICE_GATE_CONFIG.ptt.autoSendDefault).toBe(true);
    expect(getSession().autoSendEnabled).toBe(readAutoSendEnabled());
    expect(getSession().autoSendEnabled).toBe(true);
  });

  it("a stored OFF pref wins over the config default", () => {
    localStorage.setItem("litt:voice:autoSendEnabled", "0");
    const getSession = mountSession();
    expect(getSession().autoSendEnabled).toBe(false);
    expect(getSession().autoSendEnabled).toBe(readAutoSendEnabled());
  });

  it("a stored ON pref wins", () => {
    localStorage.setItem("litt:voice:autoSendEnabled", "1");
    const getSession = mountSession();
    expect(getSession().autoSendEnabled).toBe(true);
    expect(getSession().autoSendEnabled).toBe(readAutoSendEnabled());
  });

  it("with nothing stored, an accepted transcript actually auto-sends", async () => {
    const getSession = mountSession();
    const onTurn = vi.fn(async () => {});
    act(() => {
      getSession().setOnTurn(onTurn);
    });
    await act(async () => {
      await getSession().startVoice();
    });

    act(() => {
      mocks.holder.options?.onTranscript?.("build me a landing page", true, {
        speechDurationMs: 2000,
      });
    });

    expect(onTurn).toHaveBeenCalledWith("build me a landing page");
  });
});

describe("B-02 — the sending state always exits", () => {
  it("exits to idle with a surfaced error when the turn handler rejects", async () => {
    localStorage.setItem("litt:voice:autoSendEnabled", "1");
    const getSession = mountSession();
    act(() => {
      getSession().setOnTurn(() => handledRejection("network down"));
    });
    await act(async () => {
      await getSession().startVoice();
    });

    act(() => {
      mocks.holder.options?.onTranscript?.("build me a landing page", true, {
        speechDurationMs: 2000,
      });
    });
    expect(getSession().voiceState).toBe("sending");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSession().voiceState).toBe("idle");
    expect(getSession().errorMessage).toMatch(/couldn't be sent/i);
  });

  it("exits to idle when TTS is off (speakText early-return cannot wedge it)", async () => {
    localStorage.setItem("litt:voice:autoSendEnabled", "1");
    localStorage.setItem("litt:voice:ttsEnabled", "0");
    const getSession = mountSession();
    // Mirror the composer's wiring: send, then speak the reply.
    act(() => {
      getSession().setOnTurn((text: string) =>
        Promise.resolve({ reply: `Reply to: ${text}` }).then((result) =>
          getSession().speakText(result.reply),
        ),
      );
    });
    await act(async () => {
      await getSession().startVoice();
    });

    act(() => {
      mocks.holder.options?.onTranscript?.("build me a landing page", true, {
        speechDurationMs: 2000,
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSession().voiceState).toBe("idle");
  });

  it("submitTranscript also exits sending when the handler rejects", async () => {
    localStorage.setItem("litt:voice:autoSendEnabled", "0");
    const getSession = mountSession();
    act(() => {
      getSession().setOnTurn(() => handledRejection("boom"));
      getSession().setPendingTranscript("hello from the draft");
    });

    act(() => {
      getSession().submitTranscript();
    });
    expect(getSession().voiceState).toBe("sending");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSession().voiceState).toBe("idle");
    expect(getSession().errorMessage).toMatch(/couldn't be sent/i);
  });
});

describe("B-04 — mid-session transport close reaches the voice context", () => {
  it("moves a listening session to a surfaced error state on close", async () => {
    const getSession = mountSession();
    await act(async () => {
      await getSession().startVoice();
    });
    expect(getSession().voiceState).toBe("listening");
    expect(getSession().voiceTransportConnected).toBe(true);

    act(() => {
      mocks.holder.options?.onClose?.(
        "Voice connection closed. Tap the mic to try again.",
      );
    });

    expect(getSession().voiceState).toBe("error");
    expect(getSession().errorMessage).toMatch(/connection closed/i);
    expect(getSession().voiceTransportConnected).toBe(false);
  });
});
