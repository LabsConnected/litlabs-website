import { describe, it, expect } from "vitest";

import { getDemoConfig, isDemoAvailable, DEMO_LIMIT_MESSAGE } from "./config";

describe("getDemoConfig", () => {
  it("applies sane defaults", () => {
    const cfg = getDemoConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.killSwitch).toBe(false);
    expect(cfg.maxMessages).toBe(5);
    expect(cfg.maxTokens).toBe(1024);
    expect(cfg.modelProvider).toBe("openrouter-free");
  });

  it("parses the kill switch and enabled flags", () => {
    expect(getDemoConfig({ DEMO_KILL_SWITCH: "1" }).killSwitch).toBe(true);
    expect(getDemoConfig({ DEMO_KILL_SWITCH: "true" }).killSwitch).toBe(true);
    expect(getDemoConfig({ DEMO_KILL_SWITCH: "0" }).killSwitch).toBe(false);
    expect(getDemoConfig({ DEMO_ENABLED: "false" }).enabled).toBe(false);
    expect(getDemoConfig({ DEMO_ENABLED: "0" }).enabled).toBe(false);
  });

  it("clamps numeric limits to safe ranges", () => {
    expect(getDemoConfig({ DEMO_MAX_MESSAGES: "0" }).maxMessages).toBe(1);
    expect(getDemoConfig({ DEMO_MAX_MESSAGES: "99" }).maxMessages).toBe(10);
    expect(getDemoConfig({ DEMO_MAX_MESSAGES: "3" }).maxMessages).toBe(3);
    expect(getDemoConfig({ DEMO_MAX_MESSAGES: "junk" }).maxMessages).toBe(5);
    expect(getDemoConfig({ DEMO_MAX_TOKENS: "10" }).maxTokens).toBe(128);
    expect(getDemoConfig({ DEMO_MAX_TOKENS: "99999" }).maxTokens).toBe(4096);
  });

  it("accepts free-tier providers and rejects paid ones", () => {
    expect(getDemoConfig({ DEMO_MODEL_PROVIDER: "gemini" }).modelProvider).toBe("gemini");
    expect(getDemoConfig({ DEMO_MODEL_PROVIDER: "groq" }).modelProvider).toBe("groq");
    expect(getDemoConfig({ DEMO_MODEL_PROVIDER: "openrouter-free" }).modelProvider).toBe(
      "openrouter-free",
    );
    // A paid provider must NEVER be routable for anonymous traffic.
    expect(getDemoConfig({ DEMO_MODEL_PROVIDER: "openai" }).modelProvider).toBe(
      "openrouter-free",
    );
    expect(getDemoConfig({ DEMO_MODEL_PROVIDER: "bogus" }).modelProvider).toBe(
      "openrouter-free",
    );
  });
});

describe("isDemoAvailable", () => {
  it("is true by default, false when disabled or kill-switched", () => {
    expect(isDemoAvailable({})).toBe(true);
    expect(isDemoAvailable({ DEMO_ENABLED: "false" })).toBe(false);
    expect(isDemoAvailable({ DEMO_KILL_SWITCH: "1" })).toBe(false);
  });
});

describe("DEMO_LIMIT_MESSAGE", () => {
  it("is the exact spec copy", () => {
    expect(DEMO_LIMIT_MESSAGE).toBe("Sign up to keep building with LiTT.");
  });
});
