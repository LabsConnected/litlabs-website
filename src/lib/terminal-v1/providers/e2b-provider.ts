/**
 * E2B cloud sandbox provider for Terminal V1.
 *
 * DESIGN PRINCIPLE — PUBLISH ≠ EXECUTE (LiTT Sandbox Acceptance Gate):
 * This sandbox exists for BUILD-TIME execution only: generate → execute →
 * preview → edit. Publishing a generated website stays a STATIC-FILE
 * operation and must NEVER be interpreted as permission for that website to
 * execute server-side code in production. This adapter MUST NOT accept,
 * forward, or expose any production publishing credentials (hosting API
 * tokens, deploy keys, CI secrets). `assertNoPublishingCredentials()` below
 * enforces that at the env boundary, and the verification probe asserts no
 * such credential names appear inside the sandbox.
 *
 * FAIL-CLOSED POSTURE:
 * - The API key is read ONLY from `E2B_API_KEY`. Every public method calls
 *   `requireE2BApiKey()` first; without it the provider throws instead of
 *   running. The key is never logged, printed, or forwarded into the
 *   sandbox environment.
 * - Staging timeouts: idle timeout defaults to 5 minutes
 *   (`E2B_IDLE_TIMEOUT_MS`, clamped to a 30-minute maximum — never above).
 *   Idle timeout is a BACKSTOP, not the cleanup strategy.
 * - Immediate destroy: any infrastructure failure (create/execute/terminal/
 *   file-op throwing, command timeout) destroys the sandbox right away —
 *   no dangling sandboxes. Callers MUST call `destroy()` when their
 *   workflow completes; the idle timer and the max-lifetime reaper are
 *   backstops for abandoned or crashed sessions, never the primary path.
 * - Abandoned-session reaper: every session gets a hard max lifetime
 *   (default 60 minutes, `E2B_MAX_SESSION_MS`) after which it is
 *   force-destroyed even if the caller vanished. Destroying one session
 *   never touches another (each E2B sandbox is a separate VM).
 * - Cost hooks: `getSessionStats()` exposes per-session wall-clock time
 *   (E2B bills per-second on sandbox lifetime), execution count and total
 *   exec time so real per-session cost can be measured later. No billing
 *   API calls are made.
 *
 * E2B runs in E2B's cloud, NOT on our hosts — unlike the Docker provider
 * this adapter never spawns host processes, so `assertHostExecutionPermitted`
 * does not apply. Production selection is still gated: `providers/index.ts`
 * returns the DisabledProvider in production-like environments regardless
 * of TERMINAL_PROVIDER. Activating E2B for production execution requires
 * Larry's explicit approval (acceptance gate).
 */

import { randomUUID } from "crypto";
import { Sandbox } from "e2b";
import type { SandboxProvider } from "../sandbox-provider";
import { buildSandboxEnv, assertNoPlatformSecrets } from "../env-allowlist";
import { tokenizeCommandLine } from "./docker-provider";
import type {
  CreateSandboxInput,
  SandboxInstance,
  SandboxResourceLimits,
  SandboxState,
  TerminalConnectOptions,
  TerminalTransport,
  ExecuteCommandInput,
  ExecuteCommandResult,
  PreviewEndpoint,
} from "../types";
import { DEFAULT_SANDBOX_LIMITS } from "../types";
// Canonical execution-policy classifier — the same deny/safe/risky tiers the
// ExecutionGateway enforces. Policy-denied ("dangerous") commands never
// reach the sandbox.
import { classifyCommand } from "@litt/agent-core";

// ─── Configuration ───────────────────────────────────────────────

const E2B_API_KEY_ENV = "E2B_API_KEY";

/** Staging idle timeout: 5 minutes default, never above 30 minutes. */
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Hard cap on any single sandbox session lifetime: 60 minutes default. */
const DEFAULT_MAX_SESSION_MS = 60 * 60 * 1000;

/** Default per-command execution timeout (matches docker provider). */
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;

/** E2B-side sandbox lifetime backstop (Hobby cap is 1h). */
const E2B_CREATE_TIMEOUT_CAP_MS = 3_600_000;

export class E2BNotConfiguredError extends Error {
  constructor(caller: string) {
    super(
      `E2B sandbox unavailable [${caller}]: ${E2B_API_KEY_ENV} is not set. ` +
        `Refusing to proceed without credentials (fail-closed).`,
    );
    this.name = "E2BNotConfiguredError";
  }
}

/** Fail closed: the ONLY source of the E2B API key. Never log the value. */
export function requireE2BApiKey(caller: string): string {
  const key = process.env[E2B_API_KEY_ENV];
  if (!key || key.trim() === "") {
    throw new E2BNotConfiguredError(caller);
  }
  return key;
}

export function resolveIdleTimeoutMs(): number {
  const raw = process.env.E2B_IDLE_TIMEOUT_MS;
  if (!raw) return DEFAULT_IDLE_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_IDLE_TIMEOUT_MS;
  // Never above the 30-minute ceiling, no matter what is configured.
  return Math.min(Math.floor(n), MAX_IDLE_TIMEOUT_MS);
}

export function resolveMaxSessionMs(): number {
  const raw = process.env.E2B_MAX_SESSION_MS;
  if (!raw) return DEFAULT_MAX_SESSION_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_SESSION_MS;
  return Math.floor(n);
}

// ─── Publish/execute separation ──────────────────────────────────

/**
 * Production PUBLISHING credentials that must never enter a build sandbox.
 * (Platform runtime secrets are covered separately by
 * `assertNoPlatformSecrets`.) Publishing stays a static-file operation;
 * nothing here may carry the means to deploy or mutate production.
 */
const PUBLISHING_CREDENTIAL_DENYLIST = [
  "E2B_API_KEY", // never reflect the sandbox's own key back into it
  "VERCEL_TOKEN",
  "NETLIFY_AUTH_TOKEN",
  "NETLIFY_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "RAILWAY_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
  "FLY_API_TOKEN",
  "RENDER_API_KEY",
  "HEROKU_API_KEY",
  "DOPPLER_TOKEN",
  "DIGITALOCEAN_ACCESS_TOKEN",
] as const;

export function assertNoPublishingCredentials(
  env: Record<string, string>,
): void {
  const hit = Object.keys(env).find((k) =>
    (PUBLISHING_CREDENTIAL_DENYLIST as readonly string[]).includes(
      k.toUpperCase(),
    ),
  );
  if (hit) {
    throw new Error(
      `Refused: "${hit}" is a production publishing credential and must ` +
        `never enter a build sandbox (publish \u2260 execute).`,
    );
  }
}

// ─── Injectable E2B client (mockable for unit tests) ─────────────

export interface E2BRunOpts {
  timeoutMs?: number;
  cwd?: string;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface E2BCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface E2BPtyHandle {
  pid: number;
  sendStdin(data: string | Uint8Array): Promise<void>;
  kill(): Promise<boolean>;
  disconnect(): Promise<void>;
}

export interface E2BSandboxHandle {
  readonly sandboxId: string;
  commands: {
    run(cmd: string, opts?: E2BRunOpts): Promise<E2BCommandResult>;
  };
  files: {
    read(path: string): Promise<string>;
    write(path: string, data: string | Uint8Array): Promise<unknown>;
  };
  pty: {
    create(opts: {
      cols: number;
      rows: number;
      onData: (data: Uint8Array) => void | Promise<void>;
      timeoutMs?: number;
    }): Promise<E2BPtyHandle>;
    resize(pid: number, size: { cols: number; rows: number }): Promise<unknown>;
  };
  getHost(port: number): string;
  kill(): Promise<boolean>;
}

export interface E2BClientFactory {
  create(opts: {
    apiKey: string;
    timeoutMs: number;
    metadata: Record<string, string>;
    envs: Record<string, string>;
  }): Promise<E2BSandboxHandle>;
}

/** Adapt the real E2B SDK Sandbox to the minimal handle interface. */
function adaptSandbox(sbx: Sandbox): E2BSandboxHandle {
  return {
    sandboxId: sbx.sandboxId,
    commands: {
      run: (cmd, opts) =>
        sbx.commands
          .run(cmd, {
            timeoutMs: opts?.timeoutMs,
            cwd: opts?.cwd,
            onStdout: opts?.onStdout,
            onStderr: opts?.onStderr,
          })
          .then((r) => ({
            exitCode: r.exitCode,
            stdout: r.stdout,
            stderr: r.stderr,
            error: r.error,
          })),
    },
    files: {
      read: (path) => sbx.files.read(path) as Promise<string>,
      write: (path, data) => sbx.files.write(path, data as string),
    },
    pty: {
      create: async (opts) => {
        const h = await sbx.pty.create({
          cols: opts.cols,
          rows: opts.rows,
          onData: opts.onData,
          timeoutMs: opts.timeoutMs,
        });
        return {
          pid: h.pid,
          sendStdin: (data) => h.sendStdin(data),
          kill: () => h.kill(),
          disconnect: () => h.disconnect(),
        };
      },
      resize: (pid, size) => sbx.pty.resize(pid, size),
    },
    getHost: (port) => sbx.getHost(port),
    kill: () => sbx.kill(),
  };
}

const defaultClientFactory: E2BClientFactory = {
  create: async (opts) =>
    adaptSandbox(
      await Sandbox.create({
        apiKey: opts.apiKey,
        timeoutMs: opts.timeoutMs,
        metadata: opts.metadata,
        envs: opts.envs,
      }),
    ),
};

// ─── Session bookkeeping + cost hooks ────────────────────────────

export interface E2BSessionStats {
  sandboxId: string;
  /** Wall-clock ms from create to now. E2B bills per-second on sandbox
   *  lifetime, so this is the cost basis for the session. */
  wallClockMs: number;
  executions: number;
  totalExecMs: number;
  lastActivityMs: number;
  state: SandboxState;
}

interface E2BSessionRecord {
  instance: SandboxInstance;
  sandbox: E2BSandboxHandle;
  createdAtMs: number;
  lastActivityMs: number;
  executions: number;
  totalExecMs: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  reaperTimer: ReturnType<typeof setTimeout> | null;
}

function unrefTimer(t: ReturnType<typeof setTimeout>): void {
  (t as unknown as { unref?: () => void }).unref?.();
}

function assertSafeSandboxPath(path: string): void {
  if (!path.startsWith("/")) {
    throw new Error(
      `Sandbox file path must be absolute, got: ${path.slice(0, 64)}`,
    );
  }
  if (path.split("/").includes("..")) {
    throw new Error("Parent-directory traversal is not allowed in sandbox paths");
  }
}

// ─── Provider ────────────────────────────────────────────────────

export class E2BSandboxProvider implements SandboxProvider {
  readonly name = "e2b";
  private readonly factory: E2BClientFactory;
  private readonly sessions = new Map<string, E2BSessionRecord>();

  constructor(factory?: E2BClientFactory) {
    this.factory = factory ?? defaultClientFactory;
  }

  // ── Session helpers ───────────────────────────────────────────

  private requireSession(sandboxId: string, caller: string): E2BSessionRecord {
    const rec = this.sessions.get(sandboxId);
    if (!rec) throw new Error(`E2B sandbox not found [${caller}]: ${sandboxId}`);
    return rec;
  }

  private requireRunning(sandboxId: string, caller: string): E2BSessionRecord {
    const rec = this.requireSession(sandboxId, caller);
    if (rec.instance.state !== "running") {
      throw new Error(
        `E2B sandbox is not running [${caller}]: ${sandboxId} (state=${rec.instance.state})`,
      );
    }
    return rec;
  }

  private touch(rec: E2BSessionRecord): void {
    rec.lastActivityMs = Date.now();
    rec.instance.lastActiveAt = new Date(rec.lastActivityMs).toISOString();
    this.resetIdleTimer(rec);
  }

  private resetIdleTimer(rec: E2BSessionRecord): void {
    if (rec.idleTimer) clearTimeout(rec.idleTimer);
    const idleMs = resolveIdleTimeoutMs();
    if (idleMs > 0 && rec.instance.state === "running") {
      rec.idleTimer = setTimeout(() => {
        void this.forceDestroy(
          rec.instance.sandboxId,
          "idle-timeout-exceeded",
        );
      }, idleMs);
      unrefTimer(rec.idleTimer);
    }
  }

  /**
   * Best-effort destroy used on error paths. Never throws — a faulted
   * session must not leave a dangling sandbox, and must not mask the
   * original error either.
   */
  private async destroyQuiet(sandboxId: string): Promise<void> {
    try {
      await this.destroy(sandboxId);
    } catch {
      // destroy() is idempotent; nothing more to do.
    }
  }

  private async forceDestroy(sandboxId: string, reason: string): Promise<void> {
    const rec = this.sessions.get(sandboxId);
    if (!rec) return;
    // eslint-disable-next-line no-console
    console.warn(
      `[e2b-provider] force-destroying sandbox ${sandboxId}: ${reason}`,
    );
    await this.destroyQuiet(sandboxId);
  }

  /** Cost/lifetime telemetry for a live session. */
  getSessionStats(sandboxId: string): E2BSessionStats | null {
    const rec = this.sessions.get(sandboxId);
    if (!rec) return null;
    return {
      sandboxId,
      wallClockMs: Date.now() - rec.createdAtMs,
      executions: rec.executions,
      totalExecMs: rec.totalExecMs,
      lastActivityMs: rec.lastActivityMs,
      state: rec.instance.state,
    };
  }

  // ── SandboxProvider interface ─────────────────────────────────

  async create(input: CreateSandboxInput): Promise<SandboxInstance> {
    const apiKey = requireE2BApiKey("e2b-provider:create");

    const sandboxId = `sbx-${input.projectId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
    const limits: SandboxResourceLimits = {
      ...DEFAULT_SANDBOX_LIMITS,
      ...input.limits,
    };

    // Build safe environment: allowlist only, no platform secrets, and —
    // publish ≠ execute — no production publishing credentials, including
    // the E2B key itself (never reflected into the sandbox).
    const safeEnv = buildSandboxEnv({
      userId: input.userId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      sandboxId,
    });
    assertNoPlatformSecrets(safeEnv);
    if (input.env) {
      assertNoPlatformSecrets(input.env);
      assertNoPublishingCredentials(input.env);
      Object.assign(safeEnv, input.env);
    }
    assertNoPublishingCredentials(safeEnv);

    const maxSessionMs = resolveMaxSessionMs();

    let handle: E2BSandboxHandle;
    try {
      handle = await this.factory.create({
        apiKey,
        // E2B-side backstop (Hobby cap is 1h); the reaper below is the
        // primary enforcement and fires no later than this.
        timeoutMs: Math.min(maxSessionMs, E2B_CREATE_TIMEOUT_CAP_MS),
        metadata: {
          littree_user_id: input.userId,
          littree_project_id: input.projectId,
          littree_workspace_id: input.workspaceId,
          littree_sandbox_id: sandboxId,
        },
        envs: safeEnv,
      });
    } catch (err) {
      throw new Error(
        `E2B sandbox creation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const now = Date.now();
    const instance: SandboxInstance = {
      sandboxId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: input.projectId,
      state: "running",
      limits,
      createdAt: new Date(now).toISOString(),
      startedAt: new Date(now).toISOString(),
      lastActiveAt: new Date(now).toISOString(),
      stoppedAt: null,
      failureReason: null,
      provider: this.name,
      endpoint: null,
    };

    const rec: E2BSessionRecord = {
      instance,
      sandbox: handle,
      createdAtMs: now,
      lastActivityMs: now,
      executions: 0,
      totalExecMs: 0,
      idleTimer: null,
      reaperTimer: null,
    };
    this.sessions.set(sandboxId, rec);

    // Abandoned-session reaper: hard cap on session lifetime. Fires even if
    // the caller vanished or crashed — destroying THIS session only.
    rec.reaperTimer = setTimeout(() => {
      void this.forceDestroy(sandboxId, "max-session-lifetime-exceeded");
    }, maxSessionMs);
    unrefTimer(rec.reaperTimer);

    this.resetIdleTimer(rec);

    return { ...instance };
  }

  async get(sandboxId: string): Promise<SandboxInstance | null> {
    const rec = this.sessions.get(sandboxId);
    if (!rec) return null;
    return { ...rec.instance };
  }

  async start(sandboxId: string): Promise<void> {
    requireE2BApiKey("e2b-provider:start");
    const rec = this.requireSession(sandboxId, "start");
    if (rec.instance.state === "running") return;
    // E2B kill() is terminal and billed-until-killed, so our stop() kills.
    // A stopped session cannot be resumed; callers must create a new one.
    throw new Error(
      `E2B sandbox ${sandboxId} is ${rec.instance.state} and cannot be restarted; create a new sandbox.`,
    );
  }

  async stop(sandboxId: string): Promise<void> {
    requireE2BApiKey("e2b-provider:stop");
    const rec = this.requireSession(sandboxId, "stop");
    if (rec.idleTimer) {
      clearTimeout(rec.idleTimer);
      rec.idleTimer = null;
    }
    // E2B bills until kill, so "stop" kills immediately (aggressive
    // cleanup posture). The record is retained so get() still reports
    // "stopped" until destroy() or the reaper removes it.
    try {
      await rec.sandbox.kill();
    } catch {
      // Already gone — state change is what matters.
    }
    rec.instance.state = "stopped";
    rec.instance.stoppedAt = new Date().toISOString();
    rec.lastActivityMs = Date.now();
  }

  /**
   * Idempotent: destroying an unknown or already-destroyed sandbox is a
   * no-op (crash-safety for reapers and error paths).
   */
  async destroy(sandboxId: string): Promise<void> {
    const rec = this.sessions.get(sandboxId);
    if (!rec) return;
    if (rec.idleTimer) clearTimeout(rec.idleTimer);
    if (rec.reaperTimer) clearTimeout(rec.reaperTimer);
    rec.idleTimer = null;
    rec.reaperTimer = null;
    try {
      await rec.sandbox.kill();
    } catch {
      // Best effort — the session record is dropped regardless so a
      // faulted remote cannot linger in our bookkeeping.
    }
    this.sessions.delete(sandboxId);
  }

  async connectTerminal(
    sandboxId: string,
    options: TerminalConnectOptions,
  ): Promise<TerminalTransport> {
    requireE2BApiKey("e2b-provider:connectTerminal");
    const rec = this.requireRunning(sandboxId, "connectTerminal");
    this.touch(rec);

    const sessionId = `sess-${randomUUID().slice(0, 8)}`;
    const outputCallbacks: Array<(data: string) => void> = [];
    const exitCallbacks: Array<(info: { exitCode: number; signal?: number }) => void> = [];
    let exited = false;
    const fireExit = (info: { exitCode: number; signal?: number }) => {
      if (exited) return;
      exited = true;
      for (const cb of exitCallbacks) cb(info);
    };

    let handle: E2BPtyHandle;
    try {
      handle = await rec.sandbox.pty.create({
        cols: options.cols,
        rows: options.rows,
        timeoutMs: DEFAULT_EXEC_TIMEOUT_MS,
        onData: (data: Uint8Array) => {
          const text = new TextDecoder().decode(data);
          rec.lastActivityMs = Date.now();
          for (const cb of outputCallbacks) cb(text);
        },
      });
    } catch (err) {
      // PTY failed to attach — the session may be wedged; destroy it
      // rather than leaving a half-connected sandbox dangling.
      await this.destroyQuiet(sandboxId);
      throw err;
    }
    this.touch(rec);

    const transport: TerminalTransport = {
      sessionId,
      write: (data: string) => {
        rec.lastActivityMs = Date.now();
        void handle.sendStdin(data).catch(() => {
          fireExit({ exitCode: -1 });
        });
      },
      resize: (cols: number, rows: number) => {
        void rec.sandbox.pty.resize(handle.pid, { cols, rows }).catch(() => {});
      },
      onOutput: (callback: (data: string) => void) => {
        outputCallbacks.push(callback);
      },
      onExit: (callback: (info: { exitCode: number; signal?: number }) => void) => {
        // NOTE: the E2B SDK does not push remote PTY exit events; onExit
        // fires on local kill()/disconnect(). Documented limitation.
        exitCallbacks.push(callback);
      },
      kill: () => {
        void handle
          .kill()
          .catch(() => {})
          .finally(() => {
            void handle.disconnect().catch(() => {});
            fireExit({ exitCode: 0 });
          });
      },
    };

    return transport;
  }

  async execute(
    sandboxId: string,
    input: ExecuteCommandInput,
  ): Promise<ExecuteCommandResult> {
    requireE2BApiKey("e2b-provider:execute");
    const rec = this.requireRunning(sandboxId, "execute");

    // Execution-policy enforcement FIRST: tokenize for classification so
    // policy-denied ("dangerous") commands never reach the sandbox. The
    // command string itself is passed through to E2B's shell (contained
    // inside the sandbox) so compound builder commands like
    // `npm install && npm run build` keep working.
    const argv = tokenizeCommandLine(input.command);
    if (argv.length === 0) {
      throw new Error("Empty command");
    }
    const policy = classifyCommand(argv[0], argv.slice(1));
    if (policy.level === "dangerous") {
      throw new Error(`Command denied by execution policy: ${policy.reason}`);
    }

    const timeoutMs = input.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const startedAt = Date.now();
    this.touch(rec);

    try {
      const result = await rec.sandbox.commands.run(input.command, {
        timeoutMs,
        cwd: input.cwd,
      });
      const durationMs = Date.now() - startedAt;
      rec.executions += 1;
      rec.totalExecMs += durationMs;
      this.touch(rec);
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs,
      };
    } catch (err) {
      // Any infrastructure failure (network, timeout, SDK throw) destroys
      // the session immediately — a faulted sandbox must never dangle.
      // (Non-zero exit codes are normal results, not exceptions.)
      await this.destroyQuiet(sandboxId);
      throw err;
    }
  }

  /** Read a file from inside the sandbox. */
  async readFile(sandboxId: string, path: string): Promise<string> {
    requireE2BApiKey("e2b-provider:readFile");
    const rec = this.requireRunning(sandboxId, "readFile");
    assertSafeSandboxPath(path);
    this.touch(rec);
    return rec.sandbox.files.read(path);
  }

  /** Write a file inside the sandbox. */
  async writeFile(
    sandboxId: string,
    path: string,
    data: string | Uint8Array,
  ): Promise<void> {
    requireE2BApiKey("e2b-provider:writeFile");
    const rec = this.requireRunning(sandboxId, "writeFile");
    assertSafeSandboxPath(path);
    this.touch(rec);
    await rec.sandbox.files.write(path, data);
  }

  async exposePort(
    sandboxId: string,
    port: number,
  ): Promise<PreviewEndpoint> {
    requireE2BApiKey("e2b-provider:exposePort");
    const rec = this.requireRunning(sandboxId, "exposePort");
    this.touch(rec);

    // E2B exposes sandbox ports on a public-by-obscurity host. The preview
    // URL is token-gated at OUR layer (previewToken); the sandbox host
    // itself must never be treated as authenticated.
    const host = rec.sandbox.getHost(port);
    const previewToken = randomUUID();
    return {
      port,
      url: `https://${host}`,
      state: "private",
      previewToken,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  async health(): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    // No network call: health here asserts credential presence (fail-closed)
    // without spending. Live isolation is verified by the canary probe
    // (scripts/verify-e2b-sandbox.mjs), not by this check.
    if (!process.env[E2B_API_KEY_ENV]) {
      return {
        healthy: false,
        details: {
          provider: this.name,
          reason: `${E2B_API_KEY_ENV} is not set (fail-closed)`,
        },
      };
    }
    return {
      healthy: true,
      details: {
        provider: this.name,
        credential: "present (value never logged)",
        idleTimeoutMs: resolveIdleTimeoutMs(),
        maxSessionMs: resolveMaxSessionMs(),
      },
    };
  }
}
