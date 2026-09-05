/**
 * Multi-endpoint Ollama routing — "reach my PC from anywhere."
 *
 * probeLocalLane() no longer probes a single fixed endpoint: it tries
 * this device's own Ollama, then the home LAN, then Tailscale, in that
 * priority order, via @litt/models' probeOllamaRoute(). These tests lock
 * down the priority order, the fallback behaviour, and — the bug this
 * suite exists to prevent — that resolveLocalLaneEndpoint() (which
 * model-provider.ts uses to build the actual chat request URL) returns
 * the SAME endpoint the probe just proved reachable, never a stale
 * single-shot resolution that could point at a different, unreachable
 * host than the one that answered.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  probeLocalLane,
  resolveLocalLaneEndpoint,
  resetLocalLaneCache,
} from "../lib/local-lane.js";

const ENV_KEYS = [
  "LITT_OLLAMA_URL",
  "OLLAMA_LOCAL_URL",
  "OLLAMA_LAN_URL",
  "OLLAMA_TAILSCALE_URL",
  "OLLAMA_HOST_PC",
  "OLLAMA_HOST",
  "OLLAMA_BASE_URL",
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
  vi.restoreAllMocks();
  resetLocalLaneCache();
});

function tagsOk(models: string[]) {
  return { ok: true, json: async () => ({ models: models.map((name) => ({ name, model: name })) }) } as Response;
}

/** A scripted fetch keyed by endpoint (without the /api/tags suffix). */
function scriptedFetch(script: Record<string, () => Promise<Response>>): typeof fetch {
  return (async (input: string | URL) => {
    const endpoint = String(input).replace(/\/api\/tags$/, "");
    const handler = script[endpoint];
    if (!handler) throw new Error(`unscripted fetch: ${endpoint}`);
    return handler();
  }) as typeof fetch;
}

describe("probeLocalLane — localhost preferred over everything", () => {
  it("serves from local when local, LAN, and Tailscale are all healthy", async () => {
    process.env.OLLAMA_LAN_URL = "192.168.0.77:11434";
    process.env.OLLAMA_TAILSCALE_URL = "100.107.123.73:11434";

    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => tagsOk(["qwen3:4b-instruct"]),
      "http://192.168.0.77:11434": async () => tagsOk(["qwen3:4b-instruct"]),
      "http://100.107.123.73:11434": async () => tagsOk(["qwen3:4b-instruct"]),
    });

    const status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.available).toBe(true);
    expect(status.route).toBe("local");
    expect(status.routeLabel).toBe("LOCAL OLLAMA");
    expect(status.endpoint).toBe("http://localhost:11434");
  });
});

describe("probeLocalLane — LAN fallback (home Wi-Fi, PC not on this machine)", () => {
  it("falls to LAN when the local daemon is absent", async () => {
    process.env.OLLAMA_LAN_URL = "192.168.0.77:11434";
    process.env.OLLAMA_TAILSCALE_URL = "100.107.123.73:11434";

    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => {
        throw new Error("ECONNREFUSED");
      },
      "http://192.168.0.77:11434": async () => tagsOk(["litt-coder:3b"]),
      "http://100.107.123.73:11434": async () => tagsOk(["litt-coder:3b"]),
    });

    const status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.available).toBe(true);
    expect(status.route).toBe("lan");
    expect(status.routeLabel).toBe("LAN OLLAMA");
    expect(status.endpoint).toBe("http://192.168.0.77:11434");
    expect(status.models).toEqual(["litt-coder:3b"]);
  });

  it("also recognises the legacy OLLAMA_HOST_PC name for the LAN tier", async () => {
    process.env.OLLAMA_HOST_PC = "http://192.168.0.77:11434";

    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => {
        throw new Error("ECONNREFUSED");
      },
      "http://192.168.0.77:11434": async () => tagsOk(["qwen3:4b"]),
    });

    const status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.available).toBe(true);
    expect(status.route).toBe("lan");
    expect(status.endpoint).toBe("http://192.168.0.77:11434");
  });
});

describe("probeLocalLane — Tailscale fallback (cellular / away from home)", () => {
  it("falls all the way to Tailscale when local and LAN are both unreachable", async () => {
    process.env.OLLAMA_LAN_URL = "192.168.0.77:11434";
    process.env.OLLAMA_TAILSCALE_URL = "100.107.123.73:11434";

    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => {
        throw new Error("ECONNREFUSED");
      },
      "http://192.168.0.77:11434": async () => {
        throw new Error("network is unreachable");
      },
      "http://100.107.123.73:11434": async () => tagsOk(["litt-coder:3b", "qwen3:4b"]),
    });

    const status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.available).toBe(true);
    expect(status.route).toBe("tailscale");
    expect(status.routeLabel).toBe("TAILSCALE OLLAMA");
    expect(status.endpoint).toBe("http://100.107.123.73:11434");
  });

  it("resolveLocalLaneEndpoint returns the SAME endpoint the probe just proved reachable", async () => {
    // This is the split-brain this suite exists to prevent: the endpoint
    // used to build the real chat request (via resolveLocalLaneEndpoint,
    // consumed by model-provider.ts) must match what probeLocalLane found
    // healthy — never a stale single-shot resolution pointing elsewhere.
    process.env.OLLAMA_LAN_URL = "192.168.0.77:11434";
    process.env.OLLAMA_TAILSCALE_URL = "100.107.123.73:11434";

    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => {
        throw new Error("ECONNREFUSED");
      },
      "http://192.168.0.77:11434": async () => {
        throw new Error("network is unreachable");
      },
      "http://100.107.123.73:11434": async () => tagsOk(["litt-coder:3b"]),
    });

    const status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.available).toBe(true);
    expect(status.endpoint).toBe("http://100.107.123.73:11434");
    expect(resolveLocalLaneEndpoint()).toBe(status.endpoint);
  });
});

describe("probeLocalLane — remote/cloud fallback surface", () => {
  it("reports unavailable with an actionable reason when no route answers, leaving remote/cloud to the caller", async () => {
    process.env.OLLAMA_LAN_URL = "192.168.0.77:11434";
    process.env.OLLAMA_TAILSCALE_URL = "100.107.123.73:11434";

    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => {
        throw new Error("ECONNREFUSED");
      },
      "http://192.168.0.77:11434": async () => {
        throw new Error("network is unreachable");
      },
      "http://100.107.123.73:11434": async () => {
        throw new Error("connect ETIMEDOUT");
      },
    });

    const status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.available).toBe(false);
    expect(status.route).toBeNull();
    expect(status.reason).toMatch(/Tailscale/);
    // No silent fallback to a cloud model id — that stays the caller's
    // (execution-target / local-route-policy) decision, per the P0
    // split-brain fix this module must never re-introduce.
    expect(status.models).toEqual([]);
  });
});

describe("probeLocalLane — unreachable endpoints", () => {
  it("a plain unreachable localhost (no LAN/Tailscale configured) keeps the legacy error wording", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.available).toBe(false);
    expect(status.reason).toContain("not reachable at http://localhost:11434");
  });
});

describe("probeLocalLane — malformed configuration", () => {
  it("ignores a malformed OLLAMA_LAN_URL and still probes localhost", async () => {
    process.env.OLLAMA_LAN_URL = "http://user:pw@bad host:11434";
    const fetchImpl = vi.fn().mockResolvedValueOnce(tagsOk(["qwen3:4b"]));
    const status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.available).toBe(true);
    expect(status.endpoint).toBe("http://localhost:11434");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ignores a malformed OLLAMA_TAILSCALE_URL and falls through past it", async () => {
    process.env.OLLAMA_LAN_URL = "192.168.0.77:11434";
    process.env.OLLAMA_TAILSCALE_URL = "not-a-real-host!!";

    const fetchImpl = scriptedFetch({
      "http://localhost:11434": async () => {
        throw new Error("ECONNREFUSED");
      },
      "http://192.168.0.77:11434": async () => tagsOk(["qwen3:4b"]),
    });

    const status = await probeLocalLane({ fetchImpl, force: true });
    expect(status.available).toBe(true);
    expect(status.route).toBe("lan");
  });
});

describe("probeLocalLane — timeout behavior", () => {
  it("aborts a hung local daemon and still reaches a healthy LAN fallback", async () => {
    process.env.OLLAMA_LAN_URL = "192.168.0.77:11434";

    const fetchImpl = (async (input: string | URL, init?: { signal?: AbortSignal }) => {
      const endpoint = String(input);
      if (endpoint.startsWith("http://localhost:11434")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      return tagsOk(["qwen3:4b"]);
    }) as typeof fetch;

    const start = Date.now();
    const status = await probeLocalLane({ fetchImpl, force: true, timeoutMs: 50 });
    const elapsed = Date.now() - start;

    expect(status.available).toBe(true);
    expect(status.route).toBe("lan");
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("probeLocalLane — caching", () => {
  it("does not re-probe within the cache window", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(tagsOk(["qwen3:4b"]));
    await probeLocalLane({ fetchImpl, force: true });
    await probeLocalLane({ fetchImpl }); // no force — should hit cache
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("force:true bypasses the cache", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(tagsOk(["qwen3:4b"]));
    await probeLocalLane({ fetchImpl, force: true });
    await probeLocalLane({ fetchImpl, force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
