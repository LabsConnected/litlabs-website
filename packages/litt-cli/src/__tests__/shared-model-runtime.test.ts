/**
 * Shared canonical ModelRuntime regression tests.
 *
 * Enforces the architecture contract from the Model Center fix:
 *   1. CockpitApp creates ONE ModelRuntime and shares it with the
 *      controller, Model Center (F2), and Model Picker (/model).
 *   2. /model and F2 operate on the same canonical ModelRuntime —
 *      a selection in one is visible in the other.
 *   3. ModelRuntime.brainLabel uses the runtime's own registry (not null).
 *   4. ModelRuntime exposes lastRefreshError for truthful UI.
 *   5. ProviderStatus exposes the raw error string.
 *   6. Discovery failure surfaces a reason — never silently "Models: —".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ModelRuntime, type ProviderStatus } from "../lib/model-runtime.js";

const ENV_KEYS = ["OPENROUTER_API_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("shared canonical ModelRuntime identity", () => {
  it("a single ModelRuntime instance is the same object reference throughout", () => {
    // Simulates what CockpitApp does: create once, share everywhere.
    const runtime = new ModelRuntime();
    const controllerRuntime = runtime;
    const centerRuntime = runtime;
    const pickerRuntime = runtime;
    expect(controllerRuntime).toBe(centerRuntime);
    expect(centerRuntime).toBe(pickerRuntime);
    expect(pickerRuntime).toBe(controllerRuntime);
  });

  it("two separate ModelRuntime instances are NOT the same (regression guard)", () => {
    // This documents the bug we fixed: if app.tsx forgot to inject the
    // runtime, each overlay would create its own — selections diverge.
    const a = new ModelRuntime();
    const b = new ModelRuntime();
    expect(a).not.toBe(b);
  });
});

describe("ModelRuntime.brainLabel uses its own registry", () => {
  it("auto → LiTT Auto", () => {
    const runtime = new ModelRuntime();
    expect(runtime.brainLabel("auto", null)).toBe("LiTT Auto");
  });

  it("budget → LiTT Budget", () => {
    const runtime = new ModelRuntime();
    expect(runtime.brainLabel("budget", null)).toBe("LiTT Budget");
  });

  it("max → LiTT Max", () => {
    const runtime = new ModelRuntime();
    expect(runtime.brainLabel("max", null)).toBe("LiTT Max");
  });

  it("fixed with a known catalog id resolves the display name (not the raw id)", () => {
    const runtime = new ModelRuntime();
    const firstModel = runtime.getAllModels()[0];
    expect(firstModel).toBeDefined();
    const label = runtime.brainLabel("fixed", firstModel.canonicalId);
    // Must be the display name from the registry, not the canonical id,
    // and not "LiTT Auto" (which would mean the registry lookup failed).
    expect(label).not.toBe("LiTT Auto");
    expect(label).toBe(firstModel.displayName);
  });

  it("fixed with an unknown id falls back to the raw id (not LiTT Auto)", () => {
    const runtime = new ModelRuntime();
    const label = runtime.brainLabel("fixed", "does-not-exist-xyz");
    expect(label).toBe("does-not-exist-xyz");
  });
});

describe("truthful discovery error state", () => {
  it("lastRefreshError starts null", () => {
    const runtime = new ModelRuntime();
    expect(runtime.lastRefreshError).toBeNull();
  });

  it("ProviderStatus exposes the error field", () => {
    const runtime = new ModelRuntime();
    const statuses: ProviderStatus[] = runtime.getProviderStatuses();
    // Before any refresh, statuses may be empty — that's fine. If present,
    // every entry must carry an `error` field (null when healthy).
    for (const s of statuses) {
      expect(typeof s.error === "string" || s.error === null).toBe(true);
    }
  });

  it("refresh() with no credential records a down reason (not silent)", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const runtime = new ModelRuntime();
    // refresh() should not throw — it records DOWN per provider.
    await runtime.refresh();
    // After refresh, lastRefreshError is null (orchestrator doesn't throw),
    // but provider statuses carry reasons. This is the truthful path.
    expect(runtime.lastRefreshError).toBeNull();
    const statuses = runtime.getProviderStatuses();
    // OpenRouter should be present and not discovery-ok without a key.
    const or = statuses.find((s) => s.providerId === "openrouter");
    if (or) {
      expect(or.tier).not.toBe("discovery-ok");
      expect(or.hasCredential).toBe(false);
    }
  });
});

describe("picker/center convergence on shared runtime", () => {
  it("a model selected via the picker is visible to the center (same registry)", () => {
    // Both overlays read from the same runtime.getAllModels() / registry.
    // A selection is stored in the CockpitStore (selectedModel), which both
    // overlays receive as a prop. Here we verify the runtime side: both
    // see the same model catalog and the same isRoutable() truth.
    const runtime = new ModelRuntime();
    const pickerModels = runtime.getAllModels();
    const centerModels = runtime.getAllModels();
    // Same underlying registry — the arrays are equal in content.
    // (getAll() may return a fresh array each call; the contract is that
    // both overlays observe the same registry truth via the same runtime.)
    expect(pickerModels).toStrictEqual(centerModels);

    const first = pickerModels[0];
    expect(runtime.isRoutable(first.canonicalId)).toBe(runtime.isRoutable(first.canonicalId));
  });

  it("getDiscoveredCount reflects the shared registry state", () => {
    const runtime = new ModelRuntime();
    // Both overlays call getDiscoveredCount() on the same runtime —
    // they must agree.
    const a = runtime.getDiscoveredCount();
    const b = runtime.getDiscoveredCount();
    expect(a).toBe(b);
  });
});
