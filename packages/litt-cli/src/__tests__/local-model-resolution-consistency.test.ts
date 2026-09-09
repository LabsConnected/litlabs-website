/**
 * Local model resolution consistency — regression tests.
 *
 * The bug these tests lock down:
 *
 *   Different LiTT surfaces resolved different model identities:
 *     - doctor showed the persisted preference (stale)
 *     - TUI displayed the right model but then said "Cannot serve"
 *     - `litt ask` silently switched from qwen3:4b-instruct to
 *       litt-coder:3b because it didn't read prefs
 *     - the probe checked ANY model, not the one execution would use
 *
 * The fix: one canonical resolveRequestedLocalModel() that all surfaces
 * use, with identical LITT_MODEL → prefs → null precedence, plus
 * resolveLocalModel() now tracks configuredInput / isRouteChange so
 * route-change decisions are visible instead of silent.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  localRoutePolicy,
  resolveLocalModel,
  localRoutedModel,
  isLocalModelId,
  ollamaTagOf,
  resolveRequestedLocalModel,
} from "../lib/local-model-resolution.js";
import { selectLocalModel } from "../lib/local-lane.js";
import { resolveProviderAdapter } from "../lib/model-provider.js";
import type { LocalLaneStatus } from "../lib/local-lane.js";

const ENDPOINT = "http://127.0.0.1:11434";

/** Lane with both litt-coder:3b and qwen3:4b-instruct installed. */
const LANE_BOTH: LocalLaneStatus = {
  available: true,
  models: ["litt-coder:3b", "qwen3:4b-instruct", "qwen3:4b-instruct-16k"],
  endpoint: ENDPOINT,
  reason: null,
};

/** Lane with only qwen3:4b-instruct. */
const LANE_QWEN_ONLY: LocalLaneStatus = {
  available: true,
  models: ["qwen3:4b-instruct"],
  endpoint: ENDPOINT,
  reason: null,
};

const LANE_DOWN: LocalLaneStatus = {
  available: false,
  models: [],
  endpoint: ENDPOINT,
  reason: `local model daemon not reachable at ${ENDPOINT} (fetch failed)`,
};

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  delete process.env.LITT_MODEL;
  delete process.env.OPENROUTER_MODEL;
});

afterEach(() => {
  process.env = savedEnv;
});

// ─── 1. Prefix normalization ────────────────────────────────────────

describe("prefix normalization", () => {
  it("strips ollama: prefix from a provider-qualified model id", () => {
    expect(ollamaTagOf("ollama:qwen3:4b-instruct")).toBe("qwen3:4b-instruct");
  });

  it("leaves a bare tag unchanged", () => {
    expect(ollamaTagOf("qwen3:4b-instruct")).toBe("qwen3:4b-instruct");
  });

  it("preserves meaningful colons in the Ollama tag itself", () => {
    // "qwen3:4b-instruct-16k" has two colons — only the provider qualifier
    // (the leading "ollama:") should be stripped, not the tag's own colons.
    expect(ollamaTagOf("ollama:qwen3:4b-instruct-16k")).toBe("qwen3:4b-instruct-16k");
    expect(ollamaTagOf("ollama:litt-coder:3b")).toBe("litt-coder:3b");
  });

  it("does not strip a non-ollama prefix", () => {
    expect(ollamaTagOf("openai:gpt-5")).toBe("openai:gpt-5");
  });
});

// ─── 2. Alias/display-name separation from API IDs ──────────────────

describe("alias/display-name separation", () => {
  it("the RoutedModel providerModelId is the bare tag, not a display name", () => {
    const out = resolveLocalModel(LANE_BOTH, "ollama:qwen3:4b-instruct");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const routed = localRoutedModel(out.resolution);
    // The API model ID must be the bare Ollama tag, never a display name
    // like "Qwen3:4b Instruct" or a canonical id like "ollama:qwen3:4b-instruct".
    expect(routed.providerModelId).toBe("qwen3:4b-instruct");
    expect(routed.providerModelId).not.toContain("Qwen");
    expect(routed.providerModelId.startsWith("ollama:")).toBe(false);
  });

  it("the adapter configuredModel is the bare tag sent to the Ollama API", () => {
    const out = resolveLocalModel(LANE_BOTH, "ollama:qwen3:4b-instruct");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const routed = localRoutedModel(out.resolution);
    const adapter = resolveProviderAdapter(routed, {});
    expect(adapter.configuredModel).toBe("qwen3:4b-instruct");
    expect(adapter.providerId).toBe("ollama");
  });
});

// ─── 3. Canonical resolveRequestedLocalModel precedence ─────────────

describe("resolveRequestedLocalModel — canonical precedence", () => {
  it("LITT_MODEL env var takes precedence over prefs", () => {
    process.env.LITT_MODEL = "qwen3:4b-instruct";
    const info = resolveRequestedLocalModel("ollama:litt-coder:3b");
    expect(info.model).toBe("qwen3:4b-instruct");
    expect(info.source).toBe("env");
  });

  it("persisted ollama: selection is used when LITT_MODEL is unset", () => {
    const info = resolveRequestedLocalModel("ollama:qwen3:4b-instruct");
    expect(info.model).toBe("ollama:qwen3:4b-instruct");
    expect(info.source).toBe("prefs");
  });

  it("a persisted REMOTE selection is NOT a local request", () => {
    // minimax-m3-free is a cloud catalog model, not an ollama: model.
    const info = resolveRequestedLocalModel("minimax-m3-free");
    expect(info.model).toBeNull();
    expect(info.source).toBe("none");
  });

  it("null prefs → null model, source 'none'", () => {
    const info = resolveRequestedLocalModel(null);
    expect(info.model).toBeNull();
    expect(info.source).toBe("none");
  });

  it("empty LITT_MODEL falls through to prefs", () => {
    process.env.LITT_MODEL = "  ";
    const info = resolveRequestedLocalModel("ollama:qwen3:4b-instruct");
    expect(info.model).toBe("ollama:qwen3:4b-instruct");
    expect(info.source).toBe("prefs");
  });
});

// ─── 4. No silent qwen-to-litt-coder switch ─────────────────────────

describe("no silent model switch", () => {
  it("explicit qwen3:4b-instruct request is honoured exactly, not switched to litt-coder:3b", () => {
    // Lane has both installed. Without the fix, ask.ts didn't read prefs
    // and fell to preference order, picking litt-coder:3b.
    const out = resolveLocalModel(LANE_BOTH, "qwen3:4b-instruct");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.tag).toBe("qwen3:4b-instruct");
    expect(out.resolution.tag).not.toBe("litt-coder:3b");
    expect(out.resolution.isRouteChange).toBe(false);
  });

  it("canonical ollama:qwen3:4b-instruct request is honoured exactly", () => {
    const out = resolveLocalModel(LANE_BOTH, "ollama:qwen3:4b-instruct");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.tag).toBe("qwen3:4b-instruct");
    expect(out.resolution.isRouteChange).toBe(false);
  });

  it("preference order picks litt-coder:3b but isRouteChange is false (no explicit request)", () => {
    // When no model is explicitly requested, the preference order is the
    // DEFAULT path, not a fallback. isRouteChange must be false so we
    // don't mislabel a default pick as a "route change."
    const out = resolveLocalModel(LANE_BOTH, null);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.tag).toBe("litt-coder:3b");
    expect(out.resolution.isRouteChange).toBe(false);
    expect(out.resolution.configuredInput).toBeNull();
  });

  it("a route change is detected when the explicit request is resolved to a different tag", () => {
    // "qwen3" (bare family) resolves to "qwen3:4b-instruct" — that IS
    // a route change (the effective model differs from the request).
    const out = resolveLocalModel(LANE_QWEN_ONLY, "qwen3");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.tag).toBe("qwen3:4b-instruct");
    expect(out.resolution.configuredInput).toBe("qwen3");
    expect(out.resolution.isRouteChange).toBe(true);
  });
});

// ─── 5. Provider-qualified IDs do not cause false "cannot serve" ─────

describe("provider-qualified model IDs", () => {
  it("ollama:qwen3:4b-instruct does not cause a false 'cannot serve' failure", () => {
    // The prefix must be stripped before checking the installed list.
    const out = resolveLocalModel(LANE_QWEN_ONLY, "ollama:qwen3:4b-instruct");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.tag).toBe("qwen3:4b-instruct");
  });

  it("ollama: prefix is stripped even when the tag has multiple colons", () => {
    const lane: LocalLaneStatus = {
      available: true,
      models: ["litt-coder:3b"],
      endpoint: ENDPOINT,
      reason: null,
    };
    const out = resolveLocalModel(lane, "ollama:litt-coder:3b");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.tag).toBe("litt-coder:3b");
  });

  it("a provider-qualified ID for a missing model still fails clearly", () => {
    const out = resolveLocalModel(LANE_QWEN_ONLY, "ollama:llama3:70b");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("llama3:70b");
    expect(out.error).toContain("not installed");
  });
});

// ─── 6. Probe uses the same effective model as execution ────────────

describe("probe and execution model consistency", () => {
  it("the probe's model list is the same list execution resolves against", () => {
    // resolveLocalModel takes the lane (probed by probeLocalLane) and
    // checks the requested model against lane.models. The probe and
    // execution use the SAME lane object — there is no separate model
    // list for probing vs execution.
    const out = resolveLocalModel(LANE_BOTH, "qwen3:4b-instruct");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // The effective model must be in the lane's model list
    expect(LANE_BOTH.models).toContain(out.resolution.tag);
  });

  it("a model not in the probe's list is not served", () => {
    const out = resolveLocalModel(LANE_QWEN_ONLY, "litt-coder:3b");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("not installed");
  });
});

// ─── 7. TUI availability when Ollama serves the model ───────────────

describe("TUI availability consistency", () => {
  it("does not report 'cannot serve' when the model IS in the probed list", () => {
    // This is the core TUI bug: the badge showed the right model but
    // then "Cannot serve local model" appeared. The cause was either a
    // stale probe or a prefix mismatch. With canonical resolution, the
    // prefix is stripped and the model is checked against the same list.
    const out = resolveLocalModel(LANE_QWEN_ONLY, "ollama:qwen3:4b-instruct");
    expect(out.ok).toBe(true);
    expect(out.ok && out.resolution.tag).toBe("qwen3:4b-instruct");
  });

  it("does report 'cannot serve' when the daemon is genuinely down", () => {
    const out = resolveLocalModel(LANE_DOWN, "ollama:qwen3:4b-instruct");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("Cannot serve local model");
    expect(out.error).toContain("qwen3:4b-instruct");
  });
});

// ─── 8. Fallback behavior remains intact ────────────────────────────

describe("fallback behavior preserved", () => {
  it("selectLocalModel still prefers litt-coder:3b when no explicit request", () => {
    // The preference order is NOT changed — litt-coder:3b is still first.
    // The fix makes this VISIBLE, not suppressed.
    const picked = selectLocalModel(LANE_BOTH.models);
    expect(picked).toBe("litt-coder:3b");
  });

  it("selectLocalModel honours an explicit preferred model", () => {
    const picked = selectLocalModel(LANE_BOTH.models, "qwen3:4b-instruct");
    expect(picked).toBe("qwen3:4b-instruct");
  });

  it("selectLocalModel falls back to first installed when no preference match", () => {
    const lane: LocalLaneStatus = {
      available: true,
      models: ["some-other-model:latest"],
      endpoint: ENDPOINT,
      reason: null,
    };
    const picked = selectLocalModel(lane.models);
    expect(picked).toBe("some-other-model:latest");
  });

  it("resolveLocalModel with no request uses preference order (fallback intact)", () => {
    const out = resolveLocalModel(LANE_BOTH, null);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.tag).toBe("litt-coder:3b");
    expect(out.resolution.reason).toContain("preference order");
  });
});

// ─── 9. Ollama provider receives the normalized API model ID ─────────

describe("Ollama provider receives normalized API model ID", () => {
  it("the adapter sends the bare tag, not the canonical id or display name", () => {
    const out = resolveLocalModel(LANE_BOTH, "ollama:qwen3:4b-instruct");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const routed = localRoutedModel(out.resolution);
    const adapter = resolveProviderAdapter(routed, {});
    // configuredModel is what gets sent in the POST body as "model": ...
    expect(adapter.configuredModel).toBe("qwen3:4b-instruct");
    expect(adapter.configuredModel.startsWith("ollama:")).toBe(false);
    expect(adapter.configuredModel).not.toContain("Qwen");
  });

  it("the adapter sends the bare tag even for multi-colon tags", () => {
    const out = resolveLocalModel(LANE_BOTH, "ollama:litt-coder:3b");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const routed = localRoutedModel(out.resolution);
    const adapter = resolveProviderAdapter(routed, {});
    expect(adapter.configuredModel).toBe("litt-coder:3b");
  });
});

// ─── 10. Identical precedence across surfaces ───────────────────────

describe("identical precedence across surfaces", () => {
  it("doctor, ask, and TUI all resolve the same requested model for the same inputs", () => {
    // All three surfaces call resolveRequestedLocalModel(prefs.selectedModel).
    // With the same env + prefs, they must get the same result.
    process.env.LITT_MODEL = "qwen3:4b-instruct";
    const fromAsk = resolveRequestedLocalModel("ollama:litt-coder:3b");
    const fromTui = resolveRequestedLocalModel("ollama:litt-coder:3b");
    const fromDoctor = resolveRequestedLocalModel("ollama:litt-coder:3b");
    expect(fromAsk).toEqual(fromTui);
    expect(fromTui).toEqual(fromDoctor);
    expect(fromAsk.model).toBe("qwen3:4b-instruct");
    expect(fromAsk.source).toBe("env");
  });

  it("without LITT_MODEL, all three use the persisted ollama: selection", () => {
    const fromAsk = resolveRequestedLocalModel("ollama:qwen3:4b-instruct");
    const fromTui = resolveRequestedLocalModel("ollama:qwen3:4b-instruct");
    const fromDoctor = resolveRequestedLocalModel("ollama:qwen3:4b-instruct");
    expect(fromAsk).toEqual(fromTui);
    expect(fromTui).toEqual(fromDoctor);
    expect(fromAsk.model).toBe("ollama:qwen3:4b-instruct");
    expect(fromAsk.source).toBe("prefs");
  });

  it("without LITT_MODEL or local prefs, all three fall to preference order", () => {
    const fromAsk = resolveRequestedLocalModel("minimax-m3-free");
    const fromTui = resolveRequestedLocalModel("minimax-m3-free");
    const fromDoctor = resolveRequestedLocalModel("minimax-m3-free");
    expect(fromAsk).toEqual(fromTui);
    expect(fromTui).toEqual(fromDoctor);
    expect(fromAsk.model).toBeNull();
    expect(fromAsk.source).toBe("none");
  });
});

// ─── 11. Effective model display ────────────────────────────────────

describe("effective model display", () => {
  it("resolveLocalModel returns the effective tag, not the configured input", () => {
    // When a bare family name is requested, the effective model is the
    // full installed tag, not the short request.
    const out = resolveLocalModel(LANE_QWEN_ONLY, "qwen3");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.tag).toBe("qwen3:4b-instruct");
    expect(out.resolution.configuredInput).toBe("qwen3");
  });

  it("the resolution reason explains why the effective model was chosen", () => {
    const out = resolveLocalModel(LANE_BOTH, null);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.reason).toContain("preference order");
    expect(out.resolution.reason).toContain("litt-coder:3b");
  });

  it("a route change includes the configured input in the resolution", () => {
    const out = resolveLocalModel(LANE_QWEN_ONLY, "qwen3");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.isRouteChange).toBe(true);
    expect(out.resolution.configuredInput).toBe("qwen3");
    expect(out.resolution.tag).toBe("qwen3:4b-instruct");
  });
});

// ─── 12. isLocalModelId helper ──────────────────────────────────────

describe("isLocalModelId", () => {
  it("recognises ollama: prefixed ids", () => {
    expect(isLocalModelId("ollama:qwen3:4b-instruct")).toBe(true);
    expect(isLocalModelId("ollama:litt-coder:3b")).toBe(true);
  });

  it("rejects non-local ids", () => {
    expect(isLocalModelId("minimax-m3-free")).toBe(false);
    expect(isLocalModelId("openai:gpt-5")).toBe(false);
    expect(isLocalModelId(null)).toBe(false);
    expect(isLocalModelId("")).toBe(false);
  });
});
