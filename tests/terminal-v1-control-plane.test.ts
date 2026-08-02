import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  isTerminalEnabled,
  isTerminalEnabledClient,
  TERMINAL_DISABLED_RESPONSE,
  TERMINAL_DISABLED_STATUS,
  isFeatureDisabledError,
  FeatureDisabledError,
} from "@/lib/terminal-v1/control-plane";

const SECRET = "a".repeat(64);

describe("Terminal V1 Control Plane — disabled behavior", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", SECRET);
    vi.stubEnv("TERMINAL_ENABLED", "false");
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", "false");
    vi.stubEnv("TERMINAL_PROVIDER", "disabled");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("isTerminalEnabled returns false by default", () => {
    expect(isTerminalEnabled()).toBe(false);
  });

  it("isTerminalEnabled returns true when TERMINAL_ENABLED=true", () => {
    vi.stubEnv("TERMINAL_ENABLED", "true");
    expect(isTerminalEnabled()).toBe(true);
  });

  it("isTerminalEnabledClient returns false by default", () => {
    expect(isTerminalEnabledClient()).toBe(false);
  });

  it("isTerminalEnabledClient returns true when NEXT_PUBLIC_TERMINAL_ENABLED=true", () => {
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", "true");
    expect(isTerminalEnabledClient()).toBe(true);
  });

  it("TERMINAL_DISABLED_RESPONSE has correct shape", () => {
    expect(TERMINAL_DISABLED_RESPONSE.disabled).toBe(true);
    expect(TERMINAL_DISABLED_RESPONSE.code).toBe("FEATURE_DISABLED");
    expect(TERMINAL_DISABLED_RESPONSE.error).toContain("coming soon");
  });

  it("TERMINAL_DISABLED_STATUS is 503", () => {
    expect(TERMINAL_DISABLED_STATUS).toBe(503);
  });

  it("isFeatureDisabledError recognizes FeatureDisabledError", () => {
    const err = new FeatureDisabledError("test");
    expect(isFeatureDisabledError(err)).toBe(true);
  });

  it("isFeatureDisabledError rejects generic errors", () => {
    expect(isFeatureDisabledError(new Error("test"))).toBe(false);
  });
});
