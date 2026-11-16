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
import {
  ensureSandboxWorkspaceWritable,
  SandboxWorkspaceExecutor,
  SANDBOX_HOME_DIR,
} from "../sandbox/workspace-executor";
import { SANDBOX_GIT_HOME_DIR } from "../sandbox/git-clone";
import type { SandboxProvider } from "../sandbox/provider";
import {
  getWorkspace,
  upsertWorkspaceDescriptor,
  registerSandboxPrepareHandler,
  prepareWorkspace,
  type WorkspaceDescriptor,
} from "../workspace/WorkspaceManager";
import {
  readVolumeInstallStamp,
  SANDBOX_INSTALL_TIMEOUT_MS,
  sandboxInstallIsFresh,
} from "../sandbox/install-stamp";
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

describe("background install (the lock is not held across the install exec)", () => {
  it("lets another workspace operation complete while the prepare install is still running, then stamps freshness", async () => {
    const provider = new FakeSandboxProvider({
      cloneFiles: {
        "package.json": JSON.stringify({ name: "app", packageManager: "pnpm@9.15.0" }),
        "server.js": "console.log('app');\n",
      },
    });
    const executor = executorFor(provider);

    // Hold the install exec open until the test releases it.
    let releaseInstall!: () => void;
    const installGate = new Promise<void>((resolve) => { releaseInstall = resolve; });
    let installEntered = false;
    const original = provider.execute.bind(provider);
    provider.execute = async (id, input) => {
      if (input.command.includes("install")) {
        installEntered = true;
        await installGate;
      }
      return original(id, input);
    };

    const ws = await executor.prepareRepoWorkspace({
      userId: OWNER,
      projectId: "proj-install-lock",
      installationId: 42,
      owner: "acme",
      repo: "site",
      branch: "main",
      workspaceRoot: volumeParent,
      githubToken: TOKEN,
    });
    const sandboxId = ws.sandbox!.sandboxId;

    // The background install (prepare step 9) reaches its exec.
    const enteredDeadline = Date.now() + 15_000;
    while (!installEntered && Date.now() < enteredDeadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(installEntered).toBe(true);

    // While the install exec is still blocked, an exec for the same
    // workspace must complete. Before the fix, installInSandbox held
    // the per-workspace lock across the whole install (300s budget),
    // and this call queued behind it — the preview-start timeout of
    // 2026-11-15.
    const outcome = await Promise.race([
      executor.executeCommand(ws, { command: "pwd" }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);
    expect(outcome).not.toBeNull();
    expect(outcome!.sandboxId).toBe(sandboxId);

    // Release the install: the stamp + sync-back bookkeeping runs
    // under the lock afterwards, and the sandbox reads fresh.
    releaseInstall();
    const stamp = readVolumeInstallStamp(ws.root);
    expect(stamp).not.toBeNull();
    const freshDeadline = Date.now() + 15_000;
    let fresh = false;
    while (!fresh && Date.now() < freshDeadline) {
      fresh = await sandboxInstallIsFresh(provider, sandboxId, stamp);
      if (!fresh) await new Promise((r) => setTimeout(r, 25));
    }
    expect(fresh).toBe(true);
  });
});

describe("background install budget (round 8)", () => {
  it("runs the prepare background install with the shared SANDBOX_INSTALL_TIMEOUT_MS budget", async () => {
    const provider = new FakeSandboxProvider({
      cloneFiles: {
        "package.json": JSON.stringify({ name: "app", packageManager: "pnpm@9.15.0" }),
        "server.js": "console.log('app');\n",
      },
    });
    const executor = executorFor(provider);
    let installTimeoutMs: number | undefined;
    const original = provider.execute.bind(provider);
    provider.execute = async (id, input) => {
      if (input.command.includes("install")) installTimeoutMs = input.timeoutMs;
      return original(id, input);
    };

    await executor.prepareRepoWorkspace({
      userId: OWNER,
      projectId: "proj-install-budget",
      installationId: 42,
      owner: "acme",
      repo: "site",
      branch: "main",
      workspaceRoot: volumeParent,
      githubToken: TOKEN,
    });

    // The background install fires on a timer after prepare returns.
    const deadline = Date.now() + 15_000;
    while (installTimeoutMs === undefined && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(installTimeoutMs).toBe(SANDBOX_INSTALL_TIMEOUT_MS);
    expect(SANDBOX_INSTALL_TIMEOUT_MS).toBe(900_000);
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
    // Drain the workspace lock chain before asserting. This must pass
    // the DESCRIPTOR: withWorkspaceLock keys the chain by
    // descriptor.workspaceId, and passing the id string here silently
    // keyed a different (empty) chain — the assertion below then raced
    // the fire-and-forget push and passed only on microtask timing,
    // which the ensure-routed push (round 8) legitimately changed.
    await executor.withWorkspaceLock(ws, async () => {});
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
    await executor.withWorkspaceLock(ws, async () => {});
    expect(getWorkspace(ws.workspaceId)?.sandbox?.pendingForward).toContain("late.txt");

    await executor.executeCommand(ws, { command: "pwd" });
    expect(getWorkspace(ws.workspaceId)?.sandbox?.pendingForward).toEqual([]);
    const late = await t.readFile(getWorkspace(ws.workspaceId)!.sandbox!.sandboxId, "/workspace/late.txt");
    expect(new TextDecoder().decode(late)).toBe("late-content");
  });
});

/**
 * Round 7: a sandbox bootstrapped by an exec (or a preview start)
 * never passes through prepare, so nothing registered the mirrored
 * root as a git safe.directory — and every git command the web
 * sends through the exec route exited 128 (dubious ownership: the
 * mirror lands files owned by the provider's files-API user, not
 * the command user). The bootstrap must register it, under the
 * same HOME the exec itself runs with, before the first command.
 */
describe("mirror bootstrap git hygiene (round 7)", () => {
  it("keeps the git module's registration home identical to the exec home", () => {
    // git-clone.ts cannot import the executor's constant (the
    // executor imports git-clone), so the two are pinned equal here.
    expect(SANDBOX_GIT_HOME_DIR).toBe(SANDBOX_HOME_DIR);
    expect(SANDBOX_HOME_DIR).toBe("/home/litt");
  });

  it("registers safe.directory under the exec HOME before the first command runs", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const ws = seedDescriptor("proj-mirror-git");
    const calls: Array<{ command: string; env?: Record<string, string> }> = [];
    const original = provider.execute.bind(provider);
    provider.execute = async (id, input) => {
      calls.push({ command: input.command, env: input.env });
      return original(id, input);
    };

    const outcome = await executor.executeCommand(ws, {
      command: "git status --porcelain=v1 -b",
    });
    expect(outcome).not.toBeNull();

    const registrationIdx = calls.findIndex((c) => c.command.includes("safe.directory"));
    const commandIdx = calls.findIndex((c) => c.command.includes("git status"));
    expect(registrationIdx).toBeGreaterThanOrEqual(0);
    expect(commandIdx).toBeGreaterThan(registrationIdx);
    // The registration and the command read/write ONE global config:
    // both run under the sandbox home, never the base env's
    // /workspace default.
    expect(calls[registrationIdx].env?.HOME).toBe(SANDBOX_HOME_DIR);
    expect(calls[commandIdx].env?.HOME).toBe(SANDBOX_HOME_DIR);
  });
});

/**
 * Round 8 (2026-11-16 proof): a workspace sandbox killed at the
 * provider (E2B's 15-minute hard timeout) stayed bound forever —
 * ensure kept returning the corpse as healthy, so nothing recreated
 * it until a terminal-process restart, and forward pushes fired at
 * the dead id and were recorded pending while the run's evidence
 * probe failed against the same corpse. The provider contract these
 * tests exercise: get() returns null for a sandbox that is gone at
 * the provider (the E2B provider now verifies that against E2B
 * itself — see sandbox-e2b-provider.test.ts), and ensure takes its
 * long-existing recreate branch.
 */
describe("sandbox death and recreation (round 8)", () => {
  it("recreates the sandbox on the next exec after the bound one dies at the provider", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const ws = seedDescriptor("proj-corpse-exec");
    const first = await executor.executeCommand(ws, { command: "pwd" });
    expect(first).not.toBeNull();
    expect(provider.calls.create).toBe(1);

    // The sandbox dies at the provider (out-of-band kill).
    await provider.destroy(first!.sandboxId);

    const second = await executor.executeCommand(ws, { command: "pwd" });
    expect(second).not.toBeNull();
    expect(second!.sandboxId).not.toBe(first!.sandboxId);
    expect(provider.calls.create).toBe(2);
    expect(getWorkspace(ws.workspaceId)?.sandbox?.sandboxId).toBe(second!.sandboxId);
    expect(getWorkspace(ws.workspaceId)?.sandbox?.state).toBe("running");
  });

  it("forward push after the bound sandbox dies lands in a recreated sandbox, not the corpse", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const ws = seedDescriptor("proj-corpse-forward");
    const first = await executor.executeCommand(ws, { command: "pwd" });
    const deadId = first!.sandboxId;
    await provider.destroy(deadId);

    writeFileSync(join(ws.root, "lion.txt"), "lion-content");
    executor.forwardFileChange(ws, { relPath: "lion.txt", kind: "write" });
    await executor.withWorkspaceLock(ws, async () => {});

    const binding = getWorkspace(ws.workspaceId)?.sandbox;
    expect(binding?.sandboxId).not.toBe(deadId);
    expect(binding?.pendingForward).toEqual([]);
    const bytes = await provider.fileTransfer!.readFile(binding!.sandboxId, "/workspace/lion.txt");
    expect(new TextDecoder().decode(bytes)).toBe("lion-content");
  });

  it("re-registers safe.directory when ensure resumes an existing sandbox", async () => {
    const provider = new FakeSandboxProvider();
    const executor = executorFor(provider);
    const ws = seedDescriptor("proj-resume-register");
    const calls: string[] = [];
    const original = provider.execute.bind(provider);
    provider.execute = async (id, input) => {
      calls.push(input.command);
      return original(id, input);
    };

    await executor.executeCommand(ws, { command: "git status --porcelain=v1 -b" });
    // Second exec: ensure takes the RESUME branch (sandbox exists).
    // Registration must be re-issued there too — a sandbox created
    // before the round-7 HOME pin carries a stale registration under
    // the old HOME, and only this branch can heal it short of
    // recreation.
    calls.length = 0;
    await executor.executeCommand(ws, { command: "git status --porcelain=v1 -b" });

    const registrationIdx = calls.findIndex((c) => c.includes("safe.directory"));
    const commandIdx = calls.findIndex((c) => c.includes("git status"));
    expect(registrationIdx).toBeGreaterThanOrEqual(0);
    expect(commandIdx).toBeGreaterThan(registrationIdx);
    expect(provider.calls.create).toBe(1);
  });
});

/**
 * Workspace writability repair (preview EACCES fix, 2026-11-15):
 * /workspace is root-owned 755 in the template while installs run
 * as the non-root command user, so pnpm's first write into the
 * project root (its `_tmp_<pid>_<hash>` store probe) died EACCES.
 * The helper must issue exactly one root chmod over the tree, and
 * must never throw — the install's own result stays authoritative.
 */
describe("ensureSandboxWorkspaceWritable", () => {
  it("runs chmod -R a+rwX on /workspace as root", async () => {
    const calls: Array<{ sandboxId: string; input: unknown }> = [];
    const provider = {
      execute: async (sandboxId: string, input: unknown) => {
        calls.push({ sandboxId, input });
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      },
    } as unknown as SandboxProvider;

    await ensureSandboxWorkspaceWritable(provider, "sbx-9");

    expect(calls).toHaveLength(1);
    expect(calls[0].sandboxId).toBe("sbx-9");
    expect(calls[0].input).toMatchObject({
      command: "chmod -R a+rwX /workspace",
      user: "root",
    });
  });

  it("swallows provider failures so the install's error stays authoritative", async () => {
    const provider = {
      execute: async () => {
        throw new Error("provider down");
      },
    } as unknown as SandboxProvider;

    await expect(
      ensureSandboxWorkspaceWritable(provider, "sbx-9"),
    ).resolves.toBeUndefined();
  });
});
