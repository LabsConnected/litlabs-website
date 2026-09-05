import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  OLLAMA_ROUTE_LABELS,
  resolveOllamaRouteCandidates,
  probeOllamaRoute,
  type OllamaRouteCandidate,
} from "../ollama-route.js";
import type { EnvGetter } from "../ollama-endpoint.js";

function envFromMap(map: Record<string, string | undefined>): EnvGetter {
  return (key: string) => map[key];
}

function fakeTagsResponse(models: string[], ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({ models: models.map((name) => ({ name, model: name })) }),
  } as Response;
}

/** Build a scripted fetch that answers per-endpoint from a map. */
function scriptedFetch(
  script: Record<string, () => Promise<Response>>,
): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const endpoint = url.replace(/\/api\/tags$/, "");
    const handler = script[endpoint];
    if (!handler) throw new Error(`no script entry for ${endpoint}`);
    return handler();
  }) as typeof fetch;
}

// ─── Candidate resolution ────────────────────────────────────────────

describe("resolveOllamaRouteCandidates — priority and shape", () => {
  it("always includes local, defaulting to localhost when unset", () => {
    const candidates = resolveOllamaRouteCandidates(envFromMap({}));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].tier, "local");
    assert.equal(candidates[0].endpoint, "http://localhost:11434");
    assert.equal(candidates[0].label, OLLAMA_ROUTE_LABELS.local);
  });

  it("orders local, then LAN, then Tailscale", () => {
    const candidates = resolveOllamaRouteCandidates(
      envFromMap({
        OLLAMA_LAN_URL: "192.168.0.77:11434",
        OLLAMA_TAILSCALE_URL: "pc.tailnet-name.ts.net:11434",
      }),
    );
    assert.deepEqual(
      candidates.map((c) => c.tier),
      ["local", "lan", "tailscale"],
    );
    assert.equal(candidates[1].endpoint, "http://192.168.0.77:11434");
    assert.equal(candidates[2].endpoint, "http://pc.tailnet-name.ts.net:11434");
  });

  it("falls back to legacy OLLAMA_HOST_PC for the LAN tier", () => {
    const candidates = resolveOllamaRouteCandidates(
      envFromMap({ OLLAMA_HOST_PC: "192.168.0.77:11434" }),
    );
    const lan = candidates.find((c) => c.tier === "lan");
    assert.ok(lan);
    assert.equal(lan?.endpoint, "http://192.168.0.77:11434");
  });

  it("falls back to legacy OLLAMA_HOST then OLLAMA_BASE_URL in order", () => {
    const candidates = resolveOllamaRouteCandidates(
      envFromMap({ OLLAMA_HOST: "10.0.0.5:11434", OLLAMA_BASE_URL: "10.0.0.6:11434" }),
    );
    const lan = candidates.find((c) => c.tier === "lan");
    assert.equal(lan?.endpoint, "http://10.0.0.5:11434");
  });

  it("OLLAMA_LAN_URL takes precedence over legacy LAN vars", () => {
    const candidates = resolveOllamaRouteCandidates(
      envFromMap({ OLLAMA_LAN_URL: "10.0.0.9:11434", OLLAMA_HOST_PC: "10.0.0.5:11434" }),
    );
    const lan = candidates.find((c) => c.tier === "lan");
    assert.equal(lan?.endpoint, "http://10.0.0.9:11434");
  });

  it("omits LAN/Tailscale tiers entirely when unset (never probes 'undefined')", () => {
    const candidates = resolveOllamaRouteCandidates(envFromMap({}));
    assert.equal(candidates.some((c) => c.tier === "lan"), false);
    assert.equal(candidates.some((c) => c.tier === "tailscale"), false);
  });

  it("LITT_OLLAMA_URL override short-circuits to a single candidate", () => {
    const candidates = resolveOllamaRouteCandidates(
      envFromMap({
        LITT_OLLAMA_URL: "http://10.10.10.10:11434",
        OLLAMA_LAN_URL: "192.168.0.77:11434",
        OLLAMA_TAILSCALE_URL: "pc.tailnet.ts.net:11434",
      }),
    );
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].endpoint, "http://10.10.10.10:11434");
  });

  it("malformed configuration is treated as unset, not as a broken candidate", () => {
    const candidates = resolveOllamaRouteCandidates(
      envFromMap({
        OLLAMA_LAN_URL: "http://user:secret@bad host:11434",
        OLLAMA_TAILSCALE_URL: "   ",
      }),
    );
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].tier, "local");
  });

  it("collapses duplicate endpoints across tiers to the highest-priority one", () => {
    const candidates = resolveOllamaRouteCandidates(
      envFromMap({
        OLLAMA_LOCAL_URL: "192.168.0.77:11434",
        OLLAMA_LAN_URL: "192.168.0.77:11434",
      }),
    );
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].tier, "local");
  });
});

// ─── probeOllamaRoute — selection behaviour ──────────────────────────

describe("probeOllamaRoute — localhost preferred over everything", () => {
  it("picks local when local, LAN, and Tailscale are all healthy", async () => {
    const candidates: OllamaRouteCandidate[] = [
      { tier: "local", label: "LOCAL OLLAMA", endpoint: "http://localhost:11434" },
      { tier: "lan", label: "LAN OLLAMA", endpoint: "http://192.168.0.77:11434" },
      { tier: "tailscale", label: "TAILSCALE OLLAMA", endpoint: "http://100.1.2.3:11434" },
    ];
    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => fakeTagsResponse(["qwen3:4b"]),
      "http://192.168.0.77:11434": async () => fakeTagsResponse(["qwen3:4b"]),
      "http://100.1.2.3:11434": async () => fakeTagsResponse(["qwen3:4b"]),
    });
    const result = await probeOllamaRoute({ candidates, fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.tier, "local");
    assert.equal(result.label, "LOCAL OLLAMA");
    assert.equal(result.attempts.length, 1); // never even tries LAN/Tailscale
  });
});

describe("probeOllamaRoute — LAN fallback", () => {
  it("falls to LAN when local is unreachable", async () => {
    const candidates: OllamaRouteCandidate[] = [
      { tier: "local", label: "LOCAL OLLAMA", endpoint: "http://localhost:11434" },
      { tier: "lan", label: "LAN OLLAMA", endpoint: "http://192.168.0.77:11434" },
      { tier: "tailscale", label: "TAILSCALE OLLAMA", endpoint: "http://100.1.2.3:11434" },
    ];
    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => {
        throw new Error("ECONNREFUSED");
      },
      "http://192.168.0.77:11434": async () => fakeTagsResponse(["litt-coder:3b"]),
      "http://100.1.2.3:11434": async () => fakeTagsResponse(["litt-coder:3b"]),
    });
    const result = await probeOllamaRoute({ candidates, fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.tier, "lan");
    assert.equal(result.label, "LAN OLLAMA");
    assert.equal(result.endpoint, "http://192.168.0.77:11434");
    assert.deepEqual(result.models, ["litt-coder:3b"]);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0].ok, false);
  });
});

describe("probeOllamaRoute — Tailscale fallback", () => {
  it("falls to Tailscale when local and LAN are both unreachable (off home Wi-Fi)", async () => {
    const candidates: OllamaRouteCandidate[] = [
      { tier: "local", label: "LOCAL OLLAMA", endpoint: "http://localhost:11434" },
      { tier: "lan", label: "LAN OLLAMA", endpoint: "http://192.168.0.77:11434" },
      { tier: "tailscale", label: "TAILSCALE OLLAMA", endpoint: "http://100.1.2.3:11434" },
    ];
    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => {
        throw new Error("ECONNREFUSED");
      },
      "http://192.168.0.77:11434": async () => {
        throw new Error("network is unreachable");
      },
      "http://100.1.2.3:11434": async () => fakeTagsResponse(["litt-coder:3b"]),
    });
    const result = await probeOllamaRoute({ candidates, fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.tier, "tailscale");
    assert.equal(result.label, "TAILSCALE OLLAMA");
    assert.equal(result.attempts.length, 3);
  });
});

describe("probeOllamaRoute — remote/cloud fallback surface", () => {
  it("when no Ollama route is healthy, the result signals the caller to use the remote/cloud lane", async () => {
    const candidates: OllamaRouteCandidate[] = [
      { tier: "local", label: "LOCAL OLLAMA", endpoint: "http://localhost:11434" },
    ];
    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const result = await probeOllamaRoute({ candidates, fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.tier, null);
    assert.equal(result.endpoint, null);
    // The caller (local-lane / execution-target routing) is what decides
    // whether to hand off to REMOTE LITT — this module only reports that
    // Ollama itself is unreachable, with enough detail to act on.
    assert.match(result.reason ?? "", /unreachable/);
  });
});

describe("probeOllamaRoute — unreachable endpoints", () => {
  it("records a network error per attempt without throwing", async () => {
    const candidates: OllamaRouteCandidate[] = [
      { tier: "local", label: "LOCAL OLLAMA", endpoint: "http://localhost:11434" },
      { tier: "lan", label: "LAN OLLAMA", endpoint: "http://192.168.0.77:11434" },
    ];
    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => {
        throw new Error("ECONNREFUSED");
      },
      "http://192.168.0.77:11434": async () => {
        throw new Error("EHOSTUNREACH");
      },
    });
    const result = await probeOllamaRoute({ candidates, fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0].error, "ECONNREFUSED");
    assert.equal(result.attempts[1].error, "EHOSTUNREACH");
  });

  it("treats a reachable daemon with zero installed models as a failed attempt", async () => {
    const candidates: OllamaRouteCandidate[] = [
      { tier: "local", label: "LOCAL OLLAMA", endpoint: "http://localhost:11434" },
    ];
    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => fakeTagsResponse([]),
    });
    const result = await probeOllamaRoute({ candidates, fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.attempts[0].error ?? "", /no models installed/);
  });

  it("treats a non-2xx HTTP response as a failed attempt", async () => {
    const candidates: OllamaRouteCandidate[] = [
      { tier: "local", label: "LOCAL OLLAMA", endpoint: "http://localhost:11434" },
    ];
    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => fakeTagsResponse([], false, 503),
    });
    const result = await probeOllamaRoute({ candidates, fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.attempts[0].error, "HTTP 503");
  });
});

describe("probeOllamaRoute — malformed configuration", () => {
  it("with no valid configuration beyond the localhost default, still probes localhost", async () => {
    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const result = await probeOllamaRoute({
      getEnv: envFromMap({ OLLAMA_LAN_URL: "not a valid host!!", OLLAMA_TAILSCALE_URL: "http://" }),
      fetchImpl,
    });
    assert.equal(result.ok, false);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].tier, "local");
    assert.match(result.reason ?? "", /No Ollama endpoint configured|unreachable/);
  });

  it("reports a helpful message when nothing is configured and localhost fails", async () => {
    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const result = await probeOllamaRoute({ getEnv: envFromMap({}), fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /OLLAMA_TAILSCALE_URL/);
  });
});

describe("probeOllamaRoute — timeout behavior", () => {
  it("aborts a hung candidate after the configured timeout and falls through", async () => {
    const candidates: OllamaRouteCandidate[] = [
      { tier: "local", label: "LOCAL OLLAMA", endpoint: "http://localhost:11434" },
      { tier: "lan", label: "LAN OLLAMA", endpoint: "http://192.168.0.77:11434" },
    ];
    const fetchImpl = (async (_input: string | URL, init?: { signal?: AbortSignal }) => {
      const url = String(_input);
      if (url.startsWith("http://localhost:11434")) {
        // Never resolves on its own — only the AbortSignal ends it.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      return fakeTagsResponse(["qwen3:4b"]);
    }) as typeof fetch;

    const start = Date.now();
    const result = await probeOllamaRoute({ candidates, fetchImpl, timeoutMs: 50 });
    const elapsed = Date.now() - start;

    assert.equal(result.ok, true);
    assert.equal(result.tier, "lan");
    assert.ok(elapsed < 2000, `expected the hung candidate to be aborted quickly, took ${elapsed}ms`);
    assert.match(result.attempts[0].error ?? "", /abort/i);
  });

  it("reports every candidate as timed out when all hang", async () => {
    const candidates: OllamaRouteCandidate[] = [
      { tier: "local", label: "LOCAL OLLAMA", endpoint: "http://localhost:11434" },
    ];
    const fetchImpl = (async (_input: string | URL, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as typeof fetch;

    const result = await probeOllamaRoute({ candidates, fetchImpl, timeoutMs: 50 });
    assert.equal(result.ok, false);
    assert.match(result.attempts[0].error ?? "", /abort/i);
  });
});
