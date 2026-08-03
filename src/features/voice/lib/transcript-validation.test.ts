import { describe, it, expect } from "vitest";
import { validateTranscript, isFillerOnly } from "./transcript-validation";

describe("transcript-validation — ghost transcription prevention", () => {
  const baseCtx = {
    previousTranscript: null,
    ttsPlaying: false,
  };

  it("rejects empty transcript", () => {
    const result = validateTranscript("", baseCtx);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("empty");
  });

  it("rejects whitespace-only transcript", () => {
    const result = validateTranscript("   \n\t  ", baseCtx);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("empty");
  });

  it("rejects too-short transcript", () => {
    const result = validateTranscript("a", baseCtx);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("too_short");
  });

  it("rejects filler-only transcript (yeah)", () => {
    const result = validateTranscript("yeah", baseCtx);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("filler_only");
  });

  it("rejects filler-only transcript (um)", () => {
    const result = validateTranscript("um", baseCtx);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("filler_only");
  });

  it("rejects filler-only transcript (okay)", () => {
    const result = validateTranscript("okay", baseCtx);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("filler_only");
  });

  it("accepts transcript that contains filler but has real content", () => {
    const result = validateTranscript("yeah let's do it", baseCtx);
    expect(result.accepted).toBe(true);
    expect(result.reason).toBe("accepted");
  });

  it("rejects duplicate of previous transcript", () => {
    const result = validateTranscript("hello world", {
      ...baseCtx,
      previousTranscript: "hello world",
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("duplicate");
  });

  it("rejects transcript captured during TTS playback (echo)", () => {
    const result = validateTranscript("hello world", {
      ...baseCtx,
      ttsPlaying: true,
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("during_tts");
  });

  it("rejects transcript with no speech detected by VAD", () => {
    const result = validateTranscript("hello", {
      ...baseCtx,
      speechDurationMs: 50, // below minSpeechDurationMs (350ms)
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("no_speech_detected");
  });

  it("accepts valid transcript with sufficient speech duration", () => {
    const result = validateTranscript("hello world", {
      ...baseCtx,
      speechDurationMs: 800,
    });
    expect(result.accepted).toBe(true);
    expect(result.reason).toBe("accepted");
  });

  it("accepts valid transcript without VAD duration metadata", () => {
    const result = validateTranscript("hello world", baseCtx);
    expect(result.accepted).toBe(true);
    expect(result.reason).toBe("accepted");
  });

  it("includes explanation for diagnostics", () => {
    const result = validateTranscript("yeah", baseCtx);
    expect(result.explanation).toContain("filler");
  });

  it("trims whitespace before validation", () => {
    const result = validateTranscript("  hello world  ", baseCtx);
    expect(result.accepted).toBe(true);
    expect(result.transcript).toBe("hello world");
  });
});

describe("isFillerOnly", () => {
  const fillers = ["yeah", "um", "uh", "okay", "hmm"];

  it("returns true for single filler word", () => {
    expect(isFillerOnly("yeah", fillers)).toBe(true);
    expect(isFillerOnly("um", fillers)).toBe(true);
  });

  it("returns false for real speech", () => {
    expect(isFillerOnly("yeah let's build it", fillers)).toBe(false);
  });

  it("returns true for all-filler short phrase", () => {
    expect(isFillerOnly("yeah um", fillers)).toBe(true);
  });

  it("returns false for longer phrase with filler", () => {
    expect(isFillerOnly("yeah um I want to build something", fillers)).toBe(false);
  });

  it("returns true for empty string", () => {
    expect(isFillerOnly("", fillers)).toBe(true);
  });

  it("handles punctuation", () => {
    expect(isFillerOnly("yeah.", fillers)).toBe(true);
    expect(isFillerOnly("um,", fillers)).toBe(true);
  });
});
