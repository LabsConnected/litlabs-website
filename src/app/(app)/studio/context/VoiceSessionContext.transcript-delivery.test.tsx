import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import { createInitialTimingMetrics } from "@/features/voice/types";

/**
 * Regression tests for the silent voice-transcript drop (2026-11-10):
 * Larry's production report — "I say something, I hit Stop, nothing happens."
 *
 * Two delivery guarantees are pinned here:
 *  1. A finalized transcript produced by the STT engine must NEVER vanish
 *     silently. When it fails only the client-side VAD-duration heuristic
 *     (rejection reason "no_speech_detected" — the metadata is unreliable
 *     on the push-to-talk Stop path), it must still reach the composer as
 *     an editable draft like every other content-bearing rejection.
 *  2. When a push-to-talk stop captured no speech at all (silent device,
 *     muted mixer, VAD never opened), the user must be TOLD nothing was
 *     heard instead of the session silently returning to idle.
 */

type TranscriptOptions = {
  onTranscript?: (text: string, final: boolean, metadata?: { speechDurationMs?: number }) => void;
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
  // Unmount while the navigator stub is still installed — the provider's
  // devicechange cleanup reads navigator.mediaDevices.removeEventListener.
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

describe("final transcript delivery — no silent drops", () => {
  it("delivers a finalized transcript to the composer even when VAD duration metadata is 0 (PTT stop)", async () => {
    const getSession = mountSession();
    const composer = vi.fn();
    act(() => {
      getSession().setOnTranscriptComplete(composer);
    });
    await act(async () => {
      await getSession().startVoice();
    });

    // Inworld transcribed real speech, but the transcript arrives stamped
    // speechDurationMs: 0 — the push-to-talk Stop path, where the duration
    // ref was never written by a VAD speech-end callback.
    act(() => {
      mocks.holder.options?.onTranscript?.("build me a landing page", true, {
        speechDurationMs: 0,
      });
    });

    expect(composer).toHaveBeenCalledWith("build me a landing page");
  });

  it("tells the user when a push-to-talk stop captured no speech at all", async () => {
    const getSession = mountSession();
    await act(async () => {
      await getSession().startVoice();
    });

    // VAD heard nothing for the whole hold (getLastSpeechDurationMs = 0,
    // VAD state idle) — e.g. a silent/wrong input device or a muted mixer.
    vi.useFakeTimers();
    act(() => {
      getSession().stopVoice();
    });
    expect(getSession().errorMessage).toBeNull();

    // The existing STT wait window elapses with no transcript arriving.
    act(() => {
      vi.advanceTimersByTime(8_000);
    });

    expect(getSession().errorMessage).toMatch(/didn't hear/i);
  });
});
