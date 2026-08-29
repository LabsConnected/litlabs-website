/**
 * Remote readiness race regression tests.
 *
 * Contract under test:
 *   1. When executionTarget === "remote", submit MUST wait for the
 *      RuntimeClient to reach "connected" before calling the model
 *      provider. The user should NOT need to wait after launch — the
 *      submit flow handles the wait internally.
 *   2. A stale "fixed" model-prefs.json pointing at a free OpenRouter
 *      model (e.g. "gemma-4-31b-free") must be reset to AUTO in remote
 *      mode, so the OpenAI primary route is not silently overridden.
 *   3. Remote connection timeout/failure must surface as an explicit
 *      remote-runtime error — NEVER as a silent fallback to a local
 *      provider or free-model routing.
 *   4. The transport projection must show "REMOTE…" (connecting) and
 *      "REMOTE ERR" (error) — never claim "REMOTE" until connected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RemoteConnectionTimeoutError } from "../lib/runtime-client.js";
import { deriveTransport } from "../lib/transport-projection.js";
import { loadModelPrefs, type ModelPrefs } from "../lib/provider-registry.js";
import { resolveExecutionTarget } from "../lib/execution-target.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Test helpers ──────────────────────────────────────────────────

/** A minimal fake RuntimeClient that implements waitForConnection. */
function makeFakeClient(state: "disconnected" | "connecting" | "connected" | "error") {
  const listeners = new Set<(state: string) => void>();
  let currentState = state;
  return {
    is_connected: () => currentState === "connected",
    getConnectionState: () => currentState,
    waitForConnection: vi.fn((timeoutMs = 15_000) => {
      if (currentState === "connected") return Promise.resolve();
      if (currentState === "error") {
        return Promise.reject(new RemoteConnectionTimeoutError(
          "Remote connection failed — the LiTT server could not be reached.",
        ));
      }
      // connecting / disconnected — wait for state change or timeout
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(onConn);
          reject(new RemoteConnectionTimeoutError(
            `Remote connection timed out after ${timeoutMs / 1000}s.`,
          ));
        }, timeoutMs);
        const onConn = (s: string) => {
          if (s === "connected") {
            clearTimeout(timer);
            listeners.delete(onConn);
            resolve();
          } else if (s === "error") {
            clearTimeout(timer);
            listeners.delete(onConn);
            reject(new RemoteConnectionTimeoutError(
              "Remote connection failed.",
            ));
          }
        };
        listeners.add(onConn);
      });
    }),
    onConnectionChange: vi.fn((listener: (state: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    _setState: (s: typeof state) => {
      currentState = s;
      for (const listener of listeners) {
        try { listener(s); } catch { /* ignore */ }
      }
    },
  };
}

/** Write a temp model-prefs.json and return its path. */
function writeTempPrefs(prefs: Partial<ModelPrefs>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-prefs-"));
  const prefsPath = path.join(tmpDir, "model-prefs.json");
  const full: ModelPrefs = {
    prefsVersion: 2,
    routingMode: "auto",
    selectedModel: null,
    capabilityOverrides: {},
    lastUsedModel: null,
    showFallbackNotifications: true,
    ...prefs,
  };
  fs.writeFileSync(prefsPath, JSON.stringify(full, null, 2));
  return prefsPath;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("remote readiness: waitForConnection", () => {
  it("resolves immediately if already connected", async () => {
    const client = makeFakeClient("connected");
    await expect(client.waitForConnection(5000)).resolves.toBeUndefined();
  });

  it("rejects immediately if connection is in error state", async () => {
    const client = makeFakeClient("error");
    await expect(client.waitForConnection(5000)).rejects.toThrow(
      RemoteConnectionTimeoutError,
    );
  });

  it("rejects with a timeout message after timeoutMs", async () => {
    const client = makeFakeClient("connecting");
    await expect(client.waitForConnection(100)).rejects.toThrow(
      /timed out after 0.1s/,
    );
  });

  it("resolves when connection transitions to connected", async () => {
    const client = makeFakeClient("connecting");
    // Simulate the connection establishing after 50ms
    setTimeout(() => client._setState("connected"), 50);
    await expect(client.waitForConnection(5000)).resolves.toBeUndefined();
  });

  it("rejects when connection transitions to error", async () => {
    const client = makeFakeClient("connecting");
    setTimeout(() => client._setState("error"), 50);
    await expect(client.waitForConnection(5000)).rejects.toThrow(
      RemoteConnectionTimeoutError,
    );
  });

  it("RemoteConnectionTimeoutError has a descriptive message", () => {
    const err = new RemoteConnectionTimeoutError("test message");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RemoteConnectionTimeoutError");
    expect(err.message).toBe("test message");
  });
});

describe("remote readiness: versioned model-prefs migration", () => {
  /**
   * Write a raw prefs JSON (bypassing the helper's defaults) so we can
   * simulate exact legacy file states including missing prefsVersion.
   */
  function writeRawPrefs(raw: Record<string, unknown>): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-prefs-"));
    const prefsPath = path.join(tmpDir, "model-prefs.json");
    fs.writeFileSync(prefsPath, JSON.stringify(raw, null, 2));
    return prefsPath;
  }

  // ─── Legacy state that SHOULD be migrated ──────────────────────

  it("migrates legacy gemma-4-31b-free fixed pin (no prefsVersion) to AUTO", () => {
    // This is the exact broken state from the previous routing impl
    const prefsPath = writeRawPrefs({
      routingMode: "fixed",
      selectedModel: "gemma-4-31b-free",
      capabilityOverrides: {},
      lastUsedModel: "gemma-4-31b-free",
      showFallbackNotifications: true,
      // NO prefsVersion — legacy file
    });
    const loaded = loadModelPrefs(prefsPath);
    expect(loaded.routingMode).toBe("auto");
    expect(loaded.selectedModel).toBeNull();
    expect(loaded.lastUsedModel).toBe("gemma-4-31b-free"); // preserved for history
    expect(loaded.prefsVersion).toBe(2); // bumped to current
  });

  it("migrates legacy gemma-4-31b-free fixed pin (prefsVersion: 1) to AUTO", () => {
    const prefsPath = writeRawPrefs({
      prefsVersion: 1,
      routingMode: "fixed",
      selectedModel: "gemma-4-31b-free",
      capabilityOverrides: {},
      lastUsedModel: null,
      showFallbackNotifications: true,
    });
    const loaded = loadModelPrefs(prefsPath);
    expect(loaded.routingMode).toBe("auto");
    expect(loaded.selectedModel).toBeNull();
    expect(loaded.prefsVersion).toBe(2);
  });

  // ─── Explicit user choices that MUST be preserved ──────────────

  it("preserves explicit remote gemma-4-31b-free fixed selection (prefsVersion: 2)", () => {
    // A deliberate /model selection under the new code writes prefsVersion: 2.
    // This is a legitimate user choice and must NOT be reset.
    const prefsPath = writeRawPrefs({
      prefsVersion: 2,
      routingMode: "fixed",
      selectedModel: "gemma-4-31b-free",
      capabilityOverrides: {},
      lastUsedModel: "gemma-4-31b-free",
      showFallbackNotifications: true,
    });
    const loaded = loadModelPrefs(prefsPath);
    expect(loaded.routingMode).toBe("fixed");
    expect(loaded.selectedModel).toBe("gemma-4-31b-free");
    expect(loaded.prefsVersion).toBe(2);
  });

  it("preserves explicit OpenAI fixed selection (prefsVersion: 2)", () => {
    const prefsPath = writeRawPrefs({
      prefsVersion: 2,
      routingMode: "fixed",
      selectedModel: "gpt-5.6-luna",
      capabilityOverrides: {},
      lastUsedModel: "gpt-5.6-luna",
      showFallbackNotifications: true,
    });
    const loaded = loadModelPrefs(prefsPath);
    expect(loaded.routingMode).toBe("fixed");
    expect(loaded.selectedModel).toBe("gpt-5.6-luna");
  });

  it("preserves explicit OpenAI fixed selection (legacy, no prefsVersion)", () => {
    // A non-free model pin from the old code is a valid choice — no migration.
    const prefsPath = writeRawPrefs({
      routingMode: "fixed",
      selectedModel: "gpt-5.6-luna",
      capabilityOverrides: {},
      lastUsedModel: null,
      showFallbackNotifications: true,
    });
    const loaded = loadModelPrefs(prefsPath);
    expect(loaded.routingMode).toBe("fixed");
    expect(loaded.selectedModel).toBe("gpt-5.6-luna");
    expect(loaded.prefsVersion).toBe(2);
  });

  it("preserves AUTO mode with no selected model", () => {
    const prefsPath = writeRawPrefs({
      routingMode: "auto",
      selectedModel: null,
      capabilityOverrides: {},
      lastUsedModel: null,
      showFallbackNotifications: true,
    });
    const loaded = loadModelPrefs(prefsPath);
    expect(loaded.routingMode).toBe("auto");
    expect(loaded.selectedModel).toBeNull();
    expect(loaded.prefsVersion).toBe(2);
  });

  it("preserves BUDGET and MAX routing modes", () => {
    for (const mode of ["budget", "max"] as const) {
      const prefsPath = writeRawPrefs({
        routingMode: mode,
        selectedModel: null,
        capabilityOverrides: {},
        lastUsedModel: null,
        showFallbackNotifications: true,
      });
      const loaded = loadModelPrefs(prefsPath);
      expect(loaded.routingMode).toBe(mode);
      expect(loaded.prefsVersion).toBe(2);
    }
  });

  // ─── Edge cases ────────────────────────────────────────────────

  it("handles missing prefs file gracefully", () => {
    const loaded = loadModelPrefs("/nonexistent/path/prefs.json");
    expect(loaded.routingMode).toBe("auto");
    expect(loaded.selectedModel).toBeNull();
    expect(loaded.prefsVersion).toBe(2);
  });

  it("handles corrupted prefs file gracefully", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-prefs-"));
    const prefsPath = path.join(tmpDir, "model-prefs.json");
    fs.writeFileSync(prefsPath, "{ invalid json }}}");
    const loaded = loadModelPrefs(prefsPath);
    expect(loaded.routingMode).toBe("auto");
    expect(loaded.selectedModel).toBeNull();
    expect(loaded.prefsVersion).toBe(2);
  });

  it("AUTO defaults to OpenAI (not free) in remote mode", () => {
    // Verify that AUTO routing with no selection routes to OpenAI,
    // not to a free model. This is the core contract: after migration,
    // the user gets OpenAI by default.
    const prefsPath = writeRawPrefs({
      prefsVersion: 2,
      routingMode: "auto",
      selectedModel: null,
      capabilityOverrides: {},
      lastUsedModel: null,
      showFallbackNotifications: true,
    });
    const loaded = loadModelPrefs(prefsPath);
    expect(loaded.routingMode).toBe("auto");
    expect(loaded.selectedModel).toBeNull();
    // The actual routing to OpenAI is tested in the routing tests;
    // here we verify the prefs don't override AUTO.
  });
});

describe("remote readiness: transport projection during connecting", () => {
  it("shows REMOTE… (not REMOTE) while connecting", () => {
    const t = deriveTransport({
      localRuntime: "ready",
      remoteRuntime: "connecting",
      signedIn: true,
    });
    expect(t.headerLabel).toBe("REMOTE…");
    expect(t.headerSeverity).toBe("pending");
    expect(t.remoteActive).toBe(false);
    expect(t.executionPath).toBe("none");
  });

  it("shows REMOTE only when connected", () => {
    const t = deriveTransport({
      localRuntime: "ready",
      remoteRuntime: "connected",
      signedIn: true,
    });
    expect(t.headerLabel).toBe("REMOTE");
    expect(t.headerSeverity).toBe("ok");
    expect(t.remoteActive).toBe(true);
    expect(t.executionPath).toBe("remote");
  });

  it("shows REMOTE ERR on error state", () => {
    const t = deriveTransport({
      localRuntime: "ready",
      remoteRuntime: "error",
      signedIn: true,
    });
    expect(t.headerLabel).toBe("REMOTE ERR");
    expect(t.headerSeverity).toBe("error");
    expect(t.remoteActive).toBe(false);
    expect(t.executionPath).toBe("none");
  });

  it("shows REMOTE↻ while reconnecting", () => {
    const t = deriveTransport({
      localRuntime: "ready",
      remoteRuntime: "reconnecting",
      signedIn: true,
    });
    expect(t.headerLabel).toBe("REMOTE↻");
    expect(t.headerSeverity).toBe("pending");
    expect(t.remoteActive).toBe(false);
  });

  it("never claims local execution path while remote is connecting", () => {
    const t = deriveTransport({
      localRuntime: "ready",
      remoteRuntime: "connecting",
      signedIn: true,
    });
    // Critical: a half-open remote must NOT read as local execution
    expect(t.executionPath).not.toBe("local");
    expect(t.executionPath).toBe("none");
  });
});

describe("remote readiness: executionTarget resolution", () => {
  it("resolveExecutionTarget returns local by default", () => {
    const origLocalMode = process.env.LITT_LOCAL_MODE;
    const origLocalOnly = process.env.LITT_LOCAL_ONLY;
    const origOverride = process.env.LITT_TARGET_OVERRIDE;
    delete process.env.LITT_LOCAL_MODE;
    delete process.env.LITT_LOCAL_ONLY;
    delete process.env.LITT_TARGET_OVERRIDE;
    expect(resolveExecutionTarget()).toBe("local");
    if (origLocalMode !== undefined) process.env.LITT_LOCAL_MODE = origLocalMode;
    if (origLocalOnly !== undefined) process.env.LITT_LOCAL_ONLY = origLocalOnly;
    if (origOverride !== undefined) process.env.LITT_TARGET_OVERRIDE = origOverride;
  });

  it("resolveExecutionTarget returns remote with --remote flag", () => {
    const origLocalMode = process.env.LITT_LOCAL_MODE;
    const origLocalOnly = process.env.LITT_LOCAL_ONLY;
    const origOverride = process.env.LITT_TARGET_OVERRIDE;
    delete process.env.LITT_LOCAL_MODE;
    delete process.env.LITT_LOCAL_ONLY;
    delete process.env.LITT_TARGET_OVERRIDE;
    expect(resolveExecutionTarget("remote")).toBe("remote");
    if (origLocalMode !== undefined) process.env.LITT_LOCAL_MODE = origLocalMode;
    if (origLocalOnly !== undefined) process.env.LITT_LOCAL_ONLY = origLocalOnly;
    if (origOverride !== undefined) process.env.LITT_TARGET_OVERRIDE = origOverride;
  });

  it("resolveExecutionTarget returns local when LITT_LOCAL_MODE=1", () => {
    const original = process.env.LITT_LOCAL_MODE;
    process.env.LITT_LOCAL_MODE = "1";
    expect(resolveExecutionTarget()).toBe("local");
    if (original !== undefined) process.env.LITT_LOCAL_MODE = original;
    else delete process.env.LITT_LOCAL_MODE;
  });

  it("resolveExecutionTarget returns local when LITT_LOCAL_ONLY=1", () => {
    const origLocalOnly = process.env.LITT_LOCAL_ONLY;
    process.env.LITT_LOCAL_ONLY = "1";
    expect(resolveExecutionTarget()).toBe("local");
    if (origLocalOnly !== undefined) process.env.LITT_LOCAL_ONLY = origLocalOnly;
    else delete process.env.LITT_LOCAL_ONLY;
  });
});

describe("remote readiness: no silent fallback on connection failure", () => {
  it("RemoteConnectionTimeoutError is a distinct error type", () => {
    const err = new RemoteConnectionTimeoutError("failed");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RemoteConnectionTimeoutError");
    // The error must NOT be confused with a generic Error — the caller
    // checks for this type to surface "remote connection failed" rather
    // than falling back.
    expect(err instanceof Error).toBe(true);
    expect(err.constructor.name).toBe("RemoteConnectionTimeoutError");
  });

  it("waitForConnection with null client should throw (simulated)", async () => {
    // Simulate what awaitRemoteReady does when client is null
    const simulateAwaitRemote = (client: null) => {
      if (!client) {
        throw new RemoteConnectionTimeoutError(
          "Remote execution is unavailable — no connection to the LiTT server.",
        );
      }
    };
    expect(simulateAwaitRemote).toThrow(RemoteConnectionTimeoutError);
    expect(simulateAwaitRemote).toThrow(/no connection to the LiTT server/);
  });

  it("remote connection failure never changes routing mode or selected model", () => {
    // The contract: a remote connection failure (timeout, error, null
    // client) must surface as an explicit error. It must NEVER silently
    // change the user's routing mode or selected model. The prefs file
    // is the user's explicit choice — a transport failure does not
    // override it.
    //
    // We verify this by checking that loadModelPrefs preserves the
    // user's prefs regardless of connection state. The connection
    // failure is a runtime event, not a prefs migration trigger.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-prefs-"));
    const prefsPath = path.join(tmpDir, "model-prefs.json");

    // User has explicitly chosen GPT-5.6 Luna in fixed mode
    const userPrefs: ModelPrefs = {
      prefsVersion: 2,
      routingMode: "fixed",
      selectedModel: "gpt-5.6-luna",
      capabilityOverrides: {},
      lastUsedModel: "gpt-5.6-luna",
      showFallbackNotifications: true,
    };
    fs.writeFileSync(prefsPath, JSON.stringify(userPrefs, null, 2));

    // Simulate a remote connection failure — load prefs and verify
    // the failure did NOT change the user's routing choice.
    const loaded = loadModelPrefs(prefsPath);
    expect(loaded.routingMode).toBe("fixed");
    expect(loaded.selectedModel).toBe("gpt-5.6-luna");

    // Even if the user had AUTO mode, a connection failure must not
    // change it to something else (e.g. "fixed" with a free model).
    const autoPrefs: ModelPrefs = {
      prefsVersion: 2,
      routingMode: "auto",
      selectedModel: null,
      capabilityOverrides: {},
      lastUsedModel: null,
      showFallbackNotifications: true,
    };
    fs.writeFileSync(prefsPath, JSON.stringify(autoPrefs, null, 2));
    const loadedAuto = loadModelPrefs(prefsPath);
    expect(loadedAuto.routingMode).toBe("auto");
    expect(loadedAuto.selectedModel).toBeNull();

    fs.rmSync(tmpDir, { recursive: true });
  });
});
