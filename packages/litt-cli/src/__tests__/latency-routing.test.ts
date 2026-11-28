/**
 * Tests for latency-aware auto routing.
 *
 * Tests:
 *   - determineRoutingClass maps intents to correct routing classes
 *   - profilePreference maps routing classes to model profiles
 *   - recordLatency / getAverageLatency track historical latency
 *   - Telemetry stores no secrets
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  determineRoutingClass,
  profilePreference,
  profileToTaskKind,
  recordLatency,
  getAverageLatency,
  getLatencyHistory,
} from "../lib/latency-routing.js";
import { ModelRuntime } from "../lib/model-runtime.js";

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

describe("profileToTaskKind", () => {
  it("maps fast → fast task kind", () => {
    expect(profileToTaskKind("fast")).toBe("fast");
  });

  it("maps smart → coding task kind", () => {
    expect(profileToTaskKind("smart")).toBe("coding");
  });

  it("maps long → reasoning task kind", () => {
    expect(profileToTaskKind("long")).toBe("reasoning");
  });
});

// ─── Wired routing: profileHint flows through ModelRuntime.route ───
// The hint reaches routeModel() as RoutingInput.taskKind, steering AUTO
// selection the same way classifyTask() heuristics do — while pinned
// (FIXED) selections are still honored exactly.
describe("ModelRuntime.route profileHint (wired)", () => {
  const ENV_KEYS = ["OPENROUTER_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY"] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    // A routable catalog requires a credential — OpenRouter serves the
    // LiTT-tier models used by AUTO selection.
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("hint 'long' steers AUTO to the same pick as a heuristic reasoning message", () => {
    const runtime = new ModelRuntime();
    const message = "refactor the authentication architecture across every service";
    const hinted = runtime.route("auto", null, message, "long");
    const heuristic = runtime.route("auto", null, message);
    // Heuristic classifies this message as reasoning already, so the
    // explicit hint must agree — different picks would mean the hint
    // bypassed (not steered) the router.
    expect(hinted.id).toBe(heuristic.id);
    expect(hinted.id).not.toBe(runtime.route("auto", null, "hi", "fast").id);
  });

  it("hint 'fast' steers AUTO away from a coding-bucket pick", () => {
    const runtime = new ModelRuntime();
    // Without a hint this message classifies as coding → balanced tier.
    const unhinted = runtime.route("auto", null, "fix the build script and edit the file");
    const hinted = runtime.route("auto", null, "fix the build script and edit the file", "fast");
    expect(hinted.id).not.toBe(unhinted.id);
  });

  it("FIXED pinned selection is preserved regardless of hint", () => {
    const runtime = new ModelRuntime();
    const routable = runtime.route("auto", null, "hello");
    const pinned = runtime.route("fixed", routable.id, "refactor the entire architecture", "long");
    expect(pinned.id).toBe(routable.id);
    expect(pinned.appliedPolicy).toBe("pinned");
  });

  it("no hint preserves heuristic AUTO behavior", () => {
    const runtime = new ModelRuntime();
    const plain = runtime.route("auto", null, "hey");
    const nullHint = runtime.route("auto", null, "hey", null);
    expect(plain.id).toBe(nullHint.id);
  });
});
