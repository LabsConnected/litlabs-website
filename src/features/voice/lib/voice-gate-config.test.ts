import { describe, it, expect } from "vitest";
import { VOICE_GATE_CONFIG } from "./voice-gate-config";

describe("voice-gate-config", () => {
  it("has conservative VAD defaults", () => {
    expect(VOICE_GATE_CONFIG.vad.silenceRmsThreshold).toBeGreaterThan(0);
    expect(VOICE_GATE_CONFIG.vad.silenceRmsThreshold).toBeLessThan(0.1);
    expect(VOICE_GATE_CONFIG.vad.minSpeechDurationMs).toBeGreaterThanOrEqual(300);
    expect(VOICE_GATE_CONFIG.vad.endOfSpeechSilenceMs).toBeGreaterThanOrEqual(700);
  });

  it("has transcript validation defaults", () => {
    expect(VOICE_GATE_CONFIG.validation.minLength).toBeGreaterThanOrEqual(2);
    expect(VOICE_GATE_CONFIG.validation.rejectFillerOnly).toBe(true);
    expect(VOICE_GATE_CONFIG.validation.rejectDuplicates).toBe(true);
    expect(VOICE_GATE_CONFIG.validation.fillerWords).toContain("yeah");
    expect(VOICE_GATE_CONFIG.validation.fillerWords).toContain("um");
    expect(VOICE_GATE_CONFIG.validation.fillerWords).toContain("uh");
  });

  it("has echo isolation defaults", () => {
    expect(VOICE_GATE_CONFIG.echo.pauseMicDuringTts).toBe(true);
    expect(VOICE_GATE_CONFIG.echo.postTtsCooldownMs).toBeGreaterThan(0);
    expect(VOICE_GATE_CONFIG.echo.cancelStaleCallbacksOnTts).toBe(true);
  });

  it("has audio constraints for echo cancellation", () => {
    expect(VOICE_GATE_CONFIG.audioConstraints.echoCancellation).toBe(true);
    expect(VOICE_GATE_CONFIG.audioConstraints.noiseSuppression).toBe(true);
    expect(VOICE_GATE_CONFIG.audioConstraints.autoGainControl).toBe(true);
    expect(VOICE_GATE_CONFIG.audioConstraints.channelCount).toBe(1);
  });

  it("defaults to push-to-talk with auto-send off", () => {
    expect(VOICE_GATE_CONFIG.ptt.defaultMode).toBe("push_to_talk");
    expect(VOICE_GATE_CONFIG.ptt.autoSendDefault).toBe(false);
  });
});
