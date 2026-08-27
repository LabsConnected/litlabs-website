import { describe, it, expect, beforeEach } from "vitest";
import {
  MIXER_STORAGE_KEY,
  MIXER_DEFAULTS,
  buildMicAudioConstraints,
  clampGain,
  clampVolume,
  loadMixerPrefs,
  persistMixerPrefs,
  readStoredDeviceId,
} from "./mixer-settings";

describe("clampGain", () => {
  it("clamps to the 0–2 range", () => {
    expect(clampGain(-1)).toBe(0);
    expect(clampGain(0)).toBe(0);
    expect(clampGain(1)).toBe(1);
    expect(clampGain(2)).toBe(2);
    expect(clampGain(5)).toBe(2);
  });

  it("falls back to unity for non-finite values", () => {
    expect(clampGain(Number.NaN)).toBe(MIXER_DEFAULTS.inputGain);
    expect(clampGain(Number.POSITIVE_INFINITY)).toBe(MIXER_DEFAULTS.inputGain);
  });
});

describe("clampVolume", () => {
  it("clamps to the 0–1 range", () => {
    expect(clampVolume(-0.5)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(1.5)).toBe(1);
  });

  it("falls back to full volume for non-finite values", () => {
    expect(clampVolume(Number.NaN)).toBe(MIXER_DEFAULTS.outputVolume);
  });
});

describe("buildMicAudioConstraints", () => {
  it("returns the canonical voice gate constraints by default", () => {
    const constraints = buildMicAudioConstraints();
    expect(constraints.echoCancellation).toBe(true);
    expect(constraints.noiseSuppression).toBe(true);
    expect(constraints.autoGainControl).toBe(true);
    expect(constraints.channelCount).toBe(1);
    expect(constraints.deviceId).toBeUndefined();
  });

  it("omits deviceId for null / empty / default selections", () => {
    expect(buildMicAudioConstraints({ deviceId: null }).deviceId).toBeUndefined();
    expect(buildMicAudioConstraints({ deviceId: "" }).deviceId).toBeUndefined();
    expect(buildMicAudioConstraints({ deviceId: "default" }).deviceId).toBeUndefined();
  });

  it("pins an exact deviceId while preserving processing flags", () => {
    const constraints = buildMicAudioConstraints({ deviceId: "abc-123" });
    expect(constraints.deviceId).toEqual({ exact: "abc-123" });
    expect(constraints.echoCancellation).toBe(true);
    expect(constraints.sampleRate).toBeDefined();
  });
});

describe("mixer prefs persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips prefs through localStorage", () => {
    persistMixerPrefs({ inputGain: 1.5, outputVolume: 0.4, muted: true });
    expect(loadMixerPrefs()).toEqual({ inputGain: 1.5, outputVolume: 0.4, muted: true });
    expect(JSON.parse(window.localStorage.getItem(MIXER_STORAGE_KEY)!)).toEqual({
      inputGain: 1.5,
      outputVolume: 0.4,
      muted: true,
    });
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadMixerPrefs()).toEqual(MIXER_DEFAULTS);
  });

  it("falls back to defaults on corrupt JSON", () => {
    window.localStorage.setItem(MIXER_STORAGE_KEY, "{not json");
    expect(loadMixerPrefs()).toEqual(MIXER_DEFAULTS);
  });

  it("sanitizes out-of-range values from storage", () => {
    window.localStorage.setItem(
      MIXER_STORAGE_KEY,
      JSON.stringify({ inputGain: 99, outputVolume: -3, muted: "yes" }),
    );
    expect(loadMixerPrefs()).toEqual({ inputGain: 2, outputVolume: 0, muted: false });
  });
});

describe("readStoredDeviceId", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reads the shared device key", () => {
    window.localStorage.setItem("litt:voice:deviceId", "dev-42");
    expect(readStoredDeviceId()).toBe("dev-42");
  });

  it("returns null for empty or missing values", () => {
    expect(readStoredDeviceId()).toBeNull();
    window.localStorage.setItem("litt:voice:deviceId", "");
    expect(readStoredDeviceId()).toBeNull();
  });
});
