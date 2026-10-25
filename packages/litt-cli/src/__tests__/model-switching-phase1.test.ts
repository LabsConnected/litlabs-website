/**
 * Phase 1 model-switching regressions (LiTT Mobile stabilization).
 *
 * The defects these tests lock down:
 *
 *   1. reconcileLocalModel used to WRITE the auto-resolved local model
 *      into ~/.litt/model-prefs.json, destroying the operator's
 *      persisted remote selection — contradicting the documented
 *      contract that the remote pin survives LOCAL for later /remote
 *      use. Auto-resolution is now state-only (applyAutoSelectedModel),
 *      and /remote restores the persisted selection through
 *      remoteSelectionOf().
 *
 *   2. A persisted "ollama:" pin (explicit local pick) previously
 *      poisoned REMOTE: strict FIXED routing threw "not in the catalog"
 *      on every request. /remote now drops local-only selections to
 *      AUTO (state only — the disk pin is kept for future /local).
 *
 *   3. /model <arg> did not exist; "/model qwen3:4b" fell through to
 *      "Unknown command". resolveModelArg() now resolves catalog ids,
 *      display names, and installed Ollama tags — with a clear error,
 *      never a silent fallback, when nothing matches.
 *
 *   4. saveModelPrefs/writeAllSessions wrote files non-atomically: a
 *      killed process left truncated JSON that the loaders silently
 *      reset to defaults. Writes are now tmp+rename.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  remoteSelectionOf,
  resolveModelArg,
  isLocalModelId,
  OLLAMA_CANONICAL_PREFIX,
} from "../lib/local-model-resolution.js";
import {
  loadModelPrefs,
  saveModelPrefs,
  type ModelPrefs,
} from "../lib/provider-registry.js";
import type { LocalLaneStatus } from "../lib/local-lane.js";

const ENDPOINT = "http://127.0.0.1:11434";

const LANE_UP: LocalLaneStatus = {
  available: true,
  models: ["litt-oc-phone:1.7b-8k", "huihui_ai/qwen3-abliterated:1.7b", "huihui_ai/qwen3-abliterated:4b"],
  endpoint: ENDPOINT,
  reason: null,
};

const LANE_DOWN: LocalLaneStatus = {
  available: false,
  models: [],
  endpoint: ENDPOINT,
  reason: `local model daemon not reachable at ${ENDPOINT} (fetch failed)`,
};

const CATALOG = [
  { canonicalId: "minimax-m3-free", displayName: "MiniMax M3 (Free)" },
  { canonicalId: "claude-sonnet-5", displayName: "Claude Sonnet 5" },
];

// ─── 1. remoteSelectionOf — the /remote restore rule ────────────────

describe("remoteSelectionOf — what REMOTE may restore from prefs", () => {
  it("passes a persisted cloud selection through unchanged", () => {
    expect(remoteSelectionOf("minimax-m3-free")).toBe("minimax-m3-free");
  });

  it("drops a persisted local-only (ollama:) pin to null", () => {
    // The remote catalog can never serve a daemon tag. Null → AUTO.
    expect(remoteSelectionOf("ollama:litt-oc-phone:1.7b-8k")).toBeNull();
  });

  it("null/undefined stay null", () => {
    expect(remoteSelectionOf(null)).toBeNull();
    expect(remoteSelectionOf(undefined)).toBeNull();
  });

  it("never returns a local-only id — invariant", () => {
    for (const id of ["ollama:qwen3:4b", "ollama:x", "minimax-m3-free", null]) {
      const out = remoteSelectionOf(id);
      expect(out === null || !isLocalModelId(out)).toBe(true);
    }
  });
});

// ─── 2. resolveModelArg — /model <arg> direct selection ─────────────

describe("resolveModelArg — catalog matches", () => {
  it("exact canonicalId", () => {
    const r = resolveModelArg("claude-sonnet-5", CATALOG, LANE_UP);
    expect(r).toEqual({ ok: true, canonicalId: "claude-sonnet-5", label: "Claude Sonnet 5", source: "catalog" });
  });

  it("case-insensitive display name", () => {
    const r = resolveModelArg("minimax m3 (free)", CATALOG, LANE_UP);
    expect(r).toEqual({ ok: true, canonicalId: "minimax-m3-free", label: "MiniMax M3 (Free)", source: "catalog" });
  });
});

describe("resolveModelArg — local daemon matches", () => {
  it("exact installed tag", () => {
    const r = resolveModelArg("litt-oc-phone:1.7b-8k", CATALOG, LANE_UP);
    expect(r).toEqual({
      ok: true,
      canonicalId: `${OLLAMA_CANONICAL_PREFIX}litt-oc-phone:1.7b-8k`,
      label: "litt-oc-phone:1.7b-8k",
      source: "local",
    });
  });

  it("ollama:-prefixed tag", () => {
    const r = resolveModelArg("ollama:huihui_ai/qwen3-abliterated:4b", CATALOG, LANE_UP);
    expect(r).toEqual({
      ok: true,
      canonicalId: "ollama:huihui_ai/qwen3-abliterated:4b",
      label: "huihui_ai/qwen3-abliterated:4b",
      source: "local",
    });
  });

  it("bare prefix expands to the installed tag", () => {
    const r = resolveModelArg("litt-oc-phone", CATALOG, LANE_UP);
    expect(r.ok && r.canonicalId === "ollama:litt-oc-phone:1.7b-8k").toBe(true);
  });

  it("does NOT silently expand a partial tag (litt-oc-phone:1.7b ≠ :1.7b-8k)", () => {
    const r = resolveModelArg("litt-oc-phone:1.7b", CATALOG, LANE_UP);
    expect(r.ok).toBe(false);
  });
});

describe("resolveModelArg — failures are explicit", () => {
  it("unknown model → error listing installed models", () => {
    const r = resolveModelArg("litt-coder:fast", CATALOG, LANE_UP);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("litt-coder:fast");
      expect(r.error).toContain("litt-oc-phone:1.7b-8k");
    }
  });

  it("daemon down → error names the endpoint, never a fake pick", () => {
    const r = resolveModelArg("anything", CATALOG, LANE_DOWN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(ENDPOINT);
  });

  it("empty arg → usage error", () => {
    const r = resolveModelArg("   ", CATALOG, LANE_UP);
    expect(r.ok).toBe(false);
  });
});

// ─── 3. Atomic preference writes ────────────────────────────────────

describe("saveModelPrefs — atomic tmp+rename", () => {
  let dir: string;
  let prefsPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "litt-prefs-"));
    prefsPath = join(dir, "model-prefs.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const prefs: ModelPrefs = {
    prefsVersion: 2,
    routingMode: "fixed",
    selectedModel: "ollama:litt-oc-phone:1.7b-8k",
    capabilityOverrides: {},
    lastUsedModel: "ollama:litt-oc-phone:1.7b-8k",
    showFallbackNotifications: true,
  };

  it("writes valid JSON that loadModelPrefs round-trips", () => {
    saveModelPrefs(prefs, prefsPath);
    expect(loadModelPrefs(prefsPath).selectedModel).toBe("ollama:litt-oc-phone:1.7b-8k");
    expect(loadModelPrefs(prefsPath).routingMode).toBe("fixed");
  });

  it("leaves no temp files behind after the rename", () => {
    saveModelPrefs(prefs, prefsPath);
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("a stale temp file cannot corrupt the real prefs", () => {
    saveModelPrefs(prefs, prefsPath);
    // Simulate a killed process's leftover tmp write.
    writeFileSync(`${prefsPath}.tmp-99999`, "{ truncated json", "utf-8");
    expect(loadModelPrefs(prefsPath).selectedModel).toBe("ollama:litt-oc-phone:1.7b-8k");
  });

  it("a corrupted target still falls back to defaults (unchanged contract)", () => {
    writeFileSync(prefsPath, "{ truncated json", "utf-8");
    expect(loadModelPrefs(prefsPath).selectedModel).toBeNull();
    expect(loadModelPrefs(prefsPath).routingMode).toBe("auto");
  });
});

// ─── 4. Persistence precedence (env > prefs > lane order) ───────────

describe("selection precedence — documented order holds", () => {
  it("a remote prefs selection is never a local request", async () => {
    // resolveRequestedLocalModel must ignore non-ollama persisted ids —
    // this is what kept "MiniMax M3 (Free)" authoritative under LOCAL.
    const { resolveRequestedLocalModel } = await import("../lib/local-model-resolution.js");
    const saved = process.env.LITT_MODEL;
    delete process.env.LITT_MODEL;
    try {
      expect(resolveRequestedLocalModel("minimax-m3-free").model).toBeNull();
      expect(resolveRequestedLocalModel("ollama:litt-oc-phone:1.7b-8k").model)
        .toBe("ollama:litt-oc-phone:1.7b-8k");
    } finally {
      if (saved !== undefined) process.env.LITT_MODEL = saved;
    }
  });

  it("LITT_MODEL env overrides persisted prefs", async () => {
    const { resolveRequestedLocalModel } = await import("../lib/local-model-resolution.js");
    const saved = process.env.LITT_MODEL;
    process.env.LITT_MODEL = "ollama:env-pick";
    try {
      const info = resolveRequestedLocalModel("ollama:prefs-pick");
      expect(info.model).toBe("ollama:env-pick");
      expect(info.source).toBe("env");
    } finally {
      if (saved === undefined) delete process.env.LITT_MODEL;
      else process.env.LITT_MODEL = saved;
    }
  });
});
