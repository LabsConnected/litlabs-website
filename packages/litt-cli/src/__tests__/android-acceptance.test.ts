/**
 * Android acceptance regressions:
 *  - keep_alive default (30m) so the daemon stops evicting models between
 *    asks — the root cause of the ~118s cold reloads on Termux.
 *  - auth gate: read-only local diagnostics (`status`) permitted signed-out
 *    in the LOCAL target only; remote target keeps the gate.
 */
import { afterEach, describe, expect, it } from "vitest";
import { requiresAuth } from "../index.js";
import { resolveOllamaKeepAlive, DEFAULT_OLLAMA_KEEP_ALIVE } from "../lib/model-provider.js";

const ENV_KEYS = ["LITT_OLLAMA_KEEP_ALIVE", "OLLAMA_KEEP_ALIVE"] as const;
const saved = new Map<string, string | undefined>();
for (const k of ENV_KEYS) saved.set(k, process.env[k]);

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("resolveOllamaKeepAlive", () => {
  it("defaults to 30m so models stay resident between asks", () => {
    clearEnv();
    expect(resolveOllamaKeepAlive()).toBe("30m");
    expect(DEFAULT_OLLAMA_KEEP_ALIVE).toBe("30m");
  });

  it("OLLAMA_KEEP_ALIVE overrides the default", () => {
    clearEnv();
    process.env.OLLAMA_KEEP_ALIVE = "10m";
    expect(resolveOllamaKeepAlive()).toBe("10m");
  });

  it("LITT_OLLAMA_KEEP_ALIVE takes precedence over OLLAMA_KEEP_ALIVE", () => {
    clearEnv();
    process.env.OLLAMA_KEEP_ALIVE = "10m";
    process.env.LITT_OLLAMA_KEEP_ALIVE = "1h";
    expect(resolveOllamaKeepAlive()).toBe("1h");
  });

  it.each(["0", "off", "disabled", "OFF"])("%s disables keep_alive (pre-default behavior)", (v) => {
    clearEnv();
    process.env.LITT_OLLAMA_KEEP_ALIVE = v;
    expect(resolveOllamaKeepAlive()).toBeUndefined();
  });
});

describe("auth gate: local diagnostics", () => {
  // requiresAuth(command, hasByokKey, localOnly, localTarget, clerkToken, hasLocalProvider?)

  it("status is permitted signed-out in the LOCAL target", () => {
    expect(requiresAuth("status", false, false, true, false)).toBe(false);
    expect(requiresAuth("status", false, true, true, false)).toBe(false);
  });

  it("status keeps the gate in the REMOTE target (remote dispatch)", () => {
    expect(requiresAuth("status", false, false, false, false)).toBe(true);
  });

  it("status remains BYOK-permitted with a provider key", () => {
    expect(requiresAuth("status", true, false, false, false)).toBe(false);
  });

  it("write-capable commands stay gated signed-out even in LOCAL", () => {
    // NB: "repair" is LOGGED_OUT_ALLOWED by design (job-file safety rails);
    // "ask" is gated here only because no local provider was proven.
    for (const cmd of ["check", "test", "build", "run", "diff", "inspect", "explain", "ask"]) {
      expect(requiresAuth(cmd, false, false, true, false)).toBe(true);
    }
  });

  it("protected cloud commands stay gated in every target", () => {
    for (const cmd of ["mission", "desktop", "git", "do", "web", "model"]) {
      expect(requiresAuth(cmd, false, false, true, false)).toBe(true);
      expect(requiresAuth(cmd, false, false, false, false)).toBe(true);
    }
  });

  it("ask keeps its local-model bypass only with a live lane", () => {
    expect(requiresAuth("ask", false, false, true, false, true)).toBe(false);
    expect(requiresAuth("ask", false, false, true, false, false)).toBe(true);
  });
});
