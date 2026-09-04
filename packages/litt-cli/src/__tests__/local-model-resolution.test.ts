/**
 * LOCAL execution target — provider/model resolution.
 *
 * The regression these tests lock down:
 *
 *   Header said LOCAL / SIGNED OUT. Ollama was up with qwen3:4b-instruct
 *   installed. The footer still read "MiniMax M3 (Free)" — a persisted
 *   REMOTE selection — and a chat turn came back with the cloud-auth
 *   capability-gate message.
 *
 * Root cause: nothing in the routing path consulted executionTarget.
 * ModelRuntime.route() resolves (routingMode, selectedModel) against the
 * cloud catalog, so a persisted remote model stayed authoritative in
 * LOCAL mode and the request ended at a cloud/BYOK auth error for a lane
 * that needs no auth.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  localRoutePolicy,
  resolveLocalModel,
  localRoutedModel,
  isLocalModelId,
  ollamaTagOf,
} from "../lib/local-model-resolution.js";
import { shouldBlockModelPath } from "../lib/capability-gate.js";
import { ModelRuntime } from "../lib/model-runtime.js";
import { resolveProviderAdapter } from "../lib/model-provider.js";
import type { LocalLaneStatus } from "../lib/local-lane.js";

const ENDPOINT = "http://127.0.0.1:11434";

/** The operator's real lane: Ollama up, qwen3:4b-instruct installed. */
const LANE_UP: LocalLaneStatus = {
  available: true,
  models: ["qwen3:4b-instruct", "qwen3:4b-instruct-16k"],
  endpoint: ENDPOINT,
  reason: null,
};

const LANE_DOWN: LocalLaneStatus = {
  available: false,
  models: [],
  endpoint: ENDPOINT,
  reason: `local model daemon not reachable at ${ENDPOINT} (fetch failed)`,
};

/** The persisted remote selection that was wrongly staying authoritative. */
const PERSISTED_REMOTE = "minimax-m3-free";

// ─── 1. Policy: which lane must serve? ──────────────────────────────

describe("localRoutePolicy — the LOCAL/signed-out matrix", () => {
  it("LOCAL + signed out + no cloud credential → the local daemon must serve", () => {
    expect(localRoutePolicy({
      executionTarget: "local",
      localOnly: false,
      signedIn: false,
      requestedLocalModel: null,
      hasCloudCredential: false,
    })).toMatchObject({ kind: "local-required" });
  });

  it("local-only (LITT_LOCAL_MODE=1) → the local daemon must serve, cloud key or not", () => {
    // LOCAL_ONLY_GATE_MESSAGE promises the local server "remains
    // available" while cloud is blocked. Honouring a BYOK key here would
    // break that promise.
    expect(localRoutePolicy({
      executionTarget: "local",
      localOnly: true,
      signedIn: false,
      requestedLocalModel: null,
      hasCloudCredential: true,
    })).toMatchObject({ kind: "local-required" });
  });

  it("an explicitly requested local model is never reinterpreted", () => {
    expect(localRoutePolicy({
      executionTarget: "local",
      localOnly: false,
      signedIn: true,
      requestedLocalModel: "qwen3:4b-instruct",
      hasCloudCredential: true,
    })).toMatchObject({ kind: "local-required" });
  });

  it("LOCAL + signed in → local daemon is the only provider lane (no BYOK in LOCAL)", () => {
    // P0 fix: LOCAL mode must NEVER call OpenRouter or any other remote
    // provider, even when the user is signed in or has a BYOK key.
    // The local daemon (Ollama/LM Studio) is the only lane.
    expect(localRoutePolicy({
      executionTarget: "local",
      localOnly: false,
      signedIn: true,
      requestedLocalModel: null,
      hasCloudCredential: true,
    })).toMatchObject({ kind: "local-required" });
  });

  it("LOCAL + signed out WITH a BYOK key → local daemon (no silent cloud fallback)", () => {
    // P0 fix: A BYOK key does NOT make cloud routing available in LOCAL
    // mode. The persisted remote preference stays in the store for /remote
    // use, but LOCAL always routes to the local daemon.
    expect(localRoutePolicy({
      executionTarget: "local",
      localOnly: false,
      signedIn: false,
      requestedLocalModel: null,
      hasCloudCredential: true,
    })).toMatchObject({ kind: "local-required" });
  });

  it("REMOTE target is never forced local", () => {
    for (const localOnly of [false]) {
      expect(localRoutePolicy({
        executionTarget: "remote",
        localOnly,
        signedIn: false,
        requestedLocalModel: "qwen3:4b-instruct",
        hasCloudCredential: false,
      })).toEqual({ kind: "catalog" });
    }
  });

  it("unresolved auth (null) in LOCAL → local daemon (LOCAL is always local-required)", () => {
    // P0 fix: Regardless of auth state, LOCAL mode always requires the
    // local daemon. Auth resolution does not change the provider lane.
    expect(localRoutePolicy({
      executionTarget: "local",
      localOnly: false,
      signedIn: null,
      requestedLocalModel: null,
      hasCloudCredential: false,
    })).toMatchObject({ kind: "local-required" });
  });
});

// ─── 2. Which installed model serves? ───────────────────────────────

describe("resolveLocalModel", () => {
  it("honours an explicitly requested installed model exactly", () => {
    const out = resolveLocalModel(LANE_UP, "qwen3:4b-instruct");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.tag).toBe("qwen3:4b-instruct");
    expect(out.resolution.canonicalId).toBe("ollama:qwen3:4b-instruct");
    expect(out.resolution.provider).toBe("ollama");
  });

  it("accepts the canonical 'ollama:' form of the same request", () => {
    const out = resolveLocalModel(LANE_UP, "ollama:qwen3:4b-instruct");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.tag).toBe("qwen3:4b-instruct");
  });

  it("HARD-FAILS when the requested local model is not installed", () => {
    const out = resolveLocalModel(LANE_UP, "llama3:70b");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("llama3:70b");
    expect(out.error).toContain("not installed");
    // The message must be actionable: what IS installed, and how to fix.
    expect(out.error).toContain("qwen3:4b-instruct");
    expect(out.error).toContain("ollama pull llama3:70b");
  });

  it("never silently substitutes a different tag for an explicit request", () => {
    // "qwen3:4b" is a DIFFERENT model from "qwen3:4b-instruct".
    const out = resolveLocalModel(LANE_UP, "qwen3:4b");
    expect(out.ok).toBe(false);
  });

  it("resolves a bare family name to the installed tag", () => {
    const out = resolveLocalModel(LANE_UP, "qwen3");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.tag).toBe("qwen3:4b-instruct");
  });

  it("with no explicit request, uses the lane preference order", () => {
    const out = resolveLocalModel(LANE_UP, null);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(LANE_UP.models).toContain(out.resolution.tag);
  });

  it("a persisted REMOTE selection never becomes the local model", () => {
    // The controller passes null here for a non-local selection — the
    // point of the fix. Prove the outcome is a real installed tag and
    // not the MiniMax id.
    const out = resolveLocalModel(LANE_UP, null);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resolution.tag).not.toBe(PERSISTED_REMOTE);
    expect(out.resolution.canonicalId.startsWith("ollama:")).toBe(true);
  });

  it("fails clearly, with the probe's reason, when the daemon is down", () => {
    const out = resolveLocalModel(LANE_DOWN, "qwen3:4b-instruct");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("qwen3:4b-instruct");
    expect(out.error).toContain("not reachable");
  });

  it("fails when the daemon is up but has no models", () => {
    const out = resolveLocalModel(
      { available: false, models: [], endpoint: ENDPOINT, reason: "local model daemon is running but has no models installed" },
      null,
    );
    expect(out.ok).toBe(false);
  });
});

// ─── 3. The RoutedModel handed to the adapter layer ─────────────────

describe("localRoutedModel — cannot become a remote call", () => {
  const routed = (() => {
    const out = resolveLocalModel(LANE_UP, "qwen3:4b-instruct");
    if (!out.ok) throw new Error(out.error);
    return localRoutedModel(out.resolution);
  })();

  it("is servedBy ollama with the installed tag as the provider model id", () => {
    expect(routed.servedBy).toBe("ollama");
    expect(routed.provider).toBe("ollama");
    expect(routed.providerModelId).toBe("qwen3:4b-instruct");
    expect(routed.label).toBe("qwen3:4b-instruct");
  });

  it("carries NO OpenRouter id — the silent-reroute branch cannot fire", () => {
    // resolveProviderAdapter's OpenRouter fallback requires
    // routed.openRouterModelId. Withholding it makes a LOCAL route
    // structurally incapable of becoming a cloud call.
    expect(routed.openRouterModelId).toBeUndefined();
  });

  it("resolves to the credentialless local adapter with NO api key set", () => {
    const saved = { ...process.env };
    for (const k of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY"]) {
      delete process.env[k];
    }
    try {
      const adapter = resolveProviderAdapter(routed, {});
      expect(adapter.providerId).toBe("ollama");
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it("still resolves to Ollama even when a cloud key IS present", () => {
    const saved = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    try {
      const adapter = resolveProviderAdapter(routed, {});
      expect(adapter.providerId).toBe("ollama");
    } finally {
      if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = saved;
    }
  });
});

// ─── 4. ModelRuntime.routeLocal ─────────────────────────────────────

describe("ModelRuntime.routeLocal", () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => { saved = { ...process.env }; });
  afterEach(() => { process.env = saved; });

  it("REQUIREMENT E2: a persisted remote MiniMax selection yields Ollama in LOCAL mode", () => {
    const rt = new ModelRuntime(false);
    // Sanity: the catalog really does hold the MiniMax entry that was
    // showing in the footer, so this is the same id the cockpit had.
    expect(rt.registry.getById(PERSISTED_REMOTE)?.displayName).toContain("MiniMax");

    // The controller passes `null` for a non-local selection.
    const routed = rt.routeLocal(LANE_UP, null);

    expect(routed.servedBy).toBe("ollama");
    expect(routed.id.startsWith("ollama:")).toBe(true);
    expect(routed.id).not.toBe(PERSISTED_REMOTE);
    expect(routed.label).not.toContain("MiniMax");
  });

  it("REQUIREMENT E3: the resolved model is registered so the UI shows its real name", () => {
    const rt = new ModelRuntime(false);
    const routed = rt.routeLocal(LANE_UP, "qwen3:4b-instruct");
    // brainLabel is what the footer/header badge renders in FIXED mode.
    expect(rt.brainLabel("fixed", routed.id)).toBe("qwen3:4b-instruct");
    expect(rt.getModel(routed.id)?.provider).toBe("ollama");
  });

  it("throws — never falls back to the catalog — when the model is missing", () => {
    const rt = new ModelRuntime(false);
    expect(() => rt.routeLocal(LANE_UP, "llama3:70b")).toThrow(/not installed/);
  });

  it("throws when the daemon is unreachable", () => {
    const rt = new ModelRuntime(false);
    expect(() => rt.routeLocal(LANE_DOWN, null)).toThrow(/not reachable/);
  });

  it("registerLocalModel is idempotent", () => {
    const rt = new ModelRuntime(false);
    const a = rt.routeLocal(LANE_UP, "qwen3:4b-instruct");
    const b = rt.routeLocal(LANE_UP, "qwen3:4b-instruct");
    expect(a.id).toBe(b.id);
    expect(rt.getAllModels().filter((m) => m.canonicalId === a.id)).toHaveLength(1);
  });
});

// ─── 5. The capability gate matrix (requirement C) ──────────────────

describe("capability gate — signed-out LOCAL Ollama is valid", () => {
  it("REQUIREMENT E1: local + signed out + Ollama available → NOT blocked", () => {
    expect(shouldBlockModelPath(false, "local", false, true)).toBe(false);
  });

  it("local-only + signed out + Ollama available → NOT blocked", () => {
    expect(shouldBlockModelPath(false, "local", true, true)).toBe(false);
  });

  it("local + signed out + NO local model → blocked (nothing can serve)", () => {
    expect(shouldBlockModelPath(false, "local", false, false)).toBe(true);
  });

  it("local-only + NO local model → blocked", () => {
    expect(shouldBlockModelPath(true, "local", true, false)).toBe(true);
  });

  it("local-only + remote target → always blocked", () => {
    expect(shouldBlockModelPath(true, "remote", true, true)).toBe(true);
  });

  it("remote target, not local-only → gate does not block (auth is downstream)", () => {
    expect(shouldBlockModelPath(false, "remote", false, false)).toBe(false);
  });
});

// ─── 6. id helpers ──────────────────────────────────────────────────

describe("local model id helpers", () => {
  it("recognises canonical local ids and only those", () => {
    expect(isLocalModelId("ollama:qwen3:4b-instruct")).toBe(true);
    expect(isLocalModelId(PERSISTED_REMOTE)).toBe(false);
    expect(isLocalModelId(null)).toBe(false);
  });

  it("strips the canonical prefix without touching a bare tag", () => {
    expect(ollamaTagOf("ollama:qwen3:4b-instruct")).toBe("qwen3:4b-instruct");
    expect(ollamaTagOf("qwen3:4b-instruct")).toBe("qwen3:4b-instruct");
  });
});
