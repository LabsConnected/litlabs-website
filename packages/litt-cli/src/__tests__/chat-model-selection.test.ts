/**
 * Chat vs agent model selection — `litt ask` must serve the lightweight
 * chat build, not whatever tag /api/tags happens to list first.
 *
 * The regression this locks down:
 *
 *   The globally installed CLI carried a stale preference list that
 *   matched nothing on the PC's model list, so selectLocalModel fell
 *   through to models[0] — which after the Nov-6 cbx-* builds became
 *   "cbx-hermes-fast:8k" (a thinking model that even leaked a literal
 *   </think> into answers). The documented contract is:
 *
 *     PC chat      → litt-fast:2k     (this lane — `litt ask`)
 *     PC agentic   → litt-hermes:32k  (unchanged agent lane)
 *     coding tasks → litt-coder:8k    (explicit request, e.g. repair)
 *     phone daemon → litt-oc-phone:1.7b-8k
 *
 *   "Never serve models[0] when a preference applies" is the actual bug:
 *   the live PC tag list puts cbx-hermes-fast:8k FIRST, so these tests
 *   run against tags in that real order — alphabetical fixtures would
 *   hide the failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  probeLocalLane,
  selectLocalModel,
  resetLocalLaneCache,
  type LocalLaneStatus,
} from "../lib/local-lane.js";
import { resolveLocalModel, resolveRequestedLocalModel } from "../lib/local-model-resolution.js";
import { ModelRuntime } from "../lib/model-runtime.js";

const ENV_KEYS = [
  "LITT_MODEL",
  "LITT_OLLAMA_URL",
  "OLLAMA_ROUTE_ORDER",
  "OLLAMA_LOCAL_URL",
  "OLLAMA_LAN_URL",
  "OLLAMA_TAILSCALE_URL",
  "OLLAMA_HOST_PC",
  "OLLAMA_HOST",
  "OLLAMA_BASE_URL",
] as const;

// Endpoints written by scripts/termux/setup-hermes-route.sh + ollama-routes.env.
const PC = "http://100.107.123.73:11434";        // Nitro 5 via Tailscale
const PC_LAN = "http://192.168.0.112:11434";     // Nitro 5 on home Wi-Fi
const PHONE = "http://localhost:11434";          // this phone's own daemon

// The REAL /api/tags order on the PC today — cbx-* builds sort first.
// Ordering matters: models[0] is the fallback, so a test fixture that
// sorts the way we wish the daemon did would not catch the regression.
const PC_TAGS_LIVE = [
  "cbx-hermes-fast:8k",
  "cbx-hermes:4k",
  "litt-coder:16k",
  "litt-builder:16k",
  "litt-builder:8k",
  "litt-coder:8k",
  "qwen2.5-coder:1.5b",
  "litt-hermes:16k",
  "litt-hermes-fast:8k",
  "litt-hermes:32k",
  "litt-hermes:4k",
  "litt-hermes-fast:4k",
  "litt-tools:4k",
  "litt-fast:2k",
  "litt-hermes-fast:64k",
  "litt-hermes:64k",
];
const PHONE_TAGS = ["litt-oc-phone:1.7b-8k", "huihui_ai/qwen3-abliterated:1.7b"];

const laneUp = (models: string[], endpoint = PC): LocalLaneStatus => ({
  available: true,
  models,
  endpoint,
  reason: null,
});

let originals: Record<string, string | undefined>;

beforeEach(() => {
  originals = {};
  for (const key of ENV_KEYS) {
    originals[key] = process.env[key];
    delete process.env[key];
  }
  resetLocalLaneCache();
  process.env.OLLAMA_ROUTE_ORDER = "tailscale,lan,local";
  process.env.OLLAMA_LOCAL_URL = PHONE;
  process.env.OLLAMA_LAN_URL = PC_LAN;
  process.env.OLLAMA_TAILSCALE_URL = PC;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originals[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
  resetLocalLaneCache();
});

function tagsOk(models: string[]) {
  return { ok: true, json: async () => ({ models: models.map((name) => ({ name, model: name })) }) } as Response;
}

/** Scripted fetch: pcUp/phoneUp control which daemon answers /api/tags. */
function dexFetch(state: { pcUp: boolean; phoneUp: boolean }): typeof fetch {
  return (async (input: string | URL) => {
    const endpoint = String(input).replace(/\/api\/tags$/, "");
    if (endpoint === PC || endpoint === PC_LAN) {
      if (!state.pcUp) throw new Error("connect ETIMEDOUT");
      return tagsOk(PC_TAGS_LIVE);
    }
    if (endpoint === PHONE) {
      if (!state.phoneUp) throw new Error("ECONNREFUSED");
      return tagsOk(PHONE_TAGS);
    }
    throw new Error(`unscripted fetch: ${endpoint}`);
  }) as typeof fetch;
}

// ─── 1. Chat lane picks litt-fast, never the first tag ──────────────

describe("chat lane — PC endpoint", () => {
  it("serves litt-fast:2k even though cbx-hermes-fast:8k sorts first in /api/tags", () => {
    expect(selectLocalModel(PC_TAGS_LIVE, undefined, "chat")).toBe("litt-fast:2k");
  });

  it("resolveLocalModel with purpose chat resolves litt-fast:2k", () => {
    const outcome = resolveLocalModel(laneUp(PC_TAGS_LIVE), null, { purpose: "chat" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.resolution.tag).toBe("litt-fast:2k");
      expect(outcome.resolution.canonicalId).toBe("ollama:litt-fast:2k");
    }
  });

  it("routeLocal with purpose chat returns the litt-fast:2k RoutedModel", () => {
    const rt = new ModelRuntime(false);
    const routed = rt.routeLocal(laneUp(PC_TAGS_LIVE), null, { purpose: "chat" });
    expect(routed.label).toBe("litt-fast:2k");
    expect(routed.id).toBe("ollama:litt-fast:2k");
    expect(routed.servedBy).toBe("ollama");
  });
});

// ─── 2. Agent and coding lanes are unchanged ────────────────────────

describe("agent and coding lanes — unchanged by the chat pick", () => {
  it("agent lane still prefers litt-hermes:32k on the PC", () => {
    expect(selectLocalModel(PC_TAGS_LIVE)).toBe("litt-hermes:32k");
    expect(selectLocalModel(PC_TAGS_LIVE, undefined, "agent")).toBe("litt-hermes:32k");
  });

  it("routeLocal without options keeps the agentic pick", () => {
    const rt = new ModelRuntime(false);
    const routed = rt.routeLocal(laneUp(PC_TAGS_LIVE), null);
    expect(routed.label).toBe("litt-hermes:32k");
  });

  it("an explicit coding-model request wins over every preference list", () => {
    const outcome = resolveLocalModel(laneUp(PC_TAGS_LIVE), "ollama:litt-coder:8k", { purpose: "chat" });
    expect(outcome.ok && outcome.resolution.tag).toBe("litt-coder:8k");
  });
});

// ─── 3. On-device fallback ──────────────────────────────────────────

describe("chat lane — phone endpoint (PC unreachable)", () => {
  it("serves litt-oc-phone:1.7b-8k on the device daemon", () => {
    expect(selectLocalModel(PHONE_TAGS, undefined, "chat")).toBe("litt-oc-phone:1.7b-8k");
    const outcome = resolveLocalModel(laneUp(PHONE_TAGS, PHONE), null, { purpose: "chat" });
    expect(outcome.ok && outcome.resolution.tag).toBe("litt-oc-phone:1.7b-8k");
  });

  it("probe → chat resolve end-to-end: PC down falls back to the phone", async () => {
    const status = await probeLocalLane({ fetchImpl: dexFetch({ pcUp: false, phoneUp: true }), force: true });
    expect(status.available).toBe(true);
    expect(status.endpoint).toBe(PHONE);
    const outcome = resolveLocalModel(status, null, { purpose: "chat" });
    expect(outcome.ok && outcome.resolution.tag).toBe("litt-oc-phone:1.7b-8k");
  });
});

// ─── 4. Endpoint order honored (OLLAMA_ROUTE_ORDER) ─────────────────

describe("endpoint probe order", () => {
  it("tailscale-first order reaches the PC over Tailscale", async () => {
    const status = await probeLocalLane({ fetchImpl: dexFetch({ pcUp: true, phoneUp: true }), force: true });
    expect(status.available).toBe(true);
    expect(status.endpoint).toBe(PC);
    expect(status.route).toBe("tailscale");
  });

  it("a configured order of local-first still prefers the device daemon", async () => {
    process.env.OLLAMA_ROUTE_ORDER = "local,tailscale,lan";
    const status = await probeLocalLane({ fetchImpl: dexFetch({ pcUp: true, phoneUp: true }), force: true });
    expect(status.available).toBe(true);
    expect(status.endpoint).toBe(PHONE);
    expect(status.route).toBe("local");
  });
});

// ─── 5. Overrides and failure modes ─────────────────────────────────

describe("overrides and failure modes", () => {
  it("LITT_MODEL env override wins over the chat pick", () => {
    process.env.LITT_MODEL = "ollama:litt-hermes:32k";
    const requested = resolveRequestedLocalModel(null).model;
    const outcome = resolveLocalModel(laneUp(PC_TAGS_LIVE), requested, { purpose: "chat" });
    expect(outcome.ok && outcome.resolution.tag).toBe("litt-hermes:32k");
  });

  it("a persisted ollama: selection wins over the chat pick", () => {
    const requested = resolveRequestedLocalModel("ollama:litt-tools:4k").model;
    const outcome = resolveLocalModel(laneUp(PC_TAGS_LIVE), requested, { purpose: "chat" });
    expect(outcome.ok && outcome.resolution.tag).toBe("litt-tools:4k");
  });

  it("an explicit model that is not installed hard-fails with the installed list", () => {
    const outcome = resolveLocalModel(laneUp(PC_TAGS_LIVE), "ollama:litt-fast:4k", { purpose: "chat" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("not installed");
  });

  it("daemon down → clear error, never a pick", () => {
    const down: LocalLaneStatus = {
      available: false, models: [], endpoint: PC,
      reason: "local model daemon not reachable",
    };
    const outcome = resolveLocalModel(down, null, { purpose: "chat" });
    expect(outcome.ok).toBe(false);
  });

  it("models[0] fallback only fires when no preference entry is installed", () => {
    const foreign = ["some-org/foreign-model:7b", "other/model:1b"];
    expect(selectLocalModel(foreign, undefined, "chat")).toBe("some-org/foreign-model:7b");
    expect(selectLocalModel([], undefined, "chat")).toBe(null);
  });
});
