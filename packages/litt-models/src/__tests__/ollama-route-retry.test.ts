/**
 * Bounded per-candidate retry in probeOllamaRoute.
 *
 * On Android the first-tier (Tailscale) probe is often the ONLY reachable
 * route — off the home LAN with the local daemon down, a single transient
 * hiccup previously read as "every endpoint dead" and surfaced as a
 * misleading auth wall. Transport failures get bounded retries;
 * deterministic answers (HTTP status, empty model list) never do.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  probeOllamaRoute,
  DEFAULT_PROBE_RETRIES,
  type OllamaRouteCandidate,
} from "../ollama-route.js";
import type { EnvGetter } from "../ollama-endpoint.js";

const CANDIDATES: OllamaRouteCandidate[] = [
  { tier: "tailscale", label: "TAILSCALE OLLAMA", endpoint: "http://ts:11434" },
  { tier: "lan", label: "LAN OLLAMA", endpoint: "http://lan:11434" },
  { tier: "local", label: "LOCAL OLLAMA", endpoint: "http://local:11434" },
];

const noEnv: EnvGetter = () => undefined;

function okResponse(models = ["litt-fast:2k"]): Response {
  return {
    ok: true,
    json: async () => ({ models: models.map((m) => ({ model: m, name: m })) }),
  } as Response;
}

describe("probeOllamaRoute bounded retry", () => {
  it("retries a transient transport failure and recovers on the same tier", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) throw new Error("fetch failed: socket reset");
      return okResponse();
    }) as typeof fetch;

    const result = await probeOllamaRoute({
      candidates: CANDIDATES,
      fetchImpl,
      getEnv: noEnv,
      timeoutMs: 50,
    });

    assert.equal(result.ok, true);
    assert.equal(result.tier, "tailscale");
    assert.equal(calls, 2); // one transport retry, no further tiers probed
    assert.equal(result.attempts.length, 1); // one record per candidate
  });

  it("does NOT retry a deterministic HTTP error", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return { ok: false, status: 503, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const result = await probeOllamaRoute({
      candidates: CANDIDATES,
      fetchImpl,
      getEnv: noEnv,
      timeoutMs: 50,
    });

    assert.equal(result.ok, false);
    assert.equal(calls, 3); // each tier tried exactly once — 503 is final
    assert.equal(result.attempts.length, 3);
    assert.equal(result.attempts[0].error, "HTTP 503");
  });

  it("does NOT retry an empty model list", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return okResponse([]);
    }) as typeof fetch;

    const result = await probeOllamaRoute({
      candidates: CANDIDATES,
      fetchImpl,
      getEnv: noEnv,
      timeoutMs: 50,
    });

    assert.equal(result.ok, false);
    assert.equal(calls, 3);
    assert.equal(result.attempts[0].error, "reachable but no models installed");
  });

  it("bounds retries when every endpoint is down", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;

    const result = await probeOllamaRoute({
      candidates: CANDIDATES,
      fetchImpl,
      getEnv: noEnv,
      timeoutMs: 50,
    });

    assert.equal(result.ok, false);
    assert.equal(calls, 3 * (1 + DEFAULT_PROBE_RETRIES)); // 2 tries × 3 tiers
    assert.equal(result.attempts.length, 3); // one record per candidate
    assert.match(result.attempts[0].error ?? "", /after 2 attempts/);
  });

  it("honours retriesPerCandidate=0 (single attempt, legacy behavior)", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      throw new Error("fetch failed");
    }) as typeof fetch;

    const result = await probeOllamaRoute({
      candidates: CANDIDATES,
      fetchImpl,
      getEnv: noEnv,
      retriesPerCandidate: 0,
      timeoutMs: 50,
    });

    assert.equal(result.ok, false);
    assert.equal(calls, 3);
  });

  it("falls through to the next tier after bounded transport failures", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      const u = String(input);
      calls.push(u);
      if (u.startsWith("http://ts:")) throw new Error("timeout");
      return okResponse();
    }) as typeof fetch;

    const result = await probeOllamaRoute({
      candidates: CANDIDATES,
      fetchImpl,
      getEnv: noEnv,
      timeoutMs: 50,
    });

    assert.equal(result.ok, true);
    assert.equal(result.tier, "lan");
    assert.equal(calls.length, 3); // tailscale twice (bounded), lan once and won
  });

  it("honours LITT_OLLAMA_PROBE_RETRIES for extra attempts", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      throw new Error("fetch failed");
    }) as typeof fetch;

    const result = await probeOllamaRoute({
      candidates: [CANDIDATES[0]],
      fetchImpl,
      getEnv: (k) => (k === "LITT_OLLAMA_PROBE_RETRIES" ? "2" : undefined),
      timeoutMs: 50,
    });

    assert.equal(result.ok, false);
    assert.equal(calls, 3); // 1 + 2 retries
  });
});
