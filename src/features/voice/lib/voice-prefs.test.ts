import { describe, it, expect, beforeEach } from "vitest";
import {
  AUTO_SEND_STORAGE_KEY,
  TTS_ENABLED_STORAGE_KEY,
  readAutoSendEnabled,
  writeAutoSendEnabled,
  readTtsEnabled,
  writeTtsEnabled,
} from "./voice-prefs";

// These keys are the contract with VoiceSessionContext: the session
// provider reads `litt:voice:autoSendEnabled` / `litt:voice:ttsEnabled`
// from localStorage when it mounts. If these literals ever drift from
// the context's, Settings and Studio silently disconnect again — so the
// tests pin the literal key strings, not just the constants.
describe("voice-prefs — shared keys with VoiceSessionContext", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("pins the exact localStorage keys the session context uses", () => {
    expect(AUTO_SEND_STORAGE_KEY).toBe("litt:voice:autoSendEnabled");
    expect(TTS_ENABLED_STORAGE_KEY).toBe("litt:voice:ttsEnabled");
  });

  it("auto-send defaults to enabled when nothing is stored", () => {
    expect(readAutoSendEnabled()).toBe(true);
  });

  it("writeAutoSendEnabled stores the session context's '1'/'0' format", () => {
    writeAutoSendEnabled(true);
    expect(window.localStorage.getItem("litt:voice:autoSendEnabled")).toBe("1");
    writeAutoSendEnabled(false);
    expect(window.localStorage.getItem("litt:voice:autoSendEnabled")).toBe("0");
  });

  it("readAutoSendEnabled reads back what was written (remount semantics)", () => {
    writeAutoSendEnabled(true);
    expect(readAutoSendEnabled()).toBe(true);
    writeAutoSendEnabled(false);
    expect(readAutoSendEnabled()).toBe(false);
  });

  it("readAutoSendEnabled parses a value written by the session context", () => {
    // VoiceSessionContext writes via localStorage.setItem(key, next ? "1" : "0").
    window.localStorage.setItem("litt:voice:autoSendEnabled", "1");
    expect(readAutoSendEnabled()).toBe(true);
    window.localStorage.setItem("litt:voice:autoSendEnabled", "0");
    expect(readAutoSendEnabled()).toBe(false);
  });

  it("tts defaults to enabled when nothing is stored", () => {
    expect(readTtsEnabled()).toBe(true);
  });

  it("writeTtsEnabled round-trips in the session context's format", () => {
    writeTtsEnabled(false);
    expect(window.localStorage.getItem("litt:voice:ttsEnabled")).toBe("0");
    expect(readTtsEnabled()).toBe(false);
    writeTtsEnabled(true);
    expect(window.localStorage.getItem("litt:voice:ttsEnabled")).toBe("1");
    expect(readTtsEnabled()).toBe(true);
  });
});
