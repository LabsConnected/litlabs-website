import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import { createInitialTimingMetrics } from "@/features/voice/types";

/**
 * Regression test for the Greptile P1 on PR #757:
 * /api/voice/health reports configured:false when only the INWORLD
 * token path is missing — it says nothing about the OpenAI
 * /api/voice/tts endpoint or browser speechSynthesis. The probe must
 * gate the Inworld step alone; returning early killed both fallbacks
 * and "Speak" silently stopped working on those deployments.
 */

const mocks = vi.hoisted(() => {
  const inworld = {
    speakText: vi.fn(async () => {}),
    pauseMic: vi.fn(),
    resumeMic: vi.fn(),
    startListening: vi.fn(async () => {}),
    stopListening: vi.fn(),
    disconnect: vi.fn(),
    interrupt: vi.fn(),
    didLastTtsPlayAudio: vi.fn(() => false),
    getVadState: vi.fn(() => "idle"),
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
  return { inworld, state, useVoiceStore };
});

vi.mock("@/features/voice/hooks/useInworldSession", () => ({
  useInworldSession: () => mocks.inworld,
}));

vi.mock("@/features/voice/store/useVoiceStore", () => ({
  useVoiceStore: mocks.useVoiceStore,
}));

import { VoiceSessionProvider, useVoiceSession, type VoiceSessionCtx } from "./VoiceSessionContext";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.state.timing = createInitialTimingMetrics();

  vi.stubGlobal("speechSynthesis", {
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: vi.fn(() => []),
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    },
  );
  vi.stubGlobal(
    "Audio",
    class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public src: string) {}
      play() {
        return Promise.resolve();
      }
      pause() {}
    },
  );
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

describe("speakText — Inworld unconfigured must not kill the fallback chain", () => {
  it("falls through to /api/voice/tts when the health probe says Inworld is unavailable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/voice/health")) {
        return jsonResponse({ configured: false, available: false });
      }
      if (url.includes("/api/voice/tts")) {
        return jsonResponse({ audioUrl: "data:audio/mp3;base64,AAAA" });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const getSession = mountSession();
    await act(async () => {
      await getSession().speakText("Hello there");
    });

    expect(mocks.inworld.speakText).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/voice/tts",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reaches browser speechSynthesis when both Inworld and the TTS endpoint are unavailable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/voice/health")) {
        return jsonResponse({ configured: false, available: false });
      }
      if (url.includes("/api/voice/tts")) {
        return jsonResponse({ error: "OpenAI API key not configured" }, 500);
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const getSession = mountSession();
    await act(async () => {
      await getSession().speakText("Hello there");
    });

    expect(mocks.inworld.speakText).not.toHaveBeenCalled();
    expect(vi.mocked(window.speechSynthesis.speak)).toHaveBeenCalledTimes(1);
  });
});
