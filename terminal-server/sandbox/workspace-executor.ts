/**
 * Sandbox workspace executor — Phase 2 lifecycle (design note §4.6,
 * §4.1, §2, §1.3).
 *
 * This is the piece that makes repo workspaces actually LIVE inside
 * sandboxes: it owns the descriptor binding, the per-workspace lock,
 * sandbox creation/resume/reconcile, the exec path with sync-back
 * held before the response, /ws-files forward-push, and the sandbox
 * prepare sequence. The Phase 1 exec router (exec-router.ts) stays
 * as the gate's home; this executor consumes the same gate and the
 * same provider, and supersedes the router's ad-hoc in-memory
 * bindings with the persisted descriptor binding (design note §2) on
 * the one routed surface.
 *
 * The predicate (§4.6): a user gets the sandbox path exactly when
 * the exec gate decides allowed — real provider configured, routing
 * enabled (staging, or production with its explicit switch), owner
 * allowlist, and a fresh green canary. The gate's decision is the
 * §4.6 predicate plus the Phase 2 routing switch: a fail-closed
 * superset, and the same decision the sandbox-availability endpoint
 * reports to the web app, so the two can never disagree. When the
 * gate is closed every method here declines (null / not-available)
 * and callers fall through to the pre-Phase-2 paths byte-identically
 * — non-owner behavior does not change. isolation-policy.ts is not
 * edited; the host guard still produces the coded 503 on fallthrough.
 *
 * Path mapping: a workspace's volume root maps to the sandbox root
 * "/workspace" (the template's WORKDIR and the provider's default
 * command cwd). Sandbox HOME is "/home/litt" (sandbox.Dockerfile) —
 * outside the synced tree, so ~/.npm, ~/.gitconfig and ~/.config/gh
 * never sync to the volume; platform-issued commands pin it through
 * per-command env because the composed base env still carries the
 * Phase 1 HOME default.
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import type { SandboxExecGate } from "./exec-router";
import type {
  ExecuteCommandResult,
  SandboxInstance,
  SandboxProvider,
} from "./provider";
import {
  buildShellCommand,
  isSandboxOnlyPath,
  listSandboxTree,
  mirrorVolumeToSandbox,
  pushVolumePath,
  renameSandboxPath,
  requireFileTransfer,
  resolveSyncQuotas,
  syncBack,
  type SyncManifest,
  type SyncQuotas,
} from "./sync";
import {
  cloneInSandbox,
  redactToken,
  revParseHead,
  sanitizeRemote,
  validateCloneTarget,
  verifyCloneSanitized,
  SandboxCloneError,
  SandboxCloneVerificationError,
} from "./git-clone";
import {
  getWorkspace,
  listAllWorkspaceDescriptors,
  managedWorkspaceId,
  managedWorkspaceRoot,
  updateWorkspaceSandboxBinding,
  upsertWorkspaceDescriptor,
  type PrepareInput,
  type WorkspaceDescriptor,
  type WorkspaceSandboxBinding,
} from "../workspace/WorkspaceManager";

/** The workspace root inside every sandbox (template WORKDIR). */
export const SANDBOX_WORKSPACE_ROOT = "/workspace";
/** HOME inside the sandbox — outside the synced tree (Dockerfile). */
export const SANDBOX_HOME_DIR = "/home/litt";

export interface SandboxWorkspaceExecutorDeps {
  provider: SandboxProvider;
  gate: SandboxExecGate;
  /** Template the provider boots (recorded on the binding). */
  templateId: string;
  log?: (message: string) => void;
  quotas?: SyncQuotas;
}

export interface ExecutorExecInput {
  command: string;
  stdin?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ExecutorExecOutcome {
  result: ExecuteCommandResult;
  sandboxId: string;
}

export interface ForwardFileChange {
  /** Workspace-relative POSIX path the volume mutation touched. */
  relPath: string;
  kind: "write" | "delete" | "mkdir" | "rename";
  /** For kind "rename": the new workspace-relative path. */
  newRelPath?: string;
}

export class SandboxWorkspaceExecutor {
  private readonly provider: SandboxProvider;
  private readonly gate: SandboxExecGate;
  private readonly templateId: string;
  private readonly log: (message: string) => void;
  private readonly quotas: SyncQuotas;
  /** workspaceId -> tail of the per-workspace serialization chain. */
  private readonly locks = new Map<string, Promise<void>>();
  /** workspaceId -> sandbox manifest as of the last completed sync. */
  private readonly manifests = new Map<string, SyncManifest>();

  constructor(deps: SandboxWorkspaceExecutorDeps) {
    this.provider = deps.provider;
    this.gate = deps.gate;
    this.templateId = deps.templateId;
    this.log = deps.log ?? ((m) => console.info(m));
    this.quotas = deps.quotas ?? resolveSyncQuotas();
  }

  /** The §4.6 predicate, via the gate (see module docstring). */
  isAvailableFor(userId: string): boolean {
    return this.gate.decide(userId).allowed;
  }

  // ─── Locking (§1.3 rule 3) ──────────────────────────────────────

  /**
   * Serialize fn on the workspace's chain. The chain itself never
   * rejects, so one failed operation cannot wedge the workspace.
   */
  private async withLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(workspaceId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((res) => {
      release = res;
    });
    this.locks.set(
      workspaceId,
      prior.then(() => current),
    );
    await prior;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // ─── Binding helpers ────────────────────────────────────────────

  private fresh(descriptor: WorkspaceDescriptor): WorkspaceDescriptor {
    return getWorkspace(descriptor.workspaceId) ?? descriptor;
  }

  private persistBinding(descriptor: WorkspaceDescriptor): void {
    updateWorkspaceSandboxBinding(descriptor.workspaceId, descriptor.sandbox);
  }

  private identityMatches(
    instance: SandboxInstance,
    descriptor: WorkspaceDescriptor,
  ): boolean {
    return (
      instance.userId === descriptor.userId &&
      instance.projectId === descriptor.projectId &&
      instance.workspaceId === descriptor.workspaceId
    );
  }

  /**
   * Create, resume, or reconcile the workspace's sandbox (under the
   * caller's lock). Identity is re-verified against provider.get on
   * every call (§2.3): a binding that points at a sandbox owned by
   * anyone else is destroyed, never reused.
   */
  private async ensureSandboxLocked(
    descriptorIn: WorkspaceDescriptor,
    options: { bootstrap: "mirror" | "none" },
  ): Promise<{ sandboxId: string; created: boolean }> {
    const descriptor = this.fresh(descriptorIn);
    const binding = descriptor.sandbox;

    if (binding && binding.state !== "lost" && binding.sandboxId) {
      let instance: SandboxInstance | null = null;
      try {
        instance = await this.provider.get(binding.sandboxId);
      } catch {
        instance = null;
      }
      if (instance && this.identityMatches(instance, descriptor)) {
        if (instance.state === "stopped") {
          await this.provider.start(binding.sandboxId);
        }
        if (binding.state !== "running") {
          binding.state = "running";
          this.persistBinding(descriptor);
        }
        return { sandboxId: binding.sandboxId, created: false };
      }
      if (instance) {
        // Identity mismatch: never reuse another tenant's sandbox.
        this.log(
          `[sandbox-lifecycle] identity mismatch on sandbox=${binding.sandboxId} ` +
            `workspace=${descriptor.workspaceId}; destroying it`,
        );
        await this.provider.destroy(binding.sandboxId).catch(() => {});
      } else {
        this.log(
          `[sandbox-lifecycle] sandbox=${binding.sandboxId} for workspace=${descriptor.workspaceId} ` +
            "is gone at the provider; binding cleared, volume holds the last synced state",
        );
      }
      delete descriptor.sandbox;
      this.persistBinding(descriptor);
      this.manifests.delete(descriptor.workspaceId);
    }

    // Provision: write the provisioning binding first (§2.3), then
    // create, then write the id.
    const provisional: WorkspaceSandboxBinding = {
      provider: this.provider.name,
      sandboxId: "",
      templateId: this.templateId,
      state: "provisioning",
      createdAt: new Date().toISOString(),
      lastSyncBackAt: binding?.lastSyncBackAt ?? null,
      lastSyncedHead: binding?.lastSyncedHead ?? null,
      pendingForward: binding?.pendingForward ?? [],
      previewPort: binding?.previewPort ?? null,
    };
    descriptor.sandbox = provisional;
    this.persistBinding(descriptor);

    const created = await this.provider.create({
      workspaceId: descriptor.workspaceId,
      userId: descriptor.userId,
      projectId: descriptor.projectId,
    });

    provisional.sandboxId = created.sandboxId;
    provisional.state = "running";
    provisional.createdAt = created.createdAt;
    this.persistBinding(descriptor);
    this.log(
      `[sandbox-lifecycle] created sandbox=${created.sandboxId} user=${descriptor.userId} ` +
        `project=${descriptor.projectId} workspace=${descriptor.workspaceId}`,
    );

    if (options.bootstrap === "mirror") {
      const mirror = await mirrorVolumeToSandbox(this.provider, created.sandboxId, {
        volumeRoot: descriptor.root,
        sandboxRoot: SANDBOX_WORKSPACE_ROOT,
      });
      this.manifests.set(descriptor.workspaceId, mirror.manifest);
    } else {
      this.manifests.set(descriptor.workspaceId, new Map());
    }
    return { sandboxId: created.sandboxId, created: true };
  }

  /** Clear the sandbox workspace dir's contents (fresh clone target). */
  private async clearSandboxTreeLocked(sandboxId: string): Promise<void> {
    const transfer = requireFileTransfer(this.provider);
    const entries = await transfer.listDir(sandboxId, SANDBOX_WORKSPACE_ROOT);
    for (const entry of entries) {
      await transfer.removePath(sandboxId, `${SANDBOX_WORKSPACE_ROOT}/${entry.path}`);
    }
  }

  // ─── Exec (§1.3: response held until sync-back completes) ───────

  /**
   * Execute a command in the workspace's sandbox. Returns null when
   * the gate is closed (the caller falls through to the legacy path,
   * byte-identical for non-owners). Throws on provider/sync failure
   * after the gate opened — never falls back to host execution.
   */
  async executeCommand(
    descriptorIn: WorkspaceDescriptor,
    input: ExecutorExecInput,
  ): Promise<ExecutorExecOutcome | null> {
    if (!this.isAvailableFor(descriptorIn.userId)) return null;
    const descriptor = this.fresh(descriptorIn);
    return this.withLock(descriptor.workspaceId, async () => {
      const ws = this.fresh(descriptor);
      const { sandboxId } = await this.ensureSandboxLocked(ws, { bootstrap: "mirror" });
      await this.flushPendingForwardLocked(ws, sandboxId);

      const result = await this.provider.execute(sandboxId, {
        command: input.command,
        stdin: input.stdin,
        timeoutMs: input.timeoutMs,
        cwd: SANDBOX_WORKSPACE_ROOT,
        env: { ...(input.env ?? {}), HOME: SANDBOX_HOME_DIR },
      });

      await this.syncBackLocked(ws, sandboxId);
      this.log(
        `[sandbox-lifecycle] exec sandbox=${sandboxId} user=${ws.userId} project=${ws.projectId} ` +
          `workspace=${ws.workspaceId} exit=${result.exitCode}`,
      );
      return { result, sandboxId };
    });
  }

  /** Sync the sandbox back to the volume and stamp the binding. */
  private async syncBackLocked(
    descriptor: WorkspaceDescriptor,
    sandboxId: string,
  ): Promise<void> {
    const previous = this.manifests.get(descriptor.workspaceId) ?? null;
    const { manifest } = await syncBack(this.provider, sandboxId, {
      sandboxRoot: SANDBOX_WORKSPACE_ROOT,
      volumeRoot: descriptor.root,
      previous,
      quotas: this.quotas,
    });
    this.manifests.set(descriptor.workspaceId, manifest);

    let head: string | null = null;
    try {
      head = await revParseHead(this.provider, sandboxId, SANDBOX_WORKSPACE_ROOT);
    } catch {
      head = descriptor.sandbox?.lastSyncedHead ?? null; // not a git repo (yet)
    }
    const binding = descriptor.sandbox;
    if (binding) {
      binding.lastSyncBackAt = new Date().toISOString();
      binding.lastSyncedHead = head;
      this.persistBinding(descriptor);
    }
  }

  // ─── Forward push (§1.3 rule 2) ─────────────────────────────────

  /**
   * Queue a volume mutation's push into the workspace's live sandbox.
   * Fire-and-forget by design (the /ws-files routes must not hang on
   * it): the push rides the workspace lock chain, so ordering with
   * exec and sync is preserved; a failed push is recorded on the
   * binding's pendingForward and flushed — loudly — by the next exec
   * or preview start. With no live sandbox there is nothing to do.
   */
  forwardFileChange(descriptorIn: WorkspaceDescriptor, change: ForwardFileChange): void {
    const descriptor = this.fresh(descriptorIn);
    const binding = descriptor.sandbox;
    if (!binding || binding.state === "lost" || !binding.sandboxId) return;
    if (isSandboxOnlyPath(change.relPath)) return;
    const sandboxId = binding.sandboxId;
    void this.withLock(descriptor.workspaceId, async () => {
      const ws = this.fresh(descriptor);
      if (!ws.sandbox || ws.sandbox.sandboxId !== sandboxId) return;
      try {
        if (change.kind === "rename" && change.newRelPath) {
          await renameSandboxPath(this.provider, sandboxId, {
            sandboxRoot: SANDBOX_WORKSPACE_ROOT,
            oldRelPath: change.relPath,
            newRelPath: change.newRelPath,
          });
        } else {
          await pushVolumePath(this.provider, sandboxId, {
            volumeRoot: ws.root,
            sandboxRoot: SANDBOX_WORKSPACE_ROOT,
            relPath: change.relPath,
          });
        }
        this.unmarkPending(ws, change);
      } catch (err) {
        this.markPending(ws, change);
        this.log(
          `[sandbox-lifecycle] forward push failed for workspace=${ws.workspaceId} ` +
            `path=${change.relPath} (recorded pending): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  private markPending(descriptor: WorkspaceDescriptor, change: ForwardFileChange): void {
    const binding = descriptor.sandbox;
    if (!binding) return;
    const paths = change.kind === "rename" && change.newRelPath
      ? [change.relPath, change.newRelPath]
      : [change.relPath];
    for (const p of paths) {
      if (!binding.pendingForward.includes(p)) binding.pendingForward.push(p);
    }
    this.persistBinding(descriptor);
  }

  private unmarkPending(descriptor: WorkspaceDescriptor, change: ForwardFileChange): void {
    const binding = descriptor.sandbox;
    if (!binding || binding.pendingForward.length === 0) return;
    const paths = new Set(
      change.kind === "rename" && change.newRelPath
        ? [change.relPath, change.newRelPath]
        : [change.relPath],
    );
    const next = binding.pendingForward.filter((p) => !paths.has(p));
    if (next.length !== binding.pendingForward.length) {
      binding.pendingForward = next;
      this.persistBinding(descriptor);
    }
  }

  /**
   * Push every pending path before real work (exec, preview start).
   * Fails LOUDLY: a workspace whose volume and sandbox disagree must
   * not quietly run commands against stale content.
   */
  private async flushPendingForwardLocked(
    descriptor: WorkspaceDescriptor,
    sandboxId: string,
  ): Promise<void> {
    const binding = descriptor.sandbox;
    if (!binding || binding.pendingForward.length === 0) return;
    const failures: string[] = [];
    for (const relPath of [...binding.pendingForward]) {
      try {
        await pushVolumePath(this.provider, sandboxId, {
          volumeRoot: descriptor.root,
          sandboxRoot: SANDBOX_WORKSPACE_ROOT,
          relPath,
        });
        binding.pendingForward = binding.pendingForward.filter((p) => p !== relPath);
      } catch (err) {
        failures.push(`${relPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.persistBinding(descriptor);
    if (failures.length > 0) {
      throw new Error(
        `Pending forward push failed for workspace ${descriptor.workspaceId}: ${failures.join("; ")}`,
      );
    }
  }

  // ─── Prepare (§4.1 sequence) ────────────────────────────────────

  /**
   * The sandbox prepare for a GitHub-backed workspace. Replaces the
   * host body of WorkspaceManager.prepareWorkspace when the executor
   * is available for the user; the returned descriptor and the route
   * response keep their exact pre-Phase-2 shape.
   */
  async prepareRepoWorkspace(input: PrepareInput): Promise<WorkspaceDescriptor> {
    // 1. Validate before any state is touched (the host path does
    // not validate these today; the sandbox path must — §4.1 step 1).
    validateCloneTarget({
      owner: input.owner,
      repo: input.repo,
      branch: input.branch,
    });

    // 2. Resolve root and id exactly as the host path does.
    const root = input.existingRoot && existsSync(input.existingRoot)
      ? input.existingRoot
      : managedWorkspaceRoot(input.workspaceRoot, input.userId, input.projectId);
    const workspaceId = input.existingWorkspaceId || managedWorkspaceId(input.projectId);

    return this.withLock(workspaceId, async () => {
      mkdirSync(root, { recursive: true });
      const volumeHasGit = existsSync(join(root, ".git"));

      const existing = getWorkspace(workspaceId);
      const descriptor: WorkspaceDescriptor = existing ?? {
        workspaceId,
        userId: input.userId,
        projectId: input.projectId,
        root,
        branch: input.branch,
        commitSha: "",
        ready: false,
      };
      descriptor.root = root;
      descriptor.branch = input.branch;
      if (!existing) upsertWorkspaceDescriptor(descriptor);

      // 3. Create or resume the sandbox + binding.
      const { sandboxId } = await this.ensureSandboxLocked(descriptor, {
        bootstrap: volumeHasGit ? "mirror" : "none",
      });

      try {
        let commitSha: string;
        if (!volumeHasGit) {
          // 4a. Fresh: clone inside the sandbox (§4.3). The sandbox
          // may hold a stale tree from a lost volume — clear it so
          // the clone target is empty, as git requires.
          await this.clearSandboxTreeLocked(sandboxId);
          const cloned = await cloneInSandbox(this.provider, sandboxId, {
            owner: input.owner,
            repo: input.repo,
            branch: input.branch,
            githubToken: input.githubToken ?? null,
            sandboxRoot: SANDBOX_WORKSPACE_ROOT,
          });
          commitSha = cloned.commitSha;
          // The whole tree is new: reset the sync baseline so the
          // sync-back below copies everything and deletes nothing.
          this.manifests.set(workspaceId, new Map());
        } else {
          // 4b. Volume has .git: the mirror already ran (volume
          // wins). No fetch, no pull (§4.5). Sanitize + verify the
          // mirrored remote before anything syncs back (§4.1 step 5).
          await sanitizeRemote(this.provider, sandboxId, {
            owner: input.owner,
            repo: input.repo,
            branch: input.branch,
            sandboxRoot: SANDBOX_WORKSPACE_ROOT,
          });
          await verifyCloneSanitized(this.provider, sandboxId, {
            owner: input.owner,
            repo: input.repo,
            branch: input.branch,
            githubToken: input.githubToken ?? null,
            sandboxRoot: SANDBOX_WORKSPACE_ROOT,
          });
          // 6. HEAD from inside the sandbox.
          commitSha = await revParseHead(this.provider, sandboxId, SANDBOX_WORKSPACE_ROOT);
        }

        // 7. Sync back to the volume.
        await this.syncBackLocked(descriptor, sandboxId);

        // 8. Register ready, persist, return the unchanged shape.
        descriptor.commitSha = commitSha;
        descriptor.ready = true;
        upsertWorkspaceDescriptor(descriptor);
      } catch (err) {
        // A failed verification means the sandbox may hold a leaked
        // credential in .git/config: destroy it, sync nothing (§4.3).
        // A failed clone leaves a partial tree: destroy it too, so
        // the next prepare starts from a clean sandbox rather than a
        // poisoned binding.
        if (
          err instanceof SandboxCloneVerificationError ||
          err instanceof SandboxCloneError
        ) {
          await this.provider.destroy(sandboxId).catch(() => {});
          delete descriptor.sandbox;
          this.persistBinding(descriptor);
          this.manifests.delete(workspaceId);
        }
        throw new Error(
          redactToken(err instanceof Error ? err.message : String(err), input.githubToken),
        );
      }

      // 9. Install AFTER the response: fire-and-forget on a timer so
      // the route's res.json goes out first (the web prepare budget
      // is 180s; the install alone may run 300s). Failure is
      // non-fatal, exactly as on the host path — preview start
      // installs when node_modules is missing in the sandbox.
      const installDescriptor = { ...descriptor };
      setTimeout(() => {
        void this.installInSandbox(installDescriptor).catch((err) => {
          this.log(
            `[sandbox-lifecycle] background install failed for workspace=${workspaceId}: ` +
              (err instanceof Error ? err.message : String(err)),
          );
        });
      }, 0);

      return descriptor;
    });
  }

  /**
   * Dependency install inside the sandbox (§4.4): allowlisted base
   * env only (the provider composes it), NODE_ENV=development, no
   * GitHub token — the token's job ended at clone. Package-manager
   * selection and the TypeScript pre-install mirror the host path,
   * reading package.json from the volume.
   */
  private async installInSandbox(descriptor: WorkspaceDescriptor): Promise<void> {
    await this.withLock(descriptor.workspaceId, async () => {
      const ws = this.fresh(descriptor);
      const binding = ws.sandbox;
      if (!binding?.sandboxId) return;
      const sandboxId = binding.sandboxId;
      if (!existsSync(join(ws.root, "package.json"))) return;

      // Skip when the sandbox already has dependencies.
      const probe = await this.provider.execute(sandboxId, {
        command: "test -d node_modules",
        cwd: SANDBOX_WORKSPACE_ROOT,
        timeoutMs: 15_000,
      }).catch(() => ({ exitCode: 1 }));
      if (probe.exitCode === 0) return;

      const pkg = JSON.parse(readFileSync(join(ws.root, "package.json"), "utf-8")) as {
        packageManager?: string;
        devDependencies?: Record<string, string>;
      };
      const pm = pkg.packageManager?.startsWith("pnpm") ? "pnpm"
        : pkg.packageManager?.startsWith("yarn") ? "yarn"
        : existsSync(join(ws.root, "pnpm-lock.yaml")) ? "pnpm"
        : existsSync(join(ws.root, "yarn.lock")) ? "yarn"
        : "npm";

      const env = {
        NODE_ENV: "development",
        NPM_CONFIG_IGNORE_WORKSPACE_ROOT_CHECK: "true",
        HOME: SANDBOX_HOME_DIR,
      };
      try {
        await this.provider.execute(sandboxId, {
          command: buildShellCommand([pm, "install", "--prefer-offline"]),
          cwd: SANDBOX_WORKSPACE_ROOT,
          timeoutMs: 300_000,
          env,
        });
      } catch {
        // Non-fatal — preview start retries the install (§4.1 step 9).
        return;
      }

      if (existsSync(join(ws.root, "tsconfig.json")) && pkg.devDependencies?.typescript == null) {
        const addArgs = pm === "pnpm"
          ? ["add", "--save-dev", "--save-exact", "--ignore-workspace-root-check",
             "typescript", "@types/react", "@types/node"]
          : ["add", "--save-dev", "--save-exact",
             "typescript", "@types/react", "@types/node"];
        await this.provider.execute(sandboxId, {
          command: buildShellCommand([pm, ...addArgs]),
          cwd: SANDBOX_WORKSPACE_ROOT,
          timeoutMs: 120_000,
          env,
        }).catch(() => {
          // Non-fatal — the dev server attempts its own auto-install.
        });
      }
      // The install changed the sandbox tree (package.json/lockfile
      // may have moved): sync back so the volume stays the record.
      await this.syncBackLocked(ws, sandboxId);
    });
  }

  // ─── Preview support ────────────────────────────────────────────

  /**
   * Ensure a live sandbox for a preview start: gate-checked, locked,
   * mirrored, pending-forward flushed (loudly). Returns null when
   * the gate is closed so the caller keeps the host path.
   */
  async ensureSandboxForPreview(
    descriptorIn: WorkspaceDescriptor,
  ): Promise<{ sandboxId: string } | null> {
    if (!this.isAvailableFor(descriptorIn.userId)) return null;
    const descriptor = this.fresh(descriptorIn);
    return this.withLock(descriptor.workspaceId, async () => {
      const ws = this.fresh(descriptor);
      const { sandboxId } = await this.ensureSandboxLocked(ws, { bootstrap: "mirror" });
      await this.flushPendingForwardLocked(ws, sandboxId);
      return { sandboxId };
    });
  }

  /** Run fn under the workspace lock (preview start/stop share it). */
  async withWorkspaceLock<T>(
    descriptorIn: WorkspaceDescriptor,
    fn: (descriptor: WorkspaceDescriptor) => Promise<T>,
  ): Promise<T> {
    const descriptor = this.fresh(descriptorIn);
    return this.withLock(descriptor.workspaceId, () => fn(this.fresh(descriptor)));
  }

  /** Stamp the binding's preview port (persisted; not the URL). */
  notePreviewPort(descriptorIn: WorkspaceDescriptor, port: number | null): void {
    const descriptor = this.fresh(descriptorIn);
    if (descriptor.sandbox) {
      descriptor.sandbox.previewPort = port;
      this.persistBinding(descriptor);
    }
  }

  // ─── Reconcile + destroy ────────────────────────────────────────

  /**
   * Boot reconcile (§2.4): for each persisted binding, ask the
   * provider. Missing → mark lost and clear (the volume already
   * holds everything up to the last sync). Present but paused →
   * leave paused; sandboxes are never woken at boot. Identity
   * mismatch → destroy and clear. Orphan sweep (sandboxes no binding
   * claims) needs a list-by-metadata call the contract lacks; the
   * provider timeout bounds that cost meanwhile.
   */
  async reconcileBindings(): Promise<void> {
    for (const descriptor of listAllWorkspaceDescriptors()) {
      const binding = descriptor.sandbox;
      if (!binding) continue;
      try {
        if (!binding.sandboxId) {
          delete descriptor.sandbox;
          this.persistBinding(descriptor);
          continue;
        }
        const instance = await this.provider.get(binding.sandboxId).catch(() => null);
        if (!instance) {
          this.log(
            `[sandbox-lifecycle] reconcile: sandbox=${binding.sandboxId} for workspace=${descriptor.workspaceId} ` +
              "not found at provider; binding marked lost and cleared",
          );
          delete descriptor.sandbox;
          this.persistBinding(descriptor);
          continue;
        }
        if (!this.identityMatches(instance, descriptor)) {
          this.log(
            `[sandbox-lifecycle] reconcile: identity mismatch on sandbox=${binding.sandboxId}; destroying it`,
          );
          await this.provider.destroy(binding.sandboxId).catch(() => {});
          delete descriptor.sandbox;
          this.persistBinding(descriptor);
          continue;
        }
        binding.state = instance.state === "stopped" ? "paused" : "running";
        this.persistBinding(descriptor);
      } catch (err) {
        this.log(
          `[sandbox-lifecycle] reconcile failed for workspace=${descriptor.workspaceId}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }

  /** Destroy the workspace's sandbox and clear its binding. */
  async destroySandbox(descriptorIn: WorkspaceDescriptor): Promise<void> {
    const descriptor = this.fresh(descriptorIn);
    await this.withLock(descriptor.workspaceId, async () => {
      const ws = this.fresh(descriptor);
      const binding = ws.sandbox;
      if (binding?.sandboxId) {
        await this.provider.destroy(binding.sandboxId).catch(() => {});
      }
      delete ws.sandbox;
      this.persistBinding(ws);
      this.manifests.delete(ws.workspaceId);
    });
  }

  /** Test/diagnostic view of the tracked sync baseline size. */
  manifestSize(workspaceId: string): number {
    return this.manifests.get(workspaceId)?.size ?? 0;
  }

  /** The sandbox tree listing for a bound workspace (preview checks). */
  async listSandbox(
    descriptorIn: WorkspaceDescriptor,
  ): Promise<SyncManifest | null> {
    const descriptor = this.fresh(descriptorIn);
    const binding = descriptor.sandbox;
    if (!binding?.sandboxId) return null;
    return listSandboxTree(this.provider, binding.sandboxId, SANDBOX_WORKSPACE_ROOT);
  }
}
