import { describe, it, expect, beforeEach } from "vitest";
import { useVoiceStore } from "./useVoiceStore";
import { createInitialTimingMetrics, computeLatencies } from "../types";

describe("useVoiceStore", () => {
  beforeEach(() => {
    useVoiceStore.getState().reset();
    useVoiceStore.setState({ activeAgent: "litt" });
  });

  it("starts in idle state with no error", () => {
    const s = useVoiceStore.getState();
    expect(s.state).toBe("idle");
    expect(s.error).toBeNull();
    expect(s.transcript).toBe("");
    expect(s.audioLevel).toBe(0);
  });

  it("setState transitions the voice state", () => {
    useVoiceStore.getState().setState("connecting");
    expect(useVoiceStore.getState().state).toBe("connecting");
    useVoiceStore.getState().setState("speaking");
    expect(useVoiceStore.getState().state).toBe("speaking");
  });

  it("setError sets error AND state to 'error'", () => {
    useVoiceStore.getState().setError("boom");
    const s = useVoiceStore.getState();
    expect(s.error).toBe("boom");
    expect(s.state).toBe("error");
  });

  it("setError(null) resets state to 'idle'", () => {
    useVoiceStore.getState().setError("boom");
    useVoiceStore.getState().setError(null);
    const s = useVoiceStore.getState();
    expect(s.error).toBeNull();
    expect(s.state).toBe("idle");
  });

  it("setTranscript / setInterimTranscript update transcripts", () => {
    useVoiceStore.getState().setTranscript("hello");
    expect(useVoiceStore.getState().transcript).toBe("hello");
    useVoiceStore.getState().setInterimTranscript("interim");
    expect(useVoiceStore.getState().interimTranscript).toBe("interim");
  });

  it("setAudioLevel updates the level", () => {
    useVoiceStore.getState().setAudioLevel(0.42);
    expect(useVoiceStore.getState().audioLevel).toBeCloseTo(0.42);
  });

  it("setMuted toggles the muted flag", () => {
    useVoiceStore.getState().setMuted(true);
    expect(useVoiceStore.getState().isMuted).toBe(true);
  });

  it("setActiveAgent switches agent", () => {
    useVoiceStore.getState().setActiveAgent("spark");
    expect(useVoiceStore.getState().activeAgent).toBe("spark");
  });

  it("setTiming merges partial timing metrics", () => {
    useVoiceStore.getState().setTiming({ recordingStartedAt: 1000 });
    expect(useVoiceStore.getState().timing.recordingStartedAt).toBe(1000);
    // Other fields untouched
    expect(useVoiceStore.getState().timing.recordingEndedAt).toBeNull();
    useVoiceStore.getState().setTiming({ recordingEndedAt: 2000 });
    expect(useVoiceStore.getState().timing.recordingStartedAt).toBe(1000);
    expect(useVoiceStore.getState().timing.recordingEndedAt).toBe(2000);
  });

  it("reset clears transient state but keeps activeAgent", () => {
    useVoiceStore.getState().setActiveAgent("spark");
    useVoiceStore.getState().setTranscript("hello");
    useVoiceStore.getState().setError("boom");
    useVoiceStore.getState().setAudioLevel(0.5);
    useVoiceStore.getState().reset();
    const s = useVoiceStore.getState();
    expect(s.transcript).toBe("");
    expect(s.error).toBeNull();
    expect(s.audioLevel).toBe(0);
    expect(s.state).toBe("idle");
    // activeAgent is not reset by reset()
    expect(s.activeAgent).toBe("spark");
  });
});

describe("computeLatencies", () => {
  it("returns nulls for empty timing", () => {
    const lat = computeLatencies(createInitialTimingMetrics());
    expect(lat.transcriptionMs).toBeNull();
    expect(lat.aiResponseMs).toBeNull();
    expect(lat.ttsMs).toBeNull();
    expect(lat.totalMs).toBeNull();
    expect(lat.ttsTimeToFirstByteMs).toBeNull();
  });

  it("computes transcription latency", () => {
    const lat = computeLatencies({
      ...createInitialTimingMetrics(),
      transcriptionStartedAt: 1000,
      transcriptionCompletedAt: 1500,
    });
    expect(lat.transcriptionMs).toBe(500);
  });

  it("computes AI response latency", () => {
    const lat = computeLatencies({
      ...createInitialTimingMetrics(),
      aiResponseStartedAt: 1000,
      aiResponseCompletedAt: 2500,
    });
    expect(lat.aiResponseMs).toBe(1500);
  });

  it("computes TTS latency (ttsStarted -> playbackStarted)", () => {
    const lat = computeLatencies({
      ...createInitialTimingMetrics(),
      ttsStartedAt: 1000,
      playbackStartedAt: 1800,
    });
    expect(lat.ttsMs).toBe(800);
  });

  it("computes TTS time-to-first-byte", () => {
    const lat = computeLatencies({
      ...createInitialTimingMetrics(),
      ttsStartedAt: 1000,
      ttsFirstByteAt: 1200,
    });
    expect(lat.ttsTimeToFirstByteMs).toBe(200);
  });

  it("computes total round-trip latency", () => {
    const lat = computeLatencies({
      ...createInitialTimingMetrics(),
      recordingStartedAt: 1000,
      playbackStartedAt: 5000,
    });
    expect(lat.totalMs).toBe(4000);
  });
});
