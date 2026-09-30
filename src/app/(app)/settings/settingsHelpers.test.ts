import { describe, expect, it } from "vitest";
import {
  accountCardValue,
  accentLabel,
  micCardValue,
  resetAllLocalSettings,
  securityCardValue,
  themeModeLabel,
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
