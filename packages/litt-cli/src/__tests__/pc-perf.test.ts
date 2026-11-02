/**
 * PC performance modes — pure contract tests.
 *
 * Covers:
 *   - buildPerfPlan: correct actions per mode given a system snapshot
 *   - reversibility: LIGHT saves the outgoing scheme; dev/max restore it
 *   - disruptive flags: model unload requires confirmation
 *   - state file: round-trip + validation
 *   - auth gate: pc commands run without login
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { buildPerfPlan, BALANCED_GUID, HIGH_PERF_GUID, MODE_META } from "../lib/pc-plan.js";
import { readPcState, writePcState, pcStatePath } from "../lib/pc-state.js";
import { requiresAuth } from "../index.js";

const ULTIMATE_GUID = "a098ed36-c7a0-4e20-a71b-9d40e0267ac1";

describe("buildPerfPlan", () => {
  it("LIGHT switches power to Balanced when on a performance scheme", () => {
    const plan = buildPerfPlan("light", {
      powerSchemeGuid: ULTIMATE_GUID,
      loadedModels: [],
      savedPerfSchemeGuid: null,
      preload: false,
    });
    const power = plan.actions.find((a) => a.kind === "power-scheme");
    expect(power?.target).toBe(BALANCED_GUID);
    expect(power?.disruptive).toBe(false);
  });

  it("LIGHT skips power switch when already Balanced", () => {
    const plan = buildPerfPlan("light", {
      powerSchemeGuid: BALANCED_GUID,
      loadedModels: [],
      savedPerfSchemeGuid: null,
      preload: false,
    });
    expect(plan.actions.find((a) => a.kind === "power-scheme")).toBeUndefined();
    expect(plan.notes.some((n) => n.includes("already Balanced"))).toBe(true);
  });

  it("LIGHT marks each loaded model for disruptive unload", () => {
    const plan = buildPerfPlan("light", {
      powerSchemeGuid: BALANCED_GUID,
      loadedModels: ["litt-hermes:32k", "litt-hermes-fast:8k"],
      savedPerfSchemeGuid: null,
      preload: false,
    });
    const unloads = plan.actions.filter((a) => a.kind === "ollama-unload");
    expect(unloads.map((a) => a.target)).toEqual(["litt-hermes:32k", "litt-hermes-fast:8k"]);
    expect(unloads.every((a) => a.disruptive)).toBe(true);
  });

  it("LIGHT never touches models that are not loaded", () => {
    const plan = buildPerfPlan("light", {
      powerSchemeGuid: BALANCED_GUID,
      loadedModels: [],
      savedPerfSchemeGuid: null,
      preload: false,
    });
    expect(plan.actions.filter((a) => a.kind === "ollama-unload")).toHaveLength(0);
  });

  it("DEV restores the scheme saved by LIGHT", () => {
    const plan = buildPerfPlan("dev", {
      powerSchemeGuid: BALANCED_GUID,
      loadedModels: [],
      savedPerfSchemeGuid: ULTIMATE_GUID,
      preload: false,
    });
    const power = plan.actions.find((a) => a.kind === "power-scheme");
    expect(power?.target).toBe(ULTIMATE_GUID);
  });

  it("DEV falls back to High Performance when nothing was saved", () => {
    const plan = buildPerfPlan("dev", {
      powerSchemeGuid: BALANCED_GUID,
      loadedModels: [],
      savedPerfSchemeGuid: null,
      preload: false,
    });
    expect(plan.actions.find((a) => a.kind === "power-scheme")?.target).toBe(HIGH_PERF_GUID);
  });

  it("DEV is a no-op on power when already on the performance scheme", () => {
    const plan = buildPerfPlan("dev", {
      powerSchemeGuid: ULTIMATE_GUID,
      loadedModels: [],
      savedPerfSchemeGuid: ULTIMATE_GUID,
      preload: false,
    });
    expect(plan.actions.find((a) => a.kind === "power-scheme")).toBeUndefined();
  });

  it("DEV never overrides a non-Balanced scheme, even without a saved GUID", () => {
    // A custom performance plan (e.g. Ultimate Performance with its own
    // GUID) must not be "restored" to stock High Performance.
    const plan = buildPerfPlan("dev", {
      powerSchemeGuid: ULTIMATE_GUID,
      loadedModels: [],
      savedPerfSchemeGuid: null,
      preload: false,
    });
    expect(plan.actions.find((a) => a.kind === "power-scheme")).toBeUndefined();
    expect(plan.notes.some((n) => n.includes("performance-class"))).toBe(true);
  });

  it("DEV never unloads models and never requires confirmation", () => {
    const plan = buildPerfPlan("dev", {
      powerSchemeGuid: ULTIMATE_GUID,
      loadedModels: ["litt-hermes:32k"],
      savedPerfSchemeGuid: null,
      preload: false,
    });
    expect(plan.actions.filter((a) => a.disruptive)).toHaveLength(0);
    expect(plan.actions.find((a) => a.kind === "ollama-unload")).toBeUndefined();
  });

  it("MAX preloads only with --preload", () => {
    const noPreload = buildPerfPlan("max", {
      powerSchemeGuid: ULTIMATE_GUID,
      loadedModels: [],
      savedPerfSchemeGuid: null,
      preload: false,
    });
    expect(noPreload.actions.find((a) => a.kind === "ollama-preload")).toBeUndefined();

    const withPreload = buildPerfPlan("max", {
      powerSchemeGuid: ULTIMATE_GUID,
      loadedModels: [],
      savedPerfSchemeGuid: null,
      preload: true,
    });
    const pre = withPreload.actions.find((a) => a.kind === "ollama-preload");
    expect(pre?.target).toBe(MODE_META.max.preferredModel);
    expect(pre?.disruptive).toBe(false);
  });

  it("MAX preload is skipped when the model is already loaded", () => {
    const plan = buildPerfPlan("max", {
      powerSchemeGuid: ULTIMATE_GUID,
      loadedModels: [MODE_META.max.preferredModel],
      savedPerfSchemeGuid: null,
      preload: true,
    });
    expect(plan.actions.find((a) => a.kind === "ollama-preload")).toBeUndefined();
    expect(plan.notes.some((n) => n.includes("already loaded"))).toBe(true);
  });

  it("every mode ends with a state action", () => {
    for (const mode of ["light", "dev", "max"] as const) {
      const plan = buildPerfPlan(mode, {
        powerSchemeGuid: null,
        loadedModels: [],
        savedPerfSchemeGuid: null,
        preload: false,
      });
      expect(plan.actions.at(-1)?.kind).toBe("state");
    }
  });
});

describe("pc-mode state", () => {
  it("round-trips through ~/.litt/pc-mode.json", () => {
    const p = pcStatePath();
    let original: string | null = null;
    try { original = readFileSync(p, "utf-8"); } catch { /* none */ }

    writePcState({
      version: 1,
      mode: "dev",
      appliedAt: "2026-10-30T00:00:00.000Z",
      previousMode: "light",
      preferredModel: "litt-hermes:32k",
      restore: { powerSchemeGuid: ULTIMATE_GUID, powerSchemeName: "Ultimate Performance" },
      actions: ["Power scheme → performance plan"],
    });
    const s = readPcState();
    expect(s?.mode).toBe("dev");
    expect(s?.previousMode).toBe("light");
    expect(s?.restore.powerSchemeGuid).toBe(ULTIMATE_GUID);

    if (original !== null) writeFileSync(p, original, "utf-8");
    else unlinkSync(p);
  });

  it("returns null on corrupt state instead of throwing", () => {
    // readPcState reads the real path — validate the guard via a corrupt
    // write+read cycle on the real file, restoring (or removing) afterward.
    const p = pcStatePath();
    let original: string | null = null;
    try { original = readFileSync(p, "utf-8"); } catch { /* none */ }
    writeFileSync(p, "{ not json", "utf-8");
    expect(readPcState()).toBeNull();
    if (original !== null) writeFileSync(p, original, "utf-8");
    else unlinkSync(p);
  });
});

describe("auth gate — pc commands are local machine tools", () => {
  it("requiresAuth is false for pc, pc-status, pc-perf", () => {
    expect(requiresAuth("pc", false, false, false, false)).toBe(false);
    expect(requiresAuth("pc-status", false, false, false, false)).toBe(false);
    expect(requiresAuth("pc-perf", false, false, false, false)).toBe(false);
  });
});
