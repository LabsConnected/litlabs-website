import { describe, expect, it } from "vitest";
import {
  accountCardValue,
  accentLabel,
  micCardValue,
  resetAllLocalSettings,
  securityCardValue,
  themeModeLabel,
  loadVoicePrefs,
  saveVoicePref,
  classifyMicError,
  describeVoiceTokenFailure,
  describeVoiceClose,
  describeTtsFailure,
  VOICE_AUTO_SEND_KEY,
  VOICE_TTS_KEY,
  VOICE_DEVICE_KEY,
} from "./settingsHelpers";

describe("accountCardValue", () => {
  it("shows the real first name, never a bare placeholder", () => {
    expect(
      accountCardValue({ isSignedIn: true, userLoaded: true, firstName: "Larry", username: "larry" }),
    ).toBe("Signed in as Larry");
  });

  it("falls back to username when first name is missing", () => {
    expect(
      accountCardValue({ isSignedIn: true, userLoaded: true, firstName: null, username: "larry" }),
    ).toBe("Signed in as larry");
  });

  it("shows a loading state instead of a wrong name while Clerk loads", () => {
    expect(accountCardValue({ isSignedIn: true, userLoaded: false })).toBe("Signing in…");
  });

  it("handles signed-out users", () => {
    expect(accountCardValue({ isSignedIn: false, userLoaded: true })).toBe("Not signed in");
  });
});

describe("securityCardValue", () => {
  it("reports real 2FA state and last sign-in", () => {
    const lastSignInAt = new Date("2026-09-25T12:00:00Z").getTime();
    const value = securityCardValue({ userLoaded: true, twoFactorEnabled: true, lastSignInAt });
    expect(value).toContain("2FA on");
    expect(value).toContain("Last sign-in");
    expect(value).not.toContain("2FA status");
  });

  it("reports 2FA off honestly", () => {
    expect(securityCardValue({ userLoaded: true, twoFactorEnabled: false })).toContain("2FA off");
  });

  it("does not claim a last sign-in when there is none", () => {
    expect(securityCardValue({ userLoaded: true })).toContain("never");
  });
});

describe("labels", () => {
  it("maps accent ids to friendly names, never raw ids", () => {
    expect(accentLabel("lime")).toBe("LiTT Lime");
    expect(accentLabel("hot-pink")).toBe("Hot Pink");
    expect(accentLabel("mystery")).toBe("mystery");
  });

  it("labels theme modes", () => {
    expect(themeModeLabel("dark")).toBe("Dark");
    expect(themeModeLabel("light")).toBe("Light");
    expect(themeModeLabel("system")).toBe("System");
  });

  it("never calls an untested mic 'testing'", () => {
    expect(micCardValue("unknown")).toBe("Not tested yet");
    expect(micCardValue("available")).toBe("Microphone available");
    expect(micCardValue("denied")).toBe("Microphone blocked");
    expect(micCardValue("error")).toBe("Microphone error");
  });
});

describe("resetAllLocalSettings", () => {
  it("removes settings keys and leaves auth keys alone", () => {
    localStorage.setItem("litlabs:settings:automation", "{}");
    localStorage.setItem("littree:workspace-preferences", "{}");
    localStorage.setItem("litlabs:agent-settings", "{}");
    localStorage.setItem("__clerk_client_123", "keep-me");
    localStorage.setItem("unrelated", "keep-me-too");

    const removed = resetAllLocalSettings();

    expect(removed).toBe(3);
    expect(localStorage.getItem("litlabs:settings:automation")).toBeNull();
    expect(localStorage.getItem("littree:workspace-preferences")).toBeNull();
    expect(localStorage.getItem("__clerk_client_123")).toBe("keep-me");
    expect(localStorage.getItem("unrelated")).toBe("keep-me-too");
    localStorage.clear();
  });
});

describe("voice preferences", () => {
  it("loads context defaults when nothing is stored", () => {
    const prefs = loadVoicePrefs(null);
    expect(prefs).toEqual({ autoSend: false, ttsEnabled: true, deviceId: null });
  });

  it("round-trips the same keys VoiceSessionContext consumes", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      get length() { return store.size; },
    } as unknown as Storage;

    saveVoicePref(VOICE_AUTO_SEND_KEY, "1", storage);
    saveVoicePref(VOICE_TTS_KEY, "0", storage);
    saveVoicePref(VOICE_DEVICE_KEY, "mic-123", storage);

    expect(loadVoicePrefs(storage)).toEqual({ autoSend: true, ttsEnabled: false, deviceId: "mic-123" });
    // Keys match the runtime contract exactly.
    expect(store.get("litt:voice:autoSendEnabled")).toBe("1");
    expect(store.get("litt:voice:ttsEnabled")).toBe("0");
    expect(store.get("litt:voice:deviceId")).toBe("mic-123");
  });

  it("treats a missing tts key as enabled and only explicit '0' disables", () => {
    const storage = { getItem: () => null, setItem: () => {} } as unknown as Storage;
    expect(loadVoicePrefs(storage).ttsEnabled).toBe(true);
  });
});

describe("classifyMicError", () => {
  const named = (name: string) => new DOMException("x", name);

  it("maps permission denial to an actionable hint", () => {
    const info = classifyMicError(named("NotAllowedError"));
    expect(info.status).toBe("denied");
    expect(info.hint).toMatch(/permission|allow/i);
  });

  it("distinguishes missing, busy, and over-constrained devices", () => {
    expect(classifyMicError(named("NotFoundError")).kind).toBe("not-found");
    expect(classifyMicError(named("NotReadableError")).kind).toBe("in-use");
    expect(classifyMicError(named("OverconstrainedError")).kind).toBe("overconstrained");
  });

  it("reports unsupported when getUserMedia is unavailable", () => {
    const info = classifyMicError(new Error("nope"), false);
    expect(info.kind).toBe("unsupported");
    expect(info.hint).toMatch(/HTTPS|secure/i);
  });

  it("never leaks raw exception text", () => {
    const info = classifyMicError(new Error("device busy at /dev/audio"));
    expect(info.hint).not.toContain("/dev/audio");
  });
});

describe("voice connection error messages", () => {
  it("explains auth rejection vs missing server config", () => {
    expect(describeVoiceTokenFailure(401)).toMatch(/sign in/i);
    expect(describeVoiceTokenFailure(503)).toMatch(/VOICE_AUTH_SECRET|not configured/i);
    expect(describeVoiceTokenFailure(500)).toMatch(/HTTP 500/);
  });

  it("explains policy closes as possible token/secret mismatch", () => {
    expect(describeVoiceClose(1008)).toMatch(/rejected|mismatch/i);
    expect(describeVoiceClose(1006)).toMatch(/dropped|network/i);
    expect(describeVoiceClose(4001, "no token")).toContain("no token");
  });

  it("classifies TTS preview failures with a recovery path", () => {
    expect(describeTtsFailure(401)).toMatch(/sign in/i);
    expect(describeTtsFailure(500, "OpenAI API key not configured")).toMatch(/isn't configured|unavailable/i);
    expect(describeTtsFailure(502)).toMatch(/browser voice/i);
  });
});
