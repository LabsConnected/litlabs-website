/**
 * Boot reload of the persisted workspace registry (loadPersisted).
 *
 * The defect (preview 404, diagnosed 2026-11-14): loadPersisted silently
 * DROPPED any persisted descriptor whose root directory was not visible
 * at the load instant (volume mount timing during a restart is enough).
 * The web DB still pointed at that workspaceId, so the Studio gate kept
 * reporting the project ready while every registry lookup — preview
 * start above all — 404'd "Workspace not found", and a later registry
 * persist sealed the loss with no code path able to re-register it.
 *
 * The fix keeps root-missing descriptors registered as ready=false (so
 * lookups answer an honest "not ready" and the descriptor survives the
 * next persist) and logs the decision; malformed entries are dropped
 * with a log line instead of silently.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { trustedLocalStubs } from "./helpers/trusted-local-env";

let ROOT: string;
let mod: typeof import("../workspace/WorkspaceManager");
let errorSpy: ReturnType<typeof vi.spyOn>;

function descriptor(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    workspaceId: "ws-x",
    userId: "user-1",
    projectId: "proj-1",
    root: "/nonexistent",
    branch: "main",
    ready: true,
    sourceType: "github",
    ...overrides,
  };
}

beforeEach(async () => {
  ROOT = mkdtempSync(join(tmpdir(), "litt-registry-"));
  const visibleRoot = join(ROOT, "visible-ws");
  mkdirSync(visibleRoot, { recursive: true });

  writeFileSync(
    join(ROOT, ".workspaces.json"),
    JSON.stringify([
      descriptor({ workspaceId: "ws-visible", root: visibleRoot }),
      descriptor({ workspaceId: "ws-missing-root", root: join(ROOT, "not-mounted-yet") }),
      // Malformed: no root at all.
      { workspaceId: "ws-malformed", userId: "user-1", projectId: "proj-1" },
    ]),
  );

  trustedLocalStubs();
  vi.stubEnv("TERMINAL_WORKSPACE_ROOT", ROOT);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  // PERSIST_PATH resolves at module load, so import only after the env
  // points at the fixture registry.
  vi.resetModules();
  mod = await import("../workspace/WorkspaceManager");
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.unstubAllEnvs();
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch {
    // Temp dir is disposable.
  }
});

describe("loadPersisted registry reload", () => {
  it("loads descriptors whose root is visible, unchanged", () => {
    const ws = mod.getWorkspace("ws-visible");
    expect(ws).toBeDefined();
    expect(ws?.ready).toBe(true);
    expect(ws?.root).toBe(join(ROOT, "visible-ws"));
  });

  it("keeps root-missing descriptors registered as ready=false instead of deleting them", () => {
    const ws = mod.getWorkspace("ws-missing-root");
    expect(ws).toBeDefined();
    expect(ws?.ready).toBe(false);
    expect(ws?.root).toBe(join(ROOT, "not-mounted-yet"));
    // It survives in the registry listing, so the next persist keeps it.
    expect(mod.listAllWorkspaceDescriptors().map((d) => d.workspaceId)).toContain("ws-missing-root");
    // And the decision is logged, not silent.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ws-missing-root"));
  });

  it("drops malformed entries (missing root) with a log line", () => {
    expect(mod.getWorkspace("ws-malformed")).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("malformed"));
  });
});

describe("loadPersisted with the registry file itself missing (round 5)", () => {
  it("starts empty AND logs that no registry file was found at load", async () => {
    // Separate fixture root with NO .workspaces.json: the whole-file
    // sibling of the root-missing case above. Before round 5 this
    // returned silently, so a boot that could not see the persist file
    // (volume mount timing) was indistinguishable in the logs from a
    // healthy empty registry — while the web DB kept pointing at the
    // lost ids and every lookup 404'd "Workspace not found".
    const emptyRoot = mkdtempSync(join(tmpdir(), "litt-registry-empty-"));
    try {
      vi.stubEnv("TERMINAL_WORKSPACE_ROOT", emptyRoot);
      vi.resetModules();
      const fresh = await import("../workspace/WorkspaceManager");
      expect(fresh.listAllWorkspaceDescriptors()).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("No persisted workspace registry found"),
      );
    } finally {
      try {
        rmSync(emptyRoot, { recursive: true, force: true });
      } catch {
        // Temp dir is disposable.
      }
    }
  });
});
