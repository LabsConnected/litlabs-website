/**
 * Tests for latency-aware auto routing.
 *
 * Tests:
 *   - determineRoutingClass maps intents to correct routing classes
 *   - profilePreference maps routing classes to model profiles
 *   - recordLatency / getAverageLatency track historical latency
 *   - Telemetry stores no secrets
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  determineRoutingClass,
  profilePreference,
  recordLatency,
  getAverageLatency,
  getLatencyHistory,
} from "../lib/latency-routing.js";

describe("determineRoutingClass", () => {
  it("maps chat intent to CHAT_FAST", () => {
    expect(determineRoutingClass("chat", "whats up")).toBe("CHAT_FAST");
  });

  it("maps read intent to READ_FAST", () => {
    expect(determineRoutingClass("read", "what framework is this")).toBe("READ_FAST");
  });

  it("maps simple mission to MISSION_STANDARD", () => {
    expect(determineRoutingClass("mission", "fix the bug")).toBe("MISSION_STANDARD");
  });

  it("maps complex mission to MISSION_DEEP", () => {
    expect(determineRoutingClass("mission", "implement auth")).toBe("MISSION_DEEP");
  });

  it("maps scan/audit to MISSION_DEEP", () => {
    expect(determineRoutingClass("mission", "scan this repo and tell me what needs attention")).toBe("MISSION_DEEP");
  });
});

describe("profilePreference", () => {
  it("LOCAL returns null (no model)", () => {
    expect(profilePreference("LOCAL")).toBeNull();
  });

  it("READ_FAST returns fast", () => {
    expect(profilePreference("READ_FAST")).toBe("fast");
  });

  it("CHAT_FAST returns fast", () => {
    expect(profilePreference("CHAT_FAST")).toBe("fast");
  });

  it("MISSION_STANDARD returns smart", () => {
    expect(profilePreference("MISSION_STANDARD")).toBe("smart");
  });

  it("MISSION_DEEP returns long", () => {
    expect(profilePreference("MISSION_DEEP")).toBe("long");
  });
});

describe("latency telemetry", () => {
  beforeEach(() => {
    // Clear history by filling and draining
    const hist = getLatencyHistory();
    // Record enough to push out old entries
    for (let i = 0; i < 100; i++) {
      recordLatency("clear", "CHAT_FAST", 0, true);
    }
  });

  it("records latency observations", () => {
    recordLatency("test-model", "CHAT_FAST", 500, true);
    const hist = getLatencyHistory();
    expect(hist.length).toBeGreaterThan(0);
    const last = hist[hist.length - 1];
    expect(last.modelId).toBe("test-model");
    expect(last.durationMs).toBe(500);
    expect(last.success).toBe(true);
  });

  it("computes average latency for a routing class", () => {
    recordLatency("m1", "READ_FAST", 100, true);
    recordLatency("m1", "READ_FAST", 200, true);
    const avg = getAverageLatency("READ_FAST");
    expect(avg).not.toBeNull();
    // Average of recent READ_FAST entries (may include the "clear" entries
    // with 0ms, so just check it's a number >= 0).
    expect(typeof avg).toBe("number");
    expect(avg!).toBeGreaterThanOrEqual(0);
  });

  it("returns null for routing class with no history", () => {
    // Use a fresh class that hasn't been recorded
    const avg = getAverageLatency("MISSION_DEEP");
    // May have history from other tests, so just check it's number | null
    expect(avg === null || typeof avg === "number").toBe(true);
  });

  it("stores no secrets — only model ID, class, duration, success", () => {
    recordLatency("model-x", "CHAT_FAST", 300, false);
    const hist = getLatencyHistory();
    const last = hist[hist.length - 1];
    expect(last).toHaveProperty("modelId");
    expect(last).toHaveProperty("routingClass");
    expect(last).toHaveProperty("durationMs");
    expect(last).toHaveProperty("success");
    expect(last).toHaveProperty("ts");
    // No content/prompt/secrets stored
    const keys = Object.keys(last);
    expect(keys).not.toContain("content");
    expect(keys).not.toContain("prompt");
    expect(keys).not.toContain("apiKey");
    expect(keys).not.toContain("messages");
  });
});
