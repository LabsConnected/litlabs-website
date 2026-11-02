/**
 * Dex (Android/Termux) → PC Hermes routing.
 *
 * The phone's route config (scripts/termux/setup-hermes-route.sh +
 * litt-local) points the probe's candidate tiers at two daemons:
 *
 *   OLLAMA_LOCAL_URL → the Nitro 5 PC's Tailscale endpoint (checked FIRST)
 *   OLLAMA_LAN_URL   → the phone's own on-device daemon    (checked SECOND)
 *
 * That ordering is what produces the product contract:
 *   PC reachable   → requests go to litt-hermes on the PC.
 *   PC down        → requests fall back to litt-oc-phone on-device.
 *   PC comes back  → the next probe re-picks the PC automatically.
 *
 * These tests lock down that contract through the same functions real
 * requests use: probeLocalLane → resolveLocalLaneEndpoint →
 * selectLocalModel / resolveLocalModel.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  probeLocalLane,
  resolveLocalLaneEndpoint,
  resetLocalLaneCache,
  selectLocalModel,
} from "../lib/local-lane.js";
import { resolveLocalModel } from "../lib/local-model-resolution.js";

const ENV_KEYS = [
  "LITT_OLLAMA_URL",
  "OLLAMA_ROUTE_ORDER",
  "OLLAMA_LOCAL_URL",
  "OLLAMA_LAN_URL",
  "OLLAMA_TAILSCALE_URL",
  "OLLAMA_HOST_PC",
  "OLLAMA_HOST",
  "OLLAMA_BASE_URL",
] as const;

// The exact endpoints setup-hermes-route.sh writes on the phone.
const PC = "http://100.107.123.73:11434";        // Nitro 5 via Tailscale
const PC_LAN = "http://192.168.0.112:11434";     // Nitro 5 on home Wi-Fi
const PHONE = "http://localhost:11434";          // this phone's own daemon

const PC_TAGS = [
  "litt-hermes:32k",
  "litt-hermes:4k",
  "litt-hermes-fast:4k",
  "litt-tools:4k",
  "litt-fast:2k",
  "litt-hermes-fast:64k",
  "litt-hermes:64k",
];
const PHONE_TAGS = ["litt-oc-phone:1.7b-8k", "huihui_ai/qwen3-abliterated:1.7b"];

let originals: Record<string, string | undefined>;

beforeEach(() => {
  originals = {};
  for (const key of ENV_KEYS) {
    originals[key] = process.env[key];
    delete process.env[key];
  }
  resetLocalLaneCache();
  // The phone's configured route (ollama-routes.env): PC over Tailscale
  // first, PC over home LAN second, this phone's own daemon last.
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
      // Same PC over either route — the PC's firewall only answers the
      // phone on the Tailscale IP anyway, so LAN would fail regardless;
      // pcUp models the PC daemon being reachable at all.
      if (!state.pcUp) throw new Error("connect ETIMEDOUT");
      return tagsOk(PC_TAGS);
    }
    if (endpoint === PHONE) {
      if (!state.phoneUp) throw new Error("ECONNREFUSED");
      return tagsOk(PHONE_TAGS);
    }
    throw new Error(`unscripted fetch: ${endpoint}`);
  }) as typeof fetch;
}

describe("Dex route — PC Hermes preferred", () => {
  it("serves from the PC endpoint when both PC and phone daemon are up", async () => {
    const status = await probeLocalLane({ fetchImpl: dexFetch({ pcUp: true, phoneUp: true }), force: true });
    expect(status.available).toBe(true);
    expect(status.endpoint).toBe(PC);
    expect(resolveLocalLaneEndpoint()).toBe(PC);
  });

  it("resolves the serving model to litt-hermes:32k on the PC lane", async () => {
    const status = await probeLocalLane({ fetchImpl: dexFetch({ pcUp: true, phoneUp: true }), force: true });
    const outcome = resolveLocalModel(status, null);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.resolution.tag).toBe("litt-hermes:32k");
      expect(outcome.resolution.canonicalId).toBe("ollama:litt-hermes:32k");
      expect(outcome.resolution.endpoint).toBe(PC);
    }
  });

  it("keeps litt-hermes:64k selectable when 32k is absent", async () => {
    const without32k = PC_TAGS.filter((t) => t !== "litt-hermes:32k");
    const fetchImpl = (async () => tagsOk(without32k)) as typeof fetch;
    const status = await probeLocalLane({ fetchImpl, force: true });
    const picked = selectLocalModel(status.models);
    expect(picked).toBe("litt-hermes:64k");
  });
});

describe("Dex route — automatic fallback to on-device model", () => {
  it("serves litt-oc-phone from the device daemon when the PC is unreachable", async () => {
    const status = await probeLocalLane({ fetchImpl: dexFetch({ pcUp: false, phoneUp: true }), force: true });
    expect(status.available).toBe(true);
    expect(status.endpoint).toBe(PHONE);
    expect(resolveLocalLaneEndpoint()).toBe(PHONE);

    const outcome = resolveLocalModel(status, null);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.resolution.tag).toBe("litt-oc-phone:1.7b-8k");
      expect(outcome.resolution.canonicalId).toBe("ollama:litt-oc-phone:1.7b-8k");
      expect(outcome.resolution.endpoint).toBe(PHONE);
    }
  });

  it("fails with an actionable reason when PC and device are both down", async () => {
    const status = await probeLocalLane({ fetchImpl: dexFetch({ pcUp: false, phoneUp: false }), force: true });
    expect(status.available).toBe(false);
    expect(status.reason).toBeTruthy();

    const outcome = resolveLocalModel(status, null);
    expect(outcome.ok).toBe(false);
  });
});

describe("Dex route — automatic reconnect to the PC", () => {
  it("re-picks the PC on the next probe after it comes back — no restart", async () => {
    const state = { pcUp: false, phoneUp: true };
    const fetchImpl = dexFetch(state);

    // PC down: falls back to the device daemon.
    let status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.endpoint).toBe(PHONE);

    // PC returns: the next probe (cache expiry / forced) picks it again.
    state.pcUp = true;
    status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.endpoint).toBe(PC);
    expect(resolveLocalLaneEndpoint()).toBe(PC);

    const outcome = resolveLocalModel(status, null);
    expect(outcome.ok && outcome.resolution.tag).toBe("litt-hermes:32k");
  });
});

describe("Dex route — model preference order", () => {
  it("prefers litt-hermes:32k over other PC models", () => {
    expect(selectLocalModel(PC_TAGS)).toBe("litt-hermes:32k");
  });

  it("prefers litt-oc-phone on the device daemon's tag list", () => {
    expect(selectLocalModel(PHONE_TAGS)).toBe("litt-oc-phone:1.7b-8k");
  });

  it("prefers litt-hermes:* tags over litt-hermes-fast:* regardless of tag order", () => {
    const tags = ["litt-hermes-fast:4k", "litt-hermes:32k", "litt-hermes-fast:64k"];
    expect(selectLocalModel(tags)).toBe("litt-hermes:32k");
  });
});
