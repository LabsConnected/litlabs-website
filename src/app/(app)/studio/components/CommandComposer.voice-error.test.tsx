import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mutable voice-session state so each test can drive a different
// failure mode through the composer.
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

// The self-diagnosing message useInworldSession builds for a double-4001
// (VOICE_AUTH_SECRET mismatch between the web service and voice-server).
const DIAGNOSIS_4001 =
  "Voice can't connect: the website and the voice server (voice.example) are using " +
  "different credentials — the server rejected a freshly issued token. Fix: set the " +
  "same VOICE_AUTH_SECRET (32+ characters) on the web service and the voice-server " +
  "service in Railway, then redeploy both.";

function renderComposer() {
  return render(
    <CommandComposer value="" onChange={vi.fn()} onSend={vi.fn()} busy={false} />,
  );
}

describe("CommandComposer — voice failure surfaces on the mic button", () => {
  beforeEach(() => {
    voice.voiceState = "idle";
    voice.errorMessage = null;
    voice.voiceAvailable = true;
  });

  it("auth/4001 failure: button is labelled unavailable and carries the diagnosis as its title", () => {
    voice.voiceState = "error";
    voice.errorMessage = DIAGNOSIS_4001;
    voice.voiceAvailable = false;
    renderComposer();

    const mic = screen.getByRole("button", { name: /voice unavailable/i });
    expect(mic).toHaveAttribute("title", expect.stringContaining("different credentials"));
    expect(mic).not.toBeDisabled();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/voice unavailable/i);
    expect(alert).toHaveTextContent(/different credentials/);
  });

  it("generic failure without a diagnosis still gives the button a human-readable state", () => {
    voice.voiceState = "error";
    voice.errorMessage = null;
    renderComposer();

    const mic = screen.getByRole("button", { name: /voice unavailable/i });
    expect(mic.getAttribute("title") ?? "").toMatch(/voice unavailable/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/voice unavailable/i);
  });

  it("idle with the voice service unreachable: Start voice stays honest via its title", () => {
    voice.voiceState = "idle";
    voice.voiceAvailable = false;
    renderComposer();

    const mic = screen.getByRole("button", { name: "Start voice" });
    expect(mic.getAttribute("title") ?? "").toMatch(/voice unavailable/i);
  });

  it("idle with a healthy voice service: plain Start voice, no failure labelling", () => {
    voice.voiceState = "idle";
    voice.voiceAvailable = true;
    renderComposer();

    const mic = screen.getByRole("button", { name: "Start voice" });
    expect(mic.getAttribute("title") ?? "").not.toMatch(/unavailable/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
