import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_CATALOG,
  ModelRegistry,
  createEnvCredentialResolver,
  envAccessorFromMap,
  EscalationTracker,
  classifyFailure,
  DEFAULT_ESCALATION_POLICY,
  intelligenceRank,
  isFallbackKind,
} from "../index.js";

// ─── Fixtures ──────────────────────────────────────────────────────

function allDirectEnv(): Record<string, string | undefined> {
  return {
    OPENAI_API_KEY: "test",
    ANTHROPIC_API_KEY: "test",
    GEMINI_API_KEY: "test",
    XAI_API_KEY: "test",
    DEEPSEEK_API_KEY: "test",
    MOONSHOT_API_KEY: "test",
    OPENROUTER_API_KEY: "test",
  };
}

function registry(env: Record<string, string | undefined> = allDirectEnv()): ModelRegistry {
  const r = new ModelRegistry(MODEL_CATALOG, createEnvCredentialResolver(envAccessorFromMap(env).get));
  for (const m of r.getAll()) r.markDiscovered(m.canonicalId, "online", "provider-catalog");
  return r;
}

// ─── classifyFailure ───────────────────────────────────────────────

describe("classifyFailure", () => {
  it("classifies rate limit errors", () => {
    assert.equal(classifyFailure(new Error("OpenRouter API error 429: rate limited")), "rate-limit");
  });

  it("classifies auth errors", () => {
    assert.equal(classifyFailure(new Error("401 Unauthorized")), "auth");
    assert.equal(classifyFailure(new Error("403 Forbidden")), "auth");
  });

  it("classifies network errors", () => {
    assert.equal(classifyFailure(new Error("network error: ECONNRESET")), "network");
    assert.equal(classifyFailure(new Error("503 service unavailable")), "network");
    assert.equal(classifyFailure(new Error("request timeout")), "network");
  });

  it("classifies tool errors", () => {
    assert.equal(classifyFailure(new Error("tool call failed: invalid arguments")), "tool");
  });

  it("classifies content errors", () => {
    assert.equal(classifyFailure(new Error("Invalid JSON response")), "content");
  });

  it("classifies non-Error as unknown", () => {
    assert.equal(classifyFailure("string error"), "unknown");
    assert.equal(classifyFailure(null), "unknown");
  });
});

// ─── isFallbackKind ────────────────────────────────────────────────

describe("isFallbackKind", () => {
  it("network/rate-limit/auth are fallback kinds", () => {
    assert.equal(isFallbackKind("network"), true);
    assert.equal(isFallbackKind("rate-limit"), true);
    assert.equal(isFallbackKind("auth"), true);
  });

  it("tool/reasoning/content are NOT fallback kinds (they escalate)", () => {
    assert.equal(isFallbackKind("tool"), false);
    assert.equal(isFallbackKind("reasoning"), false);
    assert.equal(isFallbackKind("content"), false);
  });
});

// ─── intelligenceRank ──────────────────────────────────────────────

describe("intelligenceRank", () => {
  it("frontier=3, balanced=2, light=1", () => {
    const frontier = MODEL_CATALOG.find((m) => m.intelligence === "frontier")!;
    const balanced = MODEL_CATALOG.find((m) => m.intelligence === "balanced")!;
    const light = MODEL_CATALOG.find((m) => m.intelligence === "light")!;
    assert.equal(intelligenceRank(frontier), 3);
    assert.equal(intelligenceRank(balanced), 2);
    assert.equal(intelligenceRank(light), 1);
  });
});

// ─── EscalationTracker ─────────────────────────────────────────────

describe("EscalationTracker", () => {
  it("starts a mission with a model", () => {
    const tracker = new EscalationTracker();
    const aff = tracker.startMission("m1", "gpt-5.6-luna");
    assert.equal(aff.missionId, "m1");
    assert.equal(aff.modelId, "gpt-5.6-luna");
    assert.equal(aff.consecutiveFailures, 0);
    assert.equal(aff.escalations.length, 0);
  });

  it("records failures and increments consecutive count", () => {
    const tracker = new EscalationTracker();
    tracker.startMission("m1", "gpt-5.6-luna");
    tracker.recordFailure("m1", "tool", "tool call failed");
    tracker.recordFailure("m1", "tool", "tool call failed again");
    const aff = tracker.getMission("m1")!;
    assert.equal(aff.consecutiveFailures, 2);
    assert.equal(aff.failures.length, 2);
  });

  it("does not increment consecutive count for non-counted kinds", () => {
    const tracker = new EscalationTracker();
    tracker.startMission("m1", "gpt-5.6-luna");
    // network/rate-limit/auth are not in countedKinds by default
    tracker.recordFailure("m1", "network");
    tracker.recordFailure("m1", "rate-limit");
    const aff = tracker.getMission("m1")!;
    assert.equal(aff.consecutiveFailures, 0, "network/rate-limit should not count toward escalation");
    assert.equal(aff.failures.length, 2, "but failures are still recorded");
  });

  it("recordSuccess resets consecutive failures", () => {
    const tracker = new EscalationTracker();
    tracker.startMission("m1", "gpt-5.6-luna");
    tracker.recordFailure("m1", "tool");
    tracker.recordFailure("m1", "tool");
    tracker.recordSuccess("m1");
    assert.equal(tracker.getMission("m1")!.consecutiveFailures, 0);
  });

  it("shouldEscalate is true after threshold consecutive failures", () => {
    const tracker = new EscalationTracker({ ...DEFAULT_ESCALATION_POLICY, threshold: 3 });
    tracker.startMission("m1", "gpt-5.6-luna");
    tracker.recordFailure("m1", "tool");
    tracker.recordFailure("m1", "tool");
    assert.equal(tracker.shouldEscalate("m1"), false);
    tracker.recordFailure("m1", "tool");
    assert.equal(tracker.shouldEscalate("m1"), true);
  });

  it("pickEscalatedModel selects a stronger verified model", () => {
    const r = registry();
    const tracker = new EscalationTracker({ ...DEFAULT_ESCALATION_POLICY, threshold: 2 });
    tracker.startMission("m1", "gpt-5.6-luna"); // balanced
    tracker.recordFailure("m1", "tool");
    tracker.recordFailure("m1", "tool");
    assert.equal(tracker.shouldEscalate("m1"), true);

    const pick = tracker.pickEscalatedModel("m1", r, "coding");
    assert.ok(pick);
    assert.notEqual(pick!.model.canonicalId, "gpt-5.6-luna");
    // Should be a stronger (frontier) model
    assert.equal(pick!.model.intelligence, "frontier");
    assert.ok(pick!.reason.includes("Escalated"));
  });

  it("pickEscalatedModel excludes already-tried models", () => {
    const r = registry();
    const tracker = new EscalationTracker({ ...DEFAULT_ESCALATION_POLICY, threshold: 1 });
    tracker.startMission("m1", "gpt-5.6-luna");
    tracker.recordFailure("m1", "tool");
    const firstPick = tracker.pickEscalatedModel("m1", r, "coding")!;
    tracker.commitEscalation("m1", firstPick.model.canonicalId, "escalated");
    tracker.recordFailure("m1", "tool"); // fail again on the escalated model
    const secondPick = tracker.pickEscalatedModel("m1", r, "coding")!;
    assert.notEqual(secondPick.model.canonicalId, firstPick.model.canonicalId);
    assert.notEqual(secondPick.model.canonicalId, "gpt-5.6-luna");
  });

  it("commitEscalation records the event and switches the model", () => {
    const tracker = new EscalationTracker();
    tracker.startMission("m1", "gpt-5.6-luna");
    const event = tracker.commitEscalation("m1", "gpt-5.6-sol", "3 tool failures", "run_123");
    assert.ok(event);
    assert.equal(event!.fromModelId, "gpt-5.6-luna");
    assert.equal(event!.toModelId, "gpt-5.6-sol");
    assert.equal(event!.missionId, "m1");
    assert.equal(event!.runId, "run_123");
    assert.equal(tracker.currentModel("m1"), "gpt-5.6-sol");
    assert.equal(tracker.getMission("m1")!.consecutiveFailures, 0);
    assert.equal(tracker.getMission("m1")!.escalations.length, 1);
  });

  it("endMission stops tracking", () => {
    const tracker = new EscalationTracker();
    tracker.startMission("m1", "gpt-5.6-luna");
    tracker.endMission("m1");
    assert.equal(tracker.getMission("m1"), null);
    assert.equal(tracker.currentModel("m1"), null);
  });

  it("allEscalations returns events across missions (for audit)", () => {
    const tracker = new EscalationTracker();
    tracker.startMission("m1", "gpt-5.6-luna");
    tracker.startMission("m2", "claude-sonnet-5");
    tracker.commitEscalation("m1", "gpt-5.6-sol", "failures");
    tracker.commitEscalation("m2", "claude-opus-5", "failures");
    const all = tracker.allEscalations();
    assert.equal(all.length, 2);
  });

  it("escalation after repeated failures continues same mission context", () => {
    // The tracker does NOT reset the mission — it switches the model and
    // continues. The mission id stays the same.
    const r = registry();
    const tracker = new EscalationTracker({ ...DEFAULT_ESCALATION_POLICY, threshold: 2 });
    tracker.startMission("m1", "gpt-5.6-luna");
    tracker.recordFailure("m1", "tool");
    tracker.recordFailure("m1", "tool");
    const pick = tracker.pickEscalatedModel("m1", r, "coding")!;
    tracker.commitEscalation("m1", pick.model.canonicalId, pick.reason);
    // Mission is still m1, just with a new model
    assert.equal(tracker.getMission("m1")!.missionId, "m1");
    assert.equal(tracker.currentModel("m1"), pick.model.canonicalId);
  });

  it("returns null for unknown mission", () => {
    const tracker = new EscalationTracker();
    assert.equal(tracker.getMission("unknown"), null);
    assert.equal(tracker.shouldEscalate("unknown"), false);
    assert.equal(tracker.recordFailure("unknown", "tool"), null);
    assert.equal(tracker.pickEscalatedModel("unknown", registry(), "coding"), null);
    assert.equal(tracker.commitEscalation("unknown", "x", "y"), null);
  });

  it("mission model affinity — currentModel reflects the active model", () => {
    const tracker = new EscalationTracker();
    tracker.startMission("m1", "gpt-5.6-luna");
    assert.equal(tracker.currentModel("m1"), "gpt-5.6-luna");
    tracker.commitEscalation("m1", "gpt-5.6-sol", "escalated");
    assert.equal(tracker.currentModel("m1"), "gpt-5.6-sol");
  });
});
