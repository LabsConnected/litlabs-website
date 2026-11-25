import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VOICE_FAILURE_MESSAGES } from "@/features/voice/lib/voice-failure";

/**
 * Composer rendering for the mobile voice failure states (companion to
 * CommandComposer.voice-error.test.tsx, which pins the error/4001
 * surface). The session context now actually produces permission_denied
 * and unsupported — these tests pin that the composer shows the full
 * plain-language message (recovery steps included), keeps the retry
 * affordance honest, and never renders the label twice.
 */

const voice = vi.hoisted(() => ({
  voiceState: "idle" as string,
  errorMessage: null as string | null,
  voiceAvailable: true,
}));

vi.mock("@/app/(app)/studio/context/VoiceSessionContext", () => ({
  useVoiceSession: () => ({
    voiceState: voice.voiceState,
    voiceOutputState: "idle",
    isMuted: false,
    startVoice: vi.fn(),
    stopVoice: vi.fn(),
    interrupt: vi.fn(),
    toggleMute: vi.fn(),
    setOnTurn: vi.fn(),
    speakText: vi.fn(),
    stopSpeaking: vi.fn(),
    ttsEnabled: true,
    toggleTts: vi.fn(),
    autoSendEnabled: false,
    toggleAutoSend: vi.fn(),
    cancelRecording: vi.fn(),
    micLevel: 0,
    transcript: "",
    recordingSeconds: 0,
    errorMessage: voice.errorMessage,
    voiceAvailable: voice.voiceAvailable,
    setOnTranscriptComplete: vi.fn(),
  }),
  VoiceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    resolvedColors: { accentColor: "#a8ff2f", textColor: "#fff", textMuted: "#888" },
    layoutStyle: "compact",
  }),
}));

vi.mock("@/features/voice/store/useVoiceStore", () => ({
  useVoiceStore: () => ({ setActiveAgent: vi.fn() }),
}));

import CommandComposer from "./CommandComposer";

function renderComposer() {
  return render(
    <CommandComposer value="" onChange={vi.fn()} onSend={vi.fn()} busy={false} />,
  );
}

describe("CommandComposer — permission denied / unsupported / transcript-waiting notices", () => {
  beforeEach(() => {
    voice.voiceState = "idle";
    voice.errorMessage = null;
    voice.voiceAvailable = true;
  });

  it("permission_denied: the alert carries the full Android Chrome recovery steps, exactly once", () => {
    voice.voiceState = "permission_denied";
    voice.errorMessage = VOICE_FAILURE_MESSAGES.permission_denied;
    renderComposer();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Microphone permission denied/);
    expect(alert).toHaveTextContent(/address bar/);
    expect(alert).toHaveTextContent(/Permissions/);
    expect(alert).toHaveTextContent(/reload the page/);
    // The label is not duplicated in front of the message.
    expect(alert.textContent?.match(/Microphone permission denied/g)).toHaveLength(1);
  });

  it("permission_denied: the mic button stays enabled as the retry path", () => {
    voice.voiceState = "permission_denied";
    voice.errorMessage = VOICE_FAILURE_MESSAGES.permission_denied;
    renderComposer();

    const mic = screen.getByRole("button", { name: /permission denied/i });
    expect(mic).not.toBeDisabled();
  });

  it("unsupported: the alert names the remedy and the mic button is disabled (no fake retry)", () => {
    voice.voiceState = "unsupported";
    voice.errorMessage = VOICE_FAILURE_MESSAGES.unsupported;
    renderComposer();

    expect(screen.getByRole("alert")).toHaveTextContent(/isn't supported in this browser/i);
    const mic = screen.getByRole("button", { name: /not supported/i });
    expect(mic).toBeDisabled();
  });

  it("transcript_ready with a notice: the mic-tap explanation is visible instead of a dead button", () => {
    voice.voiceState = "transcript_ready";
    voice.errorMessage =
      "You have a transcript waiting — send it or clear it, then tap the mic to record again.";
    renderComposer();

    expect(screen.getByRole("alert")).toHaveTextContent(/transcript waiting/i);
  });
});
