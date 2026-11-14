/**
 * Sandbox workspace executor (Phase 2 lifecycle, design note §2/§4).
 *
 * Proves: gate-closed and non-owner requests never touch the provider
 * (null → host fallthrough); exec responses are HELD until sync-back
 * lands the command's output on the volume; per-workspace locking
 * serializes concurrent execs onto ONE sandbox; prepare clones inside
 * the sandbox with the token confined to per-command env and FAILS
 * CLOSED (destroy + no sync) when verification catches a leak; the
 * persisted binding carries no secrets; boot reconcile clears lost
 * bindings, marks stopped sandboxes paused, and destroys identity
 * mismatches; forward-push records failures as pending and the next
 * exec flushes them loudly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { FakeSandboxProvider } from "../sandbox/testing/fake-providers";
import { SandboxExecGate } from "../sandbox/exec-router";
import { SandboxWorkspaceExecutor } from "../sandbox/workspace-executor";
import {
  getWorkspace,
  upsertWorkspaceDescriptor,
  registerSandboxPrepareHandler,
  prepareWorkspace,
  type WorkspaceDescriptor,
} from "../workspace/WorkspaceManager";
const OWNER = "user_owner_executor";
const OTHER = "user_someone_else";
const TOKEN = ["test", "scoped", "token", "0002"].join("-");

let volumeParent: string;

function gateFor(provider: FakeSandboxProvider, overrides: Partial<{
  providerEnabled: boolean;
  routingEnabled: boolean;
  isOwner: (userId: string) => boolean;
  isVerified: () => boolean;
}> = {}): SandboxExecGate {
  return new SandboxExecGate({
    providerEnabled: overrides.providerEnabled ?? true,
    routingEnabled: overrides.routingEnabled ?? true,
    isOwner: overrides.isOwner ?? ((userId) => userId === OWNER),
    isVerified: overrides.isVerified ?? (() => true),
    templateId: "fake-template",
    provider,
  });
}

function executorFor(provider: FakeSandboxProvider, gate = gateFor(provider)): SandboxWorkspaceExecutor {
  return new SandboxWorkspaceExecutor({ provider, gate, templateId: "fake-template", log: () => {} });
}

function seedDescriptor(projectId: string, userId = OWNER): WorkspaceDescriptor {
  const root = join(volumeParent, userId, projectId);
  mkdirSync(root, { recursive: true });
  const ws: WorkspaceDescriptor = {
    workspaceId: `ws-${projectId}`,
    userId,
    projectId,
    root,
    branch: "main",
    commitSha: "",
    ready: true,
  };
  upsertWorkspaceDescriptor(ws);
  return ws;
}

function persistFilePath(): string {
  const base = process.env.TERMINAL_WORKSPACE_ROOT
    ? resolve(process.env.TERMINAL_WORKSPACE_ROOT)
    : resolve("/tmp/littree-workspaces");
  return join(base, ".workspaces.json");
}

function readPersistedBinding(workspaceId: string): Record<string, unknown> | undefined {
  const parsed = JSON.parse(readFileSync(persistFilePath(), "utf-8")) as Array<Record<string, unknown>>;
  const entry = parsed.find((d) => d.workspaceId === workspaceId);
  return entry?.sandbox as Record<string, unknown> | undefined;
}

beforeEach(() => {
  volumeParent = mkdtempSync(join(tmpdir(), "litt-executor-"));
});

afterEach(() => {
  registerSandboxPrepareHandler(null);
  rmSync(volumeParent, { recursive: true, force: true });
});

describe("gating", () => {
  it("returns null and never creates a sandbox when the gate is closed", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider, gateFor(provider, { isVerified: () => false }));
    const ws = seedDescriptor("proj-gate-closed");
    expect(executor.isAvailableFor(OWNER)).toBe(false);
    await expect(executor.executeCommand(ws, { command: "pwd" })).resolves.toBeNull();
    expect(provider.calls.create).toBe(0);
  });

  it("returns null for a non-owner even with a green gate", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const ws = seedDescriptor("proj-non-owner", OTHER);
    await expect(executor.executeCommand(ws, { command: "pwd" })).resolves.toBeNull();
    expect(provider.calls.create).toBe(0);
  });
});

describe("exec with sync-back held", () => {
  it("lands the command's output files on the volume before resolving", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const ws = seedDescriptor("proj-exec-sync");
    const outcome = await executor.executeCommand(ws, {
      command: "printf '%s' 'hello-volume' > /workspace/out.txt",
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.result.exitCode).toBe(0);
    expect(outcome!.sandboxId).toBeTruthy();
    // The response resolved only AFTER sync-back: the file is here.
    expect(readFileSync(join(ws.root, "out.txt"), "utf-8")).toBe("hello-volume");
    const binding = getWorkspace(ws.workspaceId)?.sandbox;
    expect(binding?.state).toBe("running");
    expect(binding?.lastSyncBackAt).toBeTruthy();
  });

  it("serializes concurrent execs onto a single sandbox via the workspace lock", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const ws = seedDescriptor("proj-locking");
    const [a, b] = await Promise.all([
      executor.executeCommand(ws, { command: "printf '%s' 'A' > /workspace/a.txt" }),
      executor.executeCommand(ws, { command: "printf '%s' 'B' > /workspace/b.txt" }),
    ]);
    expect(a?.result.exitCode).toBe(0);
    expect(b?.result.exitCode).toBe(0);
    expect(a?.sandboxId).toBe(b?.sandboxId);
    expect(provider.calls.create).toBe(1);
    expect(readFileSync(join(ws.root, "a.txt"), "utf-8")).toBe("A");
    expect(readFileSync(join(ws.root, "b.txt"), "utf-8")).toBe("B");
  });

  it("persists a binding with no secret material in .workspaces.json", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const ws = seedDescriptor("proj-persist");
    await executor.executeCommand(ws, { command: "pwd" });
    const binding = readPersistedBinding(ws.workspaceId);
    expect(binding).toBeDefined();
    expect(binding!.sandboxId).toBeTruthy();
    const raw = readFileSync(persistFilePath(), "utf-8");
    expect(raw).not.toContain("fake-traffic");
    expect(raw).not.toContain(TOKEN);
  });
});

describe("prepare (sandbox clone path)", () => {
  it("prepareWorkspace dispatches to the sandbox handler when available", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const sentinel = { workspaceId: "ws-sentinel" } as WorkspaceDescriptor;
    const prepare = vi.fn(async () => sentinel);
    registerSandboxPrepareHandler({
      isAvailableFor: (userId) => executor.isAvailableFor(userId),
      prepare,
    });
    const result = await prepareWorkspace({
      sourceType: "github",
      userId: OWNER,
      projectId: "proj-dispatch",
      installationId: 1,
      owner: "acme",
      repo: "site",
    });
    expect(result).toBe(sentinel);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("clones inside the sandbox, syncs back, and marks the descriptor ready", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const executed: string[] = [];
    const original = provider.execute.bind(provider);
    provider.execute = async (id, input) => {
      executed.push(input.command);
      return original(id, input);
    };
    const ws = await executor.prepareRepoWorkspace({
      userId: OWNER,
      projectId: "proj-prepare",
      installationId: 42,
      owner: "acme",
      repo: "site",
      branch: "main",
      workspaceRoot: volumeParent,
      githubToken: TOKEN,
    });
    expect(ws.ready).toBe(true);
    expect(ws.commitSha).toMatch(/^[0-9a-f]{7,64}$/);
    expect(ws.sandbox?.state).toBe("running");
    // Clone content synced back to the volume; config is sanitized.
    expect(readFileSync(join(ws.root, "README.md"), "utf-8")).toContain("fake clone");
    const config = readFileSync(join(ws.root, ".git", "config"), "utf-8");
    expect(config).toContain("url = https://github.com/acme/site.git");
    expect(config).not.toContain(TOKEN);
    // The token never appeared in any command string.
    for (const command of executed) expect(command).not.toContain(TOKEN);
    expect(JSON.stringify(ws)).not.toContain(TOKEN);
  });

  it("FAILS CLOSED on a config leak: sandbox destroyed, binding cleared, nothing synced", async () => {
    const provider = new FakeSandboxProvider({ cloneLeaksTokenIntoConfig: true });
    const executor = executorFor(provider);
    // The executor wraps prepare failures in a redacted plain Error
    // (the route's error surface must never carry the token); the
    // SandboxCloneVerificationError class itself is proven at the
    // clone layer in sandbox-git-clone.test.ts.
    const failure = await executor.prepareRepoWorkspace({
      userId: OWNER,
      projectId: "proj-prepare-leak",
      installationId: 42,
      owner: "acme",
      repo: "site",
      branch: "main",
      workspaceRoot: volumeParent,
      githubToken: TOKEN,
    }).then(
      () => null,
      (err: unknown) => err as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure!.message).toMatch(/verification/i);
    expect(failure!.message).not.toContain(TOKEN);
    expect(provider.liveSandboxCount()).toBe(0);
    const ws = getWorkspace(`ws-proj-prepare-leak`);
    expect(ws?.sandbox).toBeUndefined();
    // Nothing cloned ever reached the volume.
    expect(ws && existsSync(join(ws.root, ".git"))).toBe(false);
  });
});

describe("reconcileBindings", () => {
  it("clears a binding whose sandbox is gone", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const ws = seedDescriptor("proj-reconcile-lost");
    const outcome = await executor.executeCommand(ws, { command: "pwd" });
    await provider.destroy(outcome!.sandboxId);
    await executor.reconcileBindings();
    expect(getWorkspace(ws.workspaceId)?.sandbox).toBeUndefined();
  });

  it("marks a stopped sandbox paused without waking it", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const ws = seedDescriptor("proj-reconcile-paused");
    const outcome = await executor.executeCommand(ws, { command: "pwd" });
    await provider.stop(outcome!.sandboxId);
    await executor.reconcileBindings();
    expect(getWorkspace(ws.workspaceId)?.sandbox?.state).toBe("paused");
    const instance = await provider.get(outcome!.sandboxId);
    expect(instance?.state).toBe("stopped");
  });

  it("destroys and clears a binding whose sandbox identity does not match", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const ws = seedDescriptor("proj-reconcile-mismatch");
    // A sandbox that belongs to a DIFFERENT workspace identity.
    const foreign = await provider.create({ timeoutMs: 60_000 });
    upsertWorkspaceDescriptor({
      ...ws,
      sandbox: {
        provider: "fake",
        sandboxId: foreign.sandboxId,
        templateId: "fake-template",
        state: "running",
        createdAt: new Date().toISOString(),
        lastSyncBackAt: null,
        lastSyncedHead: null,
        pendingForward: [],
        previewPort: null,
      },
    });
    await executor.reconcileBindings();
    expect(getWorkspace(ws.workspaceId)?.sandbox).toBeUndefined();
    expect(await provider.get(foreign.sandboxId)).toBeNull();
  });
});

describe("forward push", () => {
  it("pushes volume writes into the live sandbox and flushes failures on the next exec", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const ws = seedDescriptor("proj-forward");
    await executor.executeCommand(ws, { command: "pwd" });

    // Happy path: a volume write lands in the sandbox.
    writeFileSync(join(ws.root, "pushed.txt"), "from-volume");
    executor.forwardFileChange(ws, { relPath: "pushed.txt", kind: "write" });
    await executor.withWorkspaceLock(ws.workspaceId, async () => {});
    const t = provider.fileTransfer!;
    const bytes = await t.readFile(getWorkspace(ws.workspaceId)!.sandbox!.sandboxId, "/workspace/pushed.txt");
    expect(new TextDecoder().decode(bytes)).toBe("from-volume");

    // Failure path: break the transfer once — the path is recorded as
    // pending, and the next exec flushes it (loudly) before running.
    const realWrite = t.writeFile.bind(t);
    let failOnce = true;
    t.writeFile = async (...args: Parameters<typeof t.writeFile>) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("transfer down");
      }
      return realWrite(...args);
    };
    writeFileSync(join(ws.root, "late.txt"), "late-content");
    executor.forwardFileChange(ws, { relPath: "late.txt", kind: "write" });
    await executor.withWorkspaceLock(ws.workspaceId, async () => {});
    expect(getWorkspace(ws.workspaceId)?.sandbox?.pendingForward).toContain("late.txt");

    await executor.executeCommand(ws, { command: "pwd" });
    expect(getWorkspace(ws.workspaceId)?.sandbox?.pendingForward).toEqual([]);
    const late = await t.readFile(getWorkspace(ws.workspaceId)!.sandbox!.sandboxId, "/workspace/late.txt");
    expect(new TextDecoder().decode(late)).toBe("late-content");
  });
});
