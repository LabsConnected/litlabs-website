/**
 * PR #761 acceptance — OLLAMA_ROUTE_ORDER=tailscale,lan,local.
 *
 * Locks down the full acceptance contract through the REAL caller path
 * (probeLocalLane → probeOllamaRoute → resolveLocalLaneEndpoint →
 * resolveProviderAdapter), not just the candidate-list helper:
 *
 *   1. The env override drives the actual probe sequence:
 *      tailscale → lan → local.
 *   2. Automatic fallback: a failed higher-priority tier falls through
 *      to the next one, and probing stops at the first endpoint that
 *      answers with at least one model.
 *   3. Model validation: the pinned selection (ollama:litt-fast:2k) must
 *      resolve on the chosen endpoint's reported tags — a reachable
 *      endpoint that does NOT expose litt-fast:2k is a hard failure,
 *      never a silent substitution to whatever else is installed.
 *   4. Endpoint consistency: inference POSTs /v1/chat/completions to the
 *      SAME endpoint the probe selected — verified end-to-end against a
 *      real HTTP fake, which records the request it receives.
 *   5. Centralized prefs: a persisted ollama:litt-fast:2k +
 *      routingMode:"fixed" pin round-trips untouched and drives local
 *      resolution (never rewrites itself, never reroutes to cloud).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import {
  probeLocalLane,
  resolveLocalLaneEndpoint,
  resetLocalLaneCache,
  type LocalLaneStatus,
} from "../lib/local-lane.js";
import {
  resolveLocalModel,
  localRoutedModel,
  resolveRequestedLocalModel,
  localRoutePolicy,
} from "../lib/local-model-resolution.js";
import {
  openAiCompatibleLocalEndpoint,
  resolveProviderAdapter,
} from "../lib/model-provider.js";
import {
  loadModelPrefs,
  saveModelPrefs,
  type ModelPrefs,
} from "../lib/provider-registry.js";

const PINNED = "ollama:litt-fast:2k";
const PINNED_TAG = "litt-fast:2k";

const TS_EP = "http://100.107.123.73:11434";
const LAN_EP = "http://192.168.0.112:11434";
const LOCAL_EP = "http://127.0.0.1:11434";

const ENV_KEYS = [
  "LITT_OLLAMA_URL",
  "OLLAMA_LOCAL_URL",
  "OLLAMA_LAN_URL",
  "OLLAMA_TAILSCALE_URL",
  "OLLAMA_HOST_PC",
  "OLLAMA_HOST",
  "OLLAMA_BASE_URL",
  "OLLAMA_ROUTE_ORDER",
  "LITT_MODEL",
] as const;

let originals: Record<string, string | undefined>;

beforeEach(() => {
  originals = {};
  for (const key of ENV_KEYS) {
    originals[key] = process.env[key];
    delete process.env[key];
  }
  resetLocalLaneCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originals[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetLocalLaneCache();
});

/** Configure all three tiers with the tailscale-first route order. */
function setRouteOrderEnv(lanUrl = "192.168.0.112:11434", tsUrl = "100.107.123.73:11434") {
  process.env.OLLAMA_LOCAL_URL = "127.0.0.1:11434";
  process.env.OLLAMA_LAN_URL = lanUrl;
  process.env.OLLAMA_TAILSCALE_URL = tsUrl;
  process.env.OLLAMA_ROUTE_ORDER = "tailscale,lan,local";
}

function tagsOk(models: string[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ models: models.map((name) => ({ name, model: name })) }),
  } as Response;
}

/** A fetch that records every probed URL in call order. */
function recordingFetch(script: Record<string, () => Promise<Response>>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const handler = script[url.replace(/\/api\/tags$/, "")];
    if (!handler) throw new Error(`unscripted fetch: ${url}`);
    return handler();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

// ─── 1+2. Route order and automatic fallback ─────────────────────────

describe("OLLAMA_ROUTE_ORDER=tailscale,lan,local — probe order through probeLocalLane", () => {
  it("probes tailscale, then lan, then local — in that exact order", async () => {
    setRouteOrderEnv();
    const fail = async (): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    };
    const { calls, fetchImpl } = recordingFetch({
      [TS_EP]: fail,
      [LAN_EP]: fail,
      [LOCAL_EP]: fail,
    });

    const status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.available).toBe(false);
    expect(calls).toEqual([
      `${TS_EP}/api/tags`,
      `${LAN_EP}/api/tags`,
      `${LOCAL_EP}/api/tags`,
    ]);
  });

  it("Tailscale failing + LAN answering selects the LAN endpoint and stops", async () => {
    setRouteOrderEnv();
    const { calls, fetchImpl } = recordingFetch({
      [TS_EP]: async () => {
        throw new Error("connect ETIMEDOUT");
      },
      [LAN_EP]: async () => tagsOk([PINNED_TAG, "qwen3:4b"]),
      [LOCAL_EP]: async () => {
        throw new Error("local must never be probed after LAN wins");
      },
    });

    const status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.available).toBe(true);
    expect(status.route).toBe("lan");
    expect(status.routeLabel).toBe("LAN OLLAMA");
    expect(status.endpoint).toBe(LAN_EP);
    expect(calls).toEqual([`${TS_EP}/api/tags`, `${LAN_EP}/api/tags`]);
  });
});

// ─── 3. Model validation — litt-fast:2k, not merely any model ────────

describe("pinned model validation — the chosen endpoint must expose litt-fast:2k", () => {
  async function laneWith(models: string[]): Promise<LocalLaneStatus> {
    setRouteOrderEnv();
    const { fetchImpl } = recordingFetch({
      [TS_EP]: async () => {
        throw new Error("connect ETIMEDOUT");
      },
      [LAN_EP]: async () => tagsOk(models),
    });
    return probeLocalLane({ fetchImpl, force: true });
  }

  it("resolves the pinned model on the selected LAN endpoint", async () => {
    const status = await laneWith([PINNED_TAG, "qwen3:4b"]);
    expect(status.available).toBe(true);
    expect(status.endpoint).toBe(LAN_EP);

    const outcome = resolveLocalModel(status, PINNED);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.resolution.tag).toBe(PINNED_TAG);
    expect(outcome.resolution.canonicalId).toBe(PINNED);
    expect(outcome.resolution.endpoint).toBe(LAN_EP);
    expect(outcome.resolution.isRouteChange).toBe(false);
  });

  it("hard-fails when the selected endpoint lacks litt-fast:2k — no silent substitution", async () => {
    // Reachable endpoint with OTHER models installed must not satisfy a
    // pin for litt-fast:2k: "any installed model" is not the pinned one.
    const status = await laneWith(["qwen3:4b", "litt-coder:3b"]);
    expect(status.available).toBe(true);

    const outcome = resolveLocalModel(status, PINNED);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/litt-fast:2k/);
    expect(outcome.error).toMatch(/not installed/);
    expect(outcome.error).toMatch(/qwen3:4b/);
  });

  it("honours the exact tag — litt-fast alone does not satisfy a litt-fast:2k pin", async () => {
    const status = await laneWith(["litt-fast:latest"]);
    const outcome = resolveLocalModel(status, PINNED);
    expect(outcome.ok).toBe(false);
  });
});

// ─── 4. Inference uses the same selected endpoint ────────────────────

describe("inference endpoint consistency", () => {
  it("resolveLocalLaneEndpoint + adapter URL track the probe-selected LAN endpoint", async () => {
    setRouteOrderEnv();
    const { fetchImpl } = recordingFetch({
      [TS_EP]: async () => {
        throw new Error("connect ETIMEDOUT");
      },
      [LAN_EP]: async () => tagsOk([PINNED_TAG]),
    });

    const status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.endpoint).toBe(LAN_EP);

    // The endpoint inference resolves is the probe's winner, and the URL
    // the provider adapter POSTs to is that same host + /v1/chat/completions.
    expect(resolveLocalLaneEndpoint()).toBe(LAN_EP);
    expect(openAiCompatibleLocalEndpoint("ollama", "http://catalog.example/api/chat")).toBe(
      `${LAN_EP}/v1/chat/completions`,
    );
  });

  it("end-to-end: the adapter POSTs the pinned model to the probe-selected endpoint", async () => {
    // A REAL fake Ollama server — the probe and the inference POST both
    // go over real HTTP so there is no scripted-fetch blind spot.
    const requests: { url: string; model?: string }[] = [];
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: PINNED_TAG, model: PINNED_TAG }] }));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          requests.push({ url: req.url ?? "", model: body.model });
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write(
            `data: ${JSON.stringify({ model: PINNED_TAG, choices: [{ delta: { content: "ok" } }] })}\n\n` +
              "data: [DONE]\n\n",
          );
          res.end();
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const lanUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      // tailscale-first order; tailscale is a dead port, LAN is the fake.
      setRouteOrderEnv(lanUrl.replace(/^http:\/\//, ""), "127.0.0.1:9");
      process.env.OLLAMA_LOCAL_URL = "127.0.0.1:9"; // keep the real daemon out of the test

      const status = await probeLocalLane({ force: true }); // REAL fetch
      expect(status.available).toBe(true);
      expect(status.route).toBe("lan");
      expect(status.endpoint).toBe(lanUrl);

      const outcome = resolveLocalModel(status, PINNED);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      const provider = resolveProviderAdapter(localRoutedModel(outcome.resolution), {
        routingMode: "fixed",
      });
      const result = await provider.stream(
        [{ role: "user", content: "ping" }],
        () => {},
      );

      // The inference request landed on the SAME endpoint the probe won.
      expect(requests).toEqual([{ url: "/v1/chat/completions", model: PINNED_TAG }]);
      expect(result.content).toContain("ok");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

// ─── 5. Centralized prefs — the fixed pin is preserved and honoured ───

describe("centralized model prefs — ollama:litt-fast:2k pinned fixed", () => {
  it("a fixed ollama:litt-fast:2k pin round-trips through load/save untouched", () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), "litt-pr761-prefs-"));
    const prefsPath = join(dir, "model-prefs.json");
    try {
      const prefs: ModelPrefs = {
        prefsVersion: 2,
        routingMode: "fixed",
        selectedModel: PINNED,
        capabilityOverrides: {},
        lastUsedModel: PINNED,
        showFallbackNotifications: true,
      };
      saveModelPrefs(prefs, prefsPath);
      const loaded = loadModelPrefs(prefsPath);
      // Not migrated, not rewritten — the pin is a deliberate user choice.
      expect(loaded.routingMode).toBe("fixed");
      expect(loaded.selectedModel).toBe(PINNED);
      expect(loaded.lastUsedModel).toBe(PINNED);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the persisted pin drives the local request and cannot reroute to cloud", () => {
    const requested = resolveRequestedLocalModel(PINNED);
    expect(requested).toEqual({ model: PINNED, source: "prefs" });

    const policy = localRoutePolicy({
      executionTarget: "local",
      localOnly: false,
      signedIn: false,
      requestedLocalModel: requested.model,
      hasCloudCredential: false,
    });
    expect(policy.kind).toBe("local-required");

    const lane: LocalLaneStatus = {
      available: true,
      models: [PINNED_TAG],
      endpoint: LAN_EP,
      reason: null,
      route: "lan",
      routeLabel: "LAN OLLAMA",
    };
    const outcome = resolveLocalModel(lane, requested.model);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const routed = localRoutedModel(outcome.resolution);
    expect(routed.servedBy).toBe("ollama");
    expect(routed.providerModelId).toBe(PINNED_TAG);
    // No OpenRouter id — a silent cloud reroute is structurally impossible.
    expect(routed.openRouterModelId).toBeUndefined();
  });
});
