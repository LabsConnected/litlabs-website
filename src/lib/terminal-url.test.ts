import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getVoiceServerUrl } from "./terminal-url";

describe("getVoiceServerUrl", () => {
  const keys = ["VOICE_PUBLIC_URL", "NEXT_PUBLIC_VOICE_WS_URL"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns '' with no hardcoded fallback when nothing is configured", () => {
    // Regression guard: this must NEVER resolve to a guessed/legacy Railway
    // URL. A guessed proxy can live in a different Railway project with a
    // different VOICE_AUTH_SECRET, which surfaces as a WebSocket close code
    // 4001 that looks like an auth failure instead of a config error.
    expect(getVoiceServerUrl()).toBe("");
  });

  it("prefers VOICE_PUBLIC_URL over NEXT_PUBLIC_VOICE_WS_URL", () => {
    process.env.VOICE_PUBLIC_URL = "https://voice.example.com/";
    process.env.NEXT_PUBLIC_VOICE_WS_URL = "wss://other.example.com/voice";
    expect(getVoiceServerUrl()).toBe("https://voice.example.com");
  });

  it("falls back to NEXT_PUBLIC_VOICE_WS_URL, normalized to https", () => {
    process.env.NEXT_PUBLIC_VOICE_WS_URL = "wss://proxy.example.com/voice";
    expect(getVoiceServerUrl()).toBe("https://proxy.example.com/voice");
  });
});
