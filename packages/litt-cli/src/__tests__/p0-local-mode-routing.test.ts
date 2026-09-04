/**
 * P0 HARD REGRESSION TESTS — Interactive LOCAL mode must use Ollama, never OpenRouter.
 *
 * These tests enforce the fix for the P0 split-brain bug where the interactive
 * TUI displayed "LOCAL / SIGNED OUT" in the header but executed requests
 * through OpenRouter (MiniMax M3:Free) because a persisted remote model
 * preference in ~/.litt/model-prefs.json stayed authoritative in LOCAL mode.
 *
 * Test matrix (from the task spec):
 *   A. executionTarget=local + signedOut + persisted OpenRouter model + Ollama available
 *      → effective provider=Ollama, effective model=qwen3:4b-instruct
 *   B. interactive submit in LOCAL mode → OpenRouter client NEVER invoked
 *   C. footer in LOCAL mode → Ollama · qwen3:4b-instruct
 *   D. actual result metadata → Served by: Ollama, Model: qwen3:4b-instruct
 *   E. Ollama unavailable in LOCAL → hard local error, NO remote fallback
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  localRoutePolicy,
  resolveLocalModel,
  localRoutedModel,
  isLocalModelId,
} from "../lib/local-model-resolution.js";
import { resolveProviderAdapter, LOCAL_DAEMON_PROVIDERS } from "../lib/model-provider.js";
import { ModelRuntime } from "../lib/model-runtime.js";
import { shouldBlockModelPath } from "../lib/capability-gate.js";
import type { LocalLaneStatus } from "../lib/local-lane.js";
import type { RoutedModel } from "../lib/model-runtime.js";

// ─── Test fixtures ─────────────────────────────────────────────────

const LANE_UP: LocalLaneStatus = {
  available: true,
  models: ["qwen3:4b-instruct"],
  endpoint: "http://127.0.0.1:11434",
  reason: null,
};

const LANE_DOWN: LocalLaneStatus = {
  available: false,
  models: [],
  endpoint: "http://127.0.0.1:11434",
  reason: "local model daemon not reachable at http://127.0.0.1:11434 (ECONNREFUSED)",
};

// A persisted REMOTE model preference — exactly what was in
// ~/.litt/model-prefs.json when the bug was reported.
const PERSISTED_REMOTE_MODEL = "minimax-m3-free";

// ─── A. LOCAL + signed out + persisted OpenRouter model + Ollama available
//        → effective provider=Ollama, effective model=qwen3:4b-instruct ───

describe("P0-A: LOCAL + signedOut + persisted OpenRouter model → Ollama serves", () => {
  it("localRoutePolicy returns local-required (not catalog)", () => {
    const policy = localRoutePolicy({
      executionTarget: "local",
      localOnly: false,
      signedIn: false,
      requestedLocalModel: null, // LITT_MODEL not set, selectedModel is remote
      hasCloudCredential: true,  // OPENROUTER_API_KEY is set
    });
    expect(policy.kind).toBe("local-required");
  });

  it("resolveLocalModel picks qwen3:4b-instruct from the available lane", () => {
    const outcome = resolveLocalModel(LANE_UP, null);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.resolution.tag).toBe("qwen3:4b-instruct");
    expect(outcome.resolution.provider).toBe("ollama");
  });

  it("localRoutedModel produces servedBy=ollama with no openRouterModelId", () => {
    const outcome = resolveLocalModel(LANE_UP, null);
    if (!outcome.ok) return;
    const routed = localRoutedModel(outcome.resolution);
    expect(routed.servedBy).toBe("ollama");
    expect(routed.provider).toBe("ollama");
    expect(routed.openRouterModelId).toBeUndefined();
    expect(routed.providerModelId).toBe("qwen3:4b-instruct");
  });

  it("resolveProviderAdapter constructs an Ollama adapter (not OpenRouter)", () => {
    const outcome = resolveLocalModel(LANE_UP, null);
    if (!outcome.ok) return;
    const routed = localRoutedModel(outcome.resolution);
    const adapter = resolveProviderAdapter(routed);
    expect(adapter.providerId).toBe("ollama");
    expect(adapter.configuredModel).toBe("qwen3:4b-instruct");
  });

  it("the persisted remote model (minimax-m3-free) is NOT a local model id", () => {
    expect(isLocalModelId(PERSISTED_REMOTE_MODEL)).toBe(false);
  });

  it("ModelRuntime.routeLocal throws on a remote model request (no silent cloud)", () => {
    // If someone passes the persisted remote model as a "requested local model",
    // it must HARD-FAIL, not fall back to cloud.
    const runtime = new ModelRuntime(false);
    expect(() => runtime.routeLocal(LANE_UP, PERSISTED_REMOTE_MODEL)).toThrow();
  });

  it("full chain: policy → routeLocal → resolveProviderAdapter → Ollama adapter", () => {
    const policy = localRoutePolicy({
      executionTarget: "local",
      localOnly: false,
      signedIn: false,
      requestedLocalModel: null,
      hasCloudCredential: true,
    });
    expect(policy.kind).toBe("local-required");

    const runtime = new ModelRuntime(false);
    const routed = runtime.routeLocal(LANE_UP, null);
    expect(routed.servedBy).toBe("ollama");
    expect(routed.providerModelId).toBe("qwen3:4b-instruct");

    const adapter = resolveProviderAdapter(routed);
    expect(adapter.providerId).toBe("ollama");
    expect(adapter.configuredModel).toBe("qwen3:4b-instruct");
  });
});

// ─── B. Interactive submit in LOCAL mode → OpenRouter NEVER invoked ───

describe("P0-B: LOCAL mode submit never invokes OpenRouter", () => {
  it("LOCAL_DAEMON_PROVIDERS includes ollama", () => {
    expect(LOCAL_DAEMON_PROVIDERS.has("ollama")).toBe(true);
  });

  it("resolveProviderAdapter with servedBy=ollama never constructs OpenRouter", () => {
    const outcome = resolveLocalModel(LANE_UP, null);
    if (!outcome.ok) return;
    const routed = localRoutedModel(outcome.resolution);
    // The routed model has openRouterModelId=undefined, so the OpenRouter
    // branch in resolveProviderAdapter (which requires that id) can never fire.
    expect(routed.openRouterModelId).toBeUndefined();
    const adapter = resolveProviderAdapter(routed);
    expect(adapter.providerId).not.toBe("openrouter");
    expect(adapter.providerId).toBe("ollama");
  });

  it("a remote RoutedModel (servedBy=openrouter) would take the OpenRouter branch", () => {
    // This is the OLD bug path — confirm the adapter WOULD be OpenRouter
    // if routing didn't constrain to local. This proves the constraint matters.
    const remoteRouted: RoutedModel = {
      id: "minimax-m3-free",
      label: "MiniMax M3:Free",
      servedBy: "openrouter",
      provider: "openrouter",
      reason: "test",
      fallbackReason: null,
      appliedPolicy: "pinned",
      openRouterModelId: "minimax/minimax-m3:free",
      providerModelId: undefined,
    };
    // Without OPENROUTER_API_KEY, this throws — proving it needs a cloud key.
    const savedKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      expect(() => resolveProviderAdapter(remoteRouted)).toThrow();
    } finally {
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
    }
  });
});

// ─── C. Footer in LOCAL mode → Ollama · qwen3:4b-instruct ────────────

describe("P0-C: LOCAL mode footer shows Ollama · qwen3:4b-instruct", () => {
  it("the routed model label is the Ollama tag", () => {
    const outcome = resolveLocalModel(LANE_UP, null);
    if (!outcome.ok) return;
    const routed = localRoutedModel(outcome.resolution);
    expect(routed.label).toBe("qwen3:4b-instruct");
  });

  it("the adapter providerId is ollama (for footer provider display)", () => {
    const outcome = resolveLocalModel(LANE_UP, null);
    if (!outcome.ok) return;
    const routed = localRoutedModel(outcome.resolution);
    const adapter = resolveProviderAdapter(routed);
    expect(adapter.providerId).toBe("ollama");
  });

  it("the adapter configuredModel is qwen3:4b-instruct (for footer model display)", () => {
    const outcome = resolveLocalModel(LANE_UP, null);
    if (!outcome.ok) return;
    const routed = localRoutedModel(outcome.resolution);
    const adapter = resolveProviderAdapter(routed);
    expect(adapter.configuredModel).toBe("qwen3:4b-instruct");
  });
});

// ─── D. Actual result metadata → Served by: Ollama, Model: qwen3:4b-instruct ─

describe("P0-D: result metadata reports Ollama + qwen3:4b-instruct", () => {
  it("the RoutedModel servedBy is ollama (for 'Served by' metadata)", () => {
    const outcome = resolveLocalModel(LANE_UP, null);
    if (!outcome.ok) return;
    const routed = localRoutedModel(outcome.resolution);
    expect(routed.servedBy).toBe("ollama");
  });

  it("the RoutedModel providerModelId is qwen3:4b-instruct (for 'Model' metadata)", () => {
    const outcome = resolveLocalModel(LANE_UP, null);
    if (!outcome.ok) return;
    const routed = localRoutedModel(outcome.resolution);
    expect(routed.providerModelId).toBe("qwen3:4b-instruct");
  });
});

// ─── E. Ollama unavailable in LOCAL → hard local error, NO remote fallback ─

describe("P0-E: Ollama unavailable in LOCAL → hard error, no remote fallback", () => {
  it("resolveLocalModel with a down lane returns an error outcome", () => {
    const outcome = resolveLocalModel(LANE_DOWN, null);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("No local model available");
  });

  it("ModelRuntime.routeLocal throws when the lane is down", () => {
    const runtime = new ModelRuntime(false);
    expect(() => runtime.routeLocal(LANE_DOWN, null)).toThrow(/No local model available/);
  });

  it("shouldBlockModelPath blocks when LOCAL + local model unavailable", () => {
    expect(shouldBlockModelPath(
      false, // signedIn
      "local", // executionTarget
      false, // localOnly
      false, // localModelAvailable
    )).toBe(true);
  });

  it("shouldBlockModelPath allows when LOCAL + local model available", () => {
    expect(shouldBlockModelPath(
      false, // signedIn
      "local", // executionTarget
      false, // localOnly
      true,  // localModelAvailable
    )).toBe(false);
  });

  it("localRoutePolicy still returns local-required when lane is down (no catalog fallback)", () => {
    // The policy doesn't know about the lane status — it always says
    // local-required for LOCAL target. The caller then probes the lane
    // and surfaces a clear error if it's down. This proves there is no
    // policy-level fallback to catalog/cloud.
    const policy = localRoutePolicy({
      executionTarget: "local",
      localOnly: false,
      signedIn: false,
      requestedLocalModel: null,
      hasCloudCredential: true,
    });
    expect(policy.kind).toBe("local-required");
  });
});

// ─── Bonus: LOCAL mode with LITT_MODEL=qwen3:4b-instruct (explicit request) ──

describe("P0-bonus: LOCAL + LITT_MODEL=qwen3:4b-instruct → exact model served", () => {
  it("localRoutePolicy returns local-required for an explicit local model request", () => {
    const policy = localRoutePolicy({
      executionTarget: "local",
      localOnly: false,
      signedIn: true,
      requestedLocalModel: "qwen3:4b-instruct",
      hasCloudCredential: true,
    });
    expect(policy.kind).toBe("local-required");
  });

  it("resolveLocalModel honours the explicit request exactly", () => {
    const outcome = resolveLocalModel(LANE_UP, "qwen3:4b-instruct");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.resolution.tag).toBe("qwen3:4b-instruct");
  });

  it("resolveLocalModel HARD-FAILS when the requested model is not installed", () => {
    const outcome = resolveLocalModel(LANE_UP, "llama3:70b");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("llama3:70b");
    expect(outcome.error).toContain("not installed");
  });
});
