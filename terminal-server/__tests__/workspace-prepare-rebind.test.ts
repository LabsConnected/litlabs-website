/**
 * Round 9 (2026-11-16): the prepare route's idempotency short-circuit
 * certified READY descriptors as-is — including descriptors whose
 * sandbox binding boot reconcile had just cleared as lost. The heal
 * calling prepare went away believing the binding was restored; the
 * workspace stayed sandbox-less and every sandbox-backed surface
 * kept failing. shouldServeExistingWorkspace is the route's decision:
 * a ready descriptor with a dead/absent binding may be served as-is
 * ONLY when the sandbox prepare path is unavailable for the user
 * (gate-closed deployments keep their previous behavior); when it is
 * available, prepare must run so the executor rebinds.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { trustedLocalStubs } from "./helpers/trusted-local-env";

let ROOT: string;
let mod: typeof import("../workspace/WorkspaceManager");

const USER = "user-1";

function descriptor(
  overrides: Partial<import("../workspace/WorkspaceManager").WorkspaceDescriptor> = {},
): import("../workspace/WorkspaceManager").WorkspaceDescriptor {
  return {
    workspaceId: "ws-proj-1",
    userId: USER,
    projectId: "proj-1",
    root: join(ROOT, "ws-root"),
    branch: "main",
    commitSha: "abc123",
    ready: true,
    ...overrides,
  };
}

function binding(
  state: "provisioning" | "running" | "paused" | "lost",
  sandboxId = "sbx-1",
): import("../workspace/WorkspaceManager").WorkspaceSandboxBinding {
  return {
    provider: "e2b",
    sandboxId,
    templateId: "litt-sandbox-v1",
    state,
    createdAt: new Date().toISOString(),
    lastSyncBackAt: null,
    lastSyncedHead: null,
    pendingForward: [],
    previewPort: null,
  };
}

function registerHandler(available: boolean) {
  const prepare = vi.fn(async (input: import("../workspace/WorkspaceManager").PrepareInput) => {
    const rebound = descriptor({
      sandbox: binding("running", "sbx-new"),
    });
    mod.upsertWorkspaceDescriptor(rebound);
    return rebound;
  });
  mod.registerSandboxPrepareHandler({
    isAvailableFor: () => available,
    prepare,
  });
  return prepare;
}

beforeEach(async () => {
  ROOT = mkdtempSync(join(tmpdir(), "litt-rebind-"));
  mkdirSync(join(ROOT, "ws-root"), { recursive: true });
  trustedLocalStubs();
  vi.stubEnv("TERMINAL_WORKSPACE_ROOT", ROOT);
  vi.resetModules();
  mod = await import("../workspace/WorkspaceManager");
});

afterEach(() => {
  mod.registerSandboxPrepareHandler(null);
  vi.unstubAllEnvs();
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch {
    // Temp dir is disposable.
  }
});

describe("shouldServeExistingWorkspace (round 9 fix A)", () => {
  it("does NOT serve a ready descriptor whose binding is lost when the sandbox path is available", () => {
    registerHandler(true);
    const existing = descriptor({ sandbox: binding("lost") });
    expect(mod.shouldServeExistingWorkspace(existing, USER)).toBe(false);
  });

  it("does NOT serve a ready descriptor whose binding was cleared (absent) when the sandbox path is available", () => {
    registerHandler(true);
    // The exact post-reconcile state of round 9: descriptor ready,
    // `sandbox` deleted by reconcileBindings.
    const existing = descriptor();
    expect(existing.sandbox).toBeUndefined();
    expect(mod.shouldServeExistingWorkspace(existing, USER)).toBe(false);
  });

  it("serves a ready descriptor with a live binding without re-preparing", () => {
    registerHandler(true);
    expect(mod.shouldServeExistingWorkspace(descriptor({ sandbox: binding("running") }), USER)).toBe(true);
    expect(mod.shouldServeExistingWorkspace(descriptor({ sandbox: binding("paused") }), USER)).toBe(true);
  });

  it("still serves a ready descriptor with a dead binding when the sandbox path is unavailable", () => {
    registerHandler(false);
    // Gate-closed deployment: falling through would run the host
    // body and 503 in production even though the volume workspace is
    // usable — the previous behavior is preserved deliberately.
    expect(mod.shouldServeExistingWorkspace(descriptor({ sandbox: binding("lost") }), USER)).toBe(true);
    expect(mod.shouldServeExistingWorkspace(descriptor(), USER)).toBe(true);
  });

  it("never serves a not-ready descriptor", () => {
    registerHandler(true);
    expect(
      mod.shouldServeExistingWorkspace(descriptor({ ready: false, sandbox: binding("running") }), USER),
    ).toBe(false);
  });

  it("treats a stale provisioning binding (no sandbox id) as dead", () => {
    registerHandler(true);
    expect(
      mod.shouldServeExistingWorkspace(descriptor({ sandbox: binding("provisioning", "") }), USER),
    ).toBe(false);
  });

  it("prepareWorkspace dispatches to the sandbox handler, which rebinds the workspace", async () => {
    const prepare = registerHandler(true);
    mod.upsertWorkspaceDescriptor(descriptor({ sandbox: binding("lost") }));

    const result = await mod.prepareWorkspace({
      userId: USER,
      projectId: "proj-1",
      installationId: 1,
      owner: "LabsConnected",
      repo: "litlabs-website",
      branch: "main",
      workspaceRoot: ROOT,
      existingWorkspaceId: "ws-proj-1",
    });

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(result.sandbox?.state).toBe("running");
    expect(result.sandbox?.sandboxId).toBe("sbx-new");
    expect(mod.getWorkspace("ws-proj-1")?.sandbox?.sandboxId).toBe("sbx-new");
  });
});
