/**
 * E2B sandbox provider — Phase 1 of SANDBOX-PLAN.md §4.
 *
 * Implements the terminal-side {@link SandboxProvider} contract
 * (provider.ts) on the official `e2b` TypeScript SDK (Sandbox class).
 * E2B runs each sandbox in a Firecracker microVM, which is the
 * VM-level isolation the plan's Option B was chosen for.
 *
 * Security posture (plan §4 invariants):
 *   - The API key is read from the environment ONLY by the factory in
 *     config.ts and handed to this constructor. It is never logged,
 *     never placed in a sandbox's environment (assertNoPlatformSecrets
 *     refuses it), and never included in health/error output.
 *   - Every sandbox's environment is composed exclusively through
 *     env.ts (allowlist identity vars + project-scoped caller vars,
 *     platform secrets refused before any SDK call happens).
 *   - One provider instance serves sandboxes for many (user, project)
 *     pairs, but each sandbox is created for exactly one pair and is
 *     tagged with that identity in E2B metadata; sandboxes are never
 *     pooled or shared (the exec router keys bindings per pair).
 *
 * The SDK is reached through the narrow {@link E2bClient} adapter so
 * unit tests inject a fake client — the provider logic (lifecycle,
 * env enforcement, result mapping) is what CI verifies; the live
 * canary against the real account is the staging proof step.
 *
 * Phase 1 scope: workspace.exec is the only routed surface.
 * connectTerminal therefore refuses explicitly (PTY attach is a later
 * phase) instead of faking a transport.
 */

import { randomBytes } from "crypto";
import {
  DEFAULT_SANDBOX_LIMITS,
  type CreateSandboxInput,
  type ExecuteCommandInput,
  type ExecuteCommandResult,
  type PreviewEndpoint,
  type SandboxInstance,
  type SandboxProvider,
  type SandboxResourceLimits,
  type TerminalConnectOptions,
  type TerminalTransport,
} from "./provider";
import { assertNoPlatformSecrets, composeSandboxEnv } from "./env";

/** Default E2B template: built and published from ../sandbox.Dockerfile. */
export const DEFAULT_E2B_TEMPLATE_ID = "litt-sandbox-v1";

// ─── SDK adapter ────────────────────────────────────────────────────

export interface E2bCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface E2bSandboxHandle {
  readonly sandboxId: string;
  runCommand(
    command: string,
    opts: {
      cwd?: string;
      timeoutMs?: number;
      stdin?: string;
      envs?: Record<string, string>;
    },
  ): Promise<E2bCommandResult>;
  /** Host (no scheme) for an exposed port, per the SDK's getHost(). */
  getHost(port: number): string;
  setTimeout(timeoutMs: number): Promise<void>;
  /** Pause preserves disk + memory state; used for stop(). */
  pause(): Promise<boolean>;
  kill(): Promise<boolean>;
  isRunning(): Promise<boolean>;
}

export interface E2bCreateOptions {
  template: string;
  timeoutMs: number;
  envs: Record<string, string>;
  metadata: Record<string, string>;
  cpuCount: number;
  memoryMB: number;
}

/**
 * The slice of the E2B SDK this provider uses. The default
 * implementation (createDefaultE2bClient) wraps the real `e2b`
 * package; tests inject a fake.
 */
export interface E2bClient {
  create(opts: E2bCreateOptions): Promise<E2bSandboxHandle>;
  connect(sandboxId: string): Promise<E2bSandboxHandle>;
  /** Cheap authenticated call used by health(): list one sandbox. */
  probe(): Promise<void>;
}

interface E2bSdkSandboxLike {
  sandboxId: string;
  commands: {
    run(
      cmd: string,
      opts?: Record<string, unknown>,
    ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  getHost(port: number): string;
  setTimeout(timeoutMs: number): Promise<void>;
  pause(): Promise<boolean>;
  kill(): Promise<boolean>;
  isRunning(): Promise<boolean>;
}

function wrapSdkSandbox(sbx: E2bSdkSandboxLike): E2bSandboxHandle {
  return {
    sandboxId: sbx.sandboxId,
    async runCommand(command, opts) {
      try {
        const res = await sbx.commands.run(command, {
          cwd: opts.cwd,
          timeoutMs: opts.timeoutMs,
          stdin: opts.stdin,
          envs: opts.envs,
        });
        return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr };
      } catch (err) {
        // The SDK throws CommandExitError for non-zero exits; that
        // error itself carries exitCode/stdout/stderr. Anything else
        // (timeout, transport) is a real failure and propagates.
        const e = err as { exitCode?: unknown; stdout?: unknown; stderr?: unknown };
        if (typeof e?.exitCode === "number") {
          return {
            exitCode: e.exitCode,
            stdout: typeof e.stdout === "string" ? e.stdout : "",
            stderr: typeof e.stderr === "string" ? e.stderr : "",
          };
        }
        throw err;
      }
    },
    getHost: (port) => sbx.getHost(port),
    setTimeout: (ms) => sbx.setTimeout(ms),
    pause: () => sbx.pause(),
    kill: () => sbx.kill(),
    isRunning: () => sbx.isRunning(),
  };
}

/**
 * Default client backed by the real `e2b` package. The import is
 * dynamic so processes that never configure the E2B provider (every
 * non-staging deployment today) never load the SDK at all.
 */
export function createDefaultE2bClient(apiKey: string): E2bClient {
  const load = async () => import("e2b");
  return {
    async create(opts) {
      const { Sandbox } = await load();
      // NOTE: the current E2B SDK defines vCPU/memory at TEMPLATE
      // build time, not per-create — opts.cpuCount / opts.memoryMB
      // are therefore not forwarded to the SDK. The provider records
      // the requested limits on the instance (the canary's
      // resource-limits check echoes them from get() and separately
      // proves memory enforcement empirically), and the litt-sandbox
      // template must be built with the plan's default sizing
      // (see sandbox/README.md, Phase 1 section).
      const sbx = await Sandbox.create(opts.template, {
        apiKey,
        timeoutMs: opts.timeoutMs,
        envs: opts.envs,
        metadata: opts.metadata,
      });
      return wrapSdkSandbox(sbx as unknown as E2bSdkSandboxLike);
    },
    async connect(sandboxId) {
      const { Sandbox } = await load();
      const sbx = await Sandbox.connect(sandboxId, { apiKey });
      return wrapSdkSandbox(sbx as unknown as E2bSdkSandboxLike);
    },
    async probe() {
      const { Sandbox } = await load();
      const paginator = Sandbox.list({ apiKey, limit: 1 });
      await paginator.nextItems();
    },
  };
}

// ─── Provider ───────────────────────────────────────────────────────

export interface E2bSandboxProviderOptions {
  /** E2B API key. Supplied by config.ts from E2B_API_KEY; never logged. */
  apiKey: string;
  /** Template ID/name. Defaults to DEFAULT_E2B_TEMPLATE_ID. */
  templateId?: string;
  /** SDK adapter. Defaults to the real SDK client. Tests inject a fake. */
  client?: E2bClient;
  /** Clock injection (tests). */
  now?: () => number;
}

interface RegistryEntry {
  instance: SandboxInstance;
  handle: E2bSandboxHandle;
  /** Full composed environment, re-supplied per command (see create). */
  env: Record<string, string>;
}

export class E2bTerminalUnsupportedError extends Error {
  readonly code = "SANDBOX_TERMINAL_UNSUPPORTED" as const;
  constructor() {
    super(
      "E2B provider Phase 1 routes workspace.exec only; interactive terminal attach is not supported yet.",
    );
    this.name = "E2bTerminalUnsupportedError";
  }
}

export class SandboxNotFoundError extends Error {
  readonly code = "SANDBOX_NOT_FOUND" as const;
  constructor(sandboxId: string) {
    super(`Sandbox not found: ${sandboxId}`);
    this.name = "SandboxNotFoundError";
  }
}

export class E2bSandboxProvider implements SandboxProvider {
  readonly name = "e2b";

  private readonly client: E2bClient;
  private readonly templateId: string;
  private readonly now: () => number;
  private readonly registry = new Map<string, RegistryEntry>();

  constructor(options: E2bSandboxProviderOptions) {
    if (!options.apiKey) {
      throw new Error("E2bSandboxProvider requires an API key (E2B_API_KEY)");
    }
    this.client = options.client ?? createDefaultE2bClient(options.apiKey);
    this.templateId = options.templateId ?? DEFAULT_E2B_TEMPLATE_ID;
    this.now = options.now ?? Date.now;
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }

  async create(input: CreateSandboxInput): Promise<SandboxInstance> {
    const limits: SandboxResourceLimits = {
      ...DEFAULT_SANDBOX_LIMITS,
      ...(input.limits ?? {}),
    };

    // Refuse platform secrets BEFORE any SDK call: a poisoned create
    // must never reach the provider. composeSandboxEnv also runs
    // assertNoPlatformSecrets over the caller's env.
    assertNoPlatformSecrets(input.env ?? {});

    // The sandbox ID exists only after creation, so the create-time
    // env carries the identity vars with a placeholder sandbox id;
    // the final env (with the real LITTREE_SANDBOX_ID) is composed
    // immediately after and re-supplied on every execute() call,
    // which is the surface Phase 1 routes. Create-time env is never
    // trusted to carry the sandbox id.
    const createEnv = composeSandboxEnv({
      userId: input.userId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      sandboxId: "pending",
      projectEnv: input.env,
    });

    const handle = await this.client.create({
      template: this.templateId,
      timeoutMs: limits.idleTimeoutMinutes * 60_000,
      envs: createEnv,
      metadata: {
        littree_user_id: input.userId,
        littree_project_id: input.projectId,
        littree_workspace_id: input.workspaceId,
      },
      cpuCount: limits.cpuVcpus,
      memoryMB: limits.memoryMB,
    });

    const env = composeSandboxEnv({
      userId: input.userId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      sandboxId: handle.sandboxId,
      projectEnv: input.env,
    });

    const nowIso = this.isoNow();
    const instance: SandboxInstance = {
      sandboxId: handle.sandboxId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: input.projectId,
      state: "running",
      limits,
      createdAt: nowIso,
      startedAt: nowIso,
      lastActiveAt: nowIso,
      stoppedAt: null,
      failureReason: null,
      provider: this.name,
      endpoint: null,
    };
    this.registry.set(handle.sandboxId, { instance, handle, env });
    return { ...instance };
  }

  async get(sandboxId: string): Promise<SandboxInstance | null> {
    const entry = this.registry.get(sandboxId);
    return entry ? { ...entry.instance } : null;
  }

  private entry(sandboxId: string): RegistryEntry {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    return entry;
  }

  async start(sandboxId: string): Promise<void> {
    const entry = this.entry(sandboxId);
    // Sandbox.connect auto-resumes a paused sandbox.
    entry.handle = await this.client.connect(sandboxId);
    await entry.handle.setTimeout(entry.instance.limits.maxSessionMinutes * 60_000);
    entry.instance.state = "running";
    entry.instance.startedAt = this.isoNow();
    entry.instance.stoppedAt = null;
    entry.instance.lastActiveAt = this.isoNow();
  }

  async stop(sandboxId: string): Promise<void> {
    const entry = this.entry(sandboxId);
    // pause() snapshots the sandbox (disk preserved) — the contract's
    // "stop preserves disk" semantics.
    await entry.handle.pause();
    entry.instance.state = "stopped";
    entry.instance.stoppedAt = this.isoNow();
  }

  async destroy(sandboxId: string): Promise<void> {
    const entry = this.registry.get(sandboxId);
    if (!entry) return; // destroying a gone sandbox is a no-op
    this.registry.delete(sandboxId);
    await entry.handle.kill();
  }

  async connectTerminal(
    _sandboxId: string,
    _options: TerminalConnectOptions,
  ): Promise<TerminalTransport> {
    throw new E2bTerminalUnsupportedError();
  }

  async execute(
    sandboxId: string,
    input: ExecuteCommandInput,
  ): Promise<ExecuteCommandResult> {
    const entry = this.entry(sandboxId);
    if (entry.instance.state === "stopped") {
      await this.start(sandboxId);
    }
    const startedMs = this.now();
    const result = await entry.handle.runCommand(input.command, {
      cwd: input.cwd ?? "/workspace",
      timeoutMs: input.timeoutMs ?? 60_000,
      stdin: input.stdin,
      envs: entry.env,
    });
    entry.instance.lastActiveAt = this.isoNow();
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Math.max(0, this.now() - startedMs),
    };
  }

  async exposePort(sandboxId: string, port: number): Promise<PreviewEndpoint> {
    const entry = this.entry(sandboxId);
    const host = entry.handle.getHost(port);
    return {
      port,
      url: `https://${host}`,
      state: "private",
      // Opaque token correlating this exposure in server-side logs.
      // The authenticated preview proxy (Phase 2) is the only consumer
      // of the raw URL; it is never rendered to a browser.
      previewToken: randomBytes(16).toString("hex"),
      expiresAt: new Date(
        this.now() + entry.instance.limits.idleTimeoutMinutes * 60_000,
      ).toISOString(),
    };
  }

  async health(): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    try {
      await this.client.probe();
      return {
        healthy: true,
        details: { provider: this.name, template: this.templateId },
      };
    } catch (err) {
      return {
        healthy: false,
        details: {
          provider: this.name,
          template: this.templateId,
          // Error name/message only — the API key is never included.
          reason: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        },
      };
    }
  }
}
