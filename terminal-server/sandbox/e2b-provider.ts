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
 * Terminal bridge (TERMINAL-BRIDGE-SPEC-2026-11-17): connectTerminal
 * is implemented on the SDK's PTY API — the interactive shell the
 * Studio Terminal panel attaches to. Every PTY stream the SDK opens
 * (create, connect, and the input stream) carries an explicit
 * timeout pinned to the sandbox's session lifetime: the SDK defaults
 * each of them to 60 seconds, which would kill a shell one minute
 * after it opens. See {@link E2bSandboxProvider.connectTerminal}.
 *
 * Provisioning fix (2026-11-19): two disciplines keep a terminal
 * restart from turning into a full cold re-provision. (1) get()
 * RE-ADOPTS a sandbox this process has never seen: the registry is
 * in-memory, so after a restart every persisted binding looked dead
 * and boot reconcile deleted it, forcing a serialized create+mirror
 * of the whole tree. A registry miss now connects by id and recovers
 * the sandbox's identity from the metadata create() tagged it with,
 * failing closed (null) whenever the identity cannot be proven.
 * (2) Every awaited SDK call carries a per-call REQUEST DEADLINE
 * ({@link withRequestDeadline}): the adapter previously set none,
 * so one stalled call among the mirror's thousands of sequential
 * files calls wedged the workspace lock chain and every queued
 * ensure timed out behind it. A deadline rejection frees the lock;
 * the underlying call is never cancelled and its late settle is
 * consumed by the race.
 */

import { randomBytes } from "crypto";
import {
  DEFAULT_SANDBOX_LIMITS,
  type CreateSandboxInput,
  type ExecuteCommandInput,
  type ExecuteCommandResult,
  type PreviewEndpoint,
  type SandboxFileEntry,
  type SandboxFileTransfer,
  type SandboxInstance,
  type SandboxProvider,
  type SandboxResourceLimits,
  type TerminalConnectOptions,
  type TerminalTransport,
} from "./provider";
import {
  assertNoPlatformSecrets,
  collectPlatformSecretValues,
  composeSandboxEnv,
  guardPerCommandProjectEnv,
} from "./env";
import { MAX_COLS as MAX_PTY_COLS, MAX_ROWS as MAX_PTY_ROWS } from "../pty-session-manager";

/**
 * Output buffered between a PTY's creation and the caller's first
 * onOutput registration (the shell prints its prompt immediately).
 * Bounded so a chatty shell with no listener cannot grow memory;
 * excess is dropped, never queued forever.
 */
export const PTY_PRE_REGISTRATION_BUFFER_BYTES = 256 * 1024;

/** Clamp one PTY dimension to the host manager's bounds [1, max]. */
function clampPtyDimension(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

/** Default E2B template: built and published from ../sandbox.Dockerfile. */
export const DEFAULT_E2B_TEMPLATE_ID = "litt-sandbox-v1";

/**
 * Egress denied for every sandbox: the link-local block. Cloud metadata
 * services live there (169.254.169.254, the ECS address 169.254.170.2),
 * and nothing a workspace workload can legitimately need does — E2B
 * points sandbox DNS at public resolvers and registries/git hosts are
 * public. The canary's network-egress probe verifies this rule is
 * actually enforced; without it E2B's default open egress lets the
 * metadata address answer from inside the sandbox.
 */
export const SANDBOX_EGRESS_DENY_OUT: readonly string[] = ["169.254.0.0/16"];

/**
 * The production E2B account's plan cap on sandbox lifetime: Hobby
 * allows at most 1 hour per sandbox. A timeout request above the cap
 * risks the provider rejecting the call (create or setTimeout)
 * outright — the round-9 latent hazard, where the session limit was
 * raised to 120 minutes against a 60-minute plan cap. Every timeout
 * this provider applies to E2B passes through
 * {@link clampSandboxTimeoutMs} at this boundary, so no caller —
 * create limits, session re-arms, preview keepalive extensions —
 * can exceed the cap; an over-cap request is clamped and logged,
 * never rejected.
 */
export const E2B_MAX_TIMEOUT_MS = 60 * 60_000;

export function clampSandboxTimeoutMs(
  requestedMs: number,
  log: (message: string) => void = (m) => console.info(m),
): number {
  if (requestedMs <= E2B_MAX_TIMEOUT_MS) return requestedMs;
  log(
    `[e2b-provider] Clamping sandbox timeout ${requestedMs}ms to the plan cap ` +
      `${E2B_MAX_TIMEOUT_MS}ms (E2B Hobby lifetime limit)`,
  );
  return E2B_MAX_TIMEOUT_MS;
}

// ─── SDK adapter ────────────────────────────────────────────────────

export interface E2bCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// ─── Per-call request deadlines (provisioning fix) ──────────────────

/** Default deadline for one files / metadata / lifecycle SDK call. */
export const E2B_REQUEST_TIMEOUT_MS = 30_000;
/**
 * Default deadline for the structural SDK calls (client.create /
 * client.connect): heavier than a files call, so they get the same
 * bound the codebase already uses for E2B structural operations
 * (HEALTH_PROBE_TIMEOUT_MS, PREVIEW_RECREATION_DESTROY_TIMEOUT_MS).
 */
export const E2B_CREATE_REQUEST_TIMEOUT_MS = 120_000;
/**
 * Grace added on top of a command's own timeoutMs for its request
 * deadline: the command's budget governs the work; the deadline only
 * has to outlive it, never cut it (the 900 s install path depends on
 * this — a flat bound would kill installs mid-flight).
 */
export const E2B_COMMAND_DEADLINE_GRACE_MS = 30_000;

/**
 * A provider request that did not settle inside its deadline. The
 * caller (a lock holder, an ensure chain) is freed to fail and the
 * workspace lock moves on; the sandbox operation itself may still
 * complete server-side, and later calls reconcile from the truth.
 */
export class E2bRequestTimeoutError extends Error {
  readonly code = "E2B_REQUEST_TIMEOUT" as const;
  readonly label: string;
  readonly timeoutMs: number;
  constructor(label: string, timeoutMs: number) {
    super(`E2B request "${label}" did not settle within ${timeoutMs} ms`);
    this.name = "E2bRequestTimeoutError";
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Race `promise` against a request deadline. Same discipline as the
 * preview path's settleWithin: the promise is never cancelled — a
 * promise cannot be — it keeps running detached, and the race's own
 * handlers consume its eventual settle, so a late rejection is never
 * an unhandled rejection. The timer is unref'd: a pending deadline
 * must not keep the process alive on its own.
 */
async function withRequestDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new E2bRequestTimeoutError(label, timeoutMs)),
          timeoutMs,
        );
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ─── PTY adapter (terminal bridge) ──────────────────────────────────
//
// The SDK's PTY surface, narrowed the same way commands/files are.
// One trap shapes everything below: in the pinned SDK (e2b@2.63.0)
// the `timeoutMs` on pty.create / pty.connect is the connect-rpc
// deadline for the PTY's ENTIRE output event stream, and the input
// stream from pty.streamInput has its own identical deadline — all
// three default to 60,000 ms when omitted. A shell opened without an
// explicit timeout therefore dies at 60 seconds even though the
// sandbox lives on. The provider pins every one of them to the
// sandbox's clamped session lifetime (see connectTerminal), and the
// adapter takes the value as a required option so no call site can
// forget it.

export interface E2bPtyCreateOptions {
  cols: number;
  rows: number;
  onData: (data: Uint8Array) => void | Promise<void>;
  /** Stream deadline — REQUIRED, never the SDK's 60 s default. */
  timeoutMs: number;
  envs: Record<string, string>;
  cwd: string;
}

export interface E2bPtyConnectOptions {
  onData: (data: Uint8Array) => void | Promise<void>;
  /** Stream deadline — REQUIRED, never the SDK's 60 s default. */
  timeoutMs: number;
}

export interface E2bPtyHandle {
  readonly pid: number;
  /**
   * Settles when the PTY process ends: resolves with its exit code
   * (a non-zero exit is a normal shell exit, NOT an error). Rejects
   * only when the event stream died without a result — a transport
   * failure or the sandbox going away mid-session.
   */
  wait(): Promise<{ exitCode: number }>;
  /** Stop receiving events WITHOUT killing the process (reattach path). */
  disconnect(): Promise<void>;
}

export interface E2bPtyInputStream {
  /** Queue input for ordered transmission (the SDK keeps order + keepalive). */
  send(data: string): Promise<void>;
  close(): Promise<void>;
}

/** One filesystem entry as the SDK's files API reports it. */
export interface E2bFileEntry {
  name: string;
  /** Absolute path inside the sandbox. */
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  mode: number;
  mtimeMs: number;
  linkTarget?: string;
}

export interface E2bSandboxHandle {
  readonly sandboxId: string;
  /**
   * Traffic access token for this sandbox's private URLs (present
   * when the sandbox was created with public traffic off). Held in
   * memory only; never persisted, never logged.
   */
  readonly trafficAccessToken?: string;
  runCommand(
    command: string,
    opts: {
      cwd?: string;
      timeoutMs?: number;
      stdin?: string;
      envs?: Record<string, string>;
      user?: string;
    },
  ): Promise<E2bCommandResult>;
  /** Host (no scheme) for an exposed port, per the SDK's getHost(). */
  getHost(port: number): string;
  /**
   * The sandbox's real expiration as reported by the provider
   * (epoch ms), or null when the handle cannot report it. Optional:
   * handles that predate this method simply do not implement it and
   * the provider falls back to its own tracked lifetime.
   */
  getExpiry?(): Promise<number | null>;
  /**
   * The metadata the sandbox was created with (the littree_*
   * identity tags), or null when the handle cannot report it.
   * Optional for the same reason as getExpiry — but re-adoption
   * (provider get() after a process restart) REQUIRES it: a handle
   * that cannot prove the sandbox's identity is never adopted.
   */
  getMetadata?(): Promise<Record<string, string> | null>;
  setTimeout(timeoutMs: number): Promise<void>;
  /** Pause preserves disk + memory state; used for stop(). */
  pause(): Promise<boolean>;
  kill(): Promise<boolean>;
  isRunning(): Promise<boolean>;
  // ─── PTY API (terminal bridge) ───────────────────────────────────
  createPty(opts: E2bPtyCreateOptions): Promise<E2bPtyHandle>;
  connectPty(pid: number, opts: E2bPtyConnectOptions): Promise<E2bPtyHandle>;
  streamPtyInput(pid: number, opts: { timeoutMs: number }): E2bPtyInputStream;
  resizePty(pid: number, size: { cols: number; rows: number }): Promise<void>;
  killPty(pid: number): Promise<boolean>;
  // ─── Files API (Phase 2 lifecycle file transfer) ─────────────────
  readFileBytes(path: string): Promise<Uint8Array>;
  writeFileBytes(path: string, data: Uint8Array): Promise<void>;
  listDir(path: string): Promise<E2bFileEntry[]>;
  removePath(path: string): Promise<void>;
  makeDir(path: string): Promise<void>;
  renamePath(oldPath: string, newPath: string): Promise<void>;
}

export interface E2bCreateOptions {
  template: string;
  timeoutMs: number;
  envs: Record<string, string>;
  metadata: Record<string, string>;
  cpuCount: number;
  memoryMB: number;
  /**
   * Create-time network policy, forwarded to the SDK verbatim.
   * `allowPublicTraffic: false` makes sandbox URLs private: requests
   * without the sandbox's traffic access token are rejected by the
   * provider (design note §3.2). On the pinned SDK (e2b@2.63) the
   * option lives on the network object; the deprecated top-level
   * `secure` flag is ignored by the SDK and is not used.
   */
  network: { denyOut: string[]; allowPublicTraffic?: boolean };
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

interface E2bSdkEntryLike {
  name: string;
  type?: string;
  path: string;
  size?: number | bigint;
  mode?: number;
  modifiedTime?: Date;
  symlinkTarget?: string;
}

/** The SDK's CommandHandle, narrowed to what the PTY wrap uses. */
interface E2bSdkPtyHandleLike {
  pid: number;
  wait(): Promise<{ exitCode: number }>;
  disconnect(): Promise<void>;
}

/** The SDK's CommandInputHandle, narrowed to what the PTY wrap uses. */
interface E2bSdkPtyInputLike {
  send(data: string | Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface E2bSdkSandboxLike {
  sandboxId: string;
  trafficAccessToken?: string;
  commands: {
    run(
      cmd: string,
      opts?: Record<string, unknown>,
    ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  pty: {
    create(opts: {
      cols: number;
      rows: number;
      onData: (data: Uint8Array) => void | Promise<void>;
      timeoutMs: number;
      envs: Record<string, string>;
      cwd: string;
    }): Promise<E2bSdkPtyHandleLike>;
    connect(
      pid: number,
      opts: {
        onData: (data: Uint8Array) => void | Promise<void>;
        timeoutMs: number;
      },
    ): Promise<E2bSdkPtyHandleLike>;
    streamInput(
      pid: number,
      opts: { timeoutMs: number },
    ): E2bSdkPtyInputLike;
    resize(pid: number, size: { cols: number; rows: number }): Promise<void>;
    kill(pid: number): Promise<boolean>;
  };
  files: {
    read(
      path: string,
      opts: { format: "bytes" },
    ): Promise<Uint8Array>;
    write(path: string, data: Uint8Array): Promise<unknown>;
    list(path: string): Promise<E2bSdkEntryLike[]>;
    remove(path: string): Promise<void>;
    makeDir(path: string): Promise<boolean>;
    rename(oldPath: string, newPath: string): Promise<unknown>;
  };
  getHost(port: number): string;
  setTimeout(timeoutMs: number): Promise<void>;
  pause(): Promise<boolean>;
  kill(): Promise<boolean>;
  isRunning(): Promise<boolean>;
  /** Server-reported sandbox info; endAt is the real expiration. */
  getInfo(): Promise<{
    endAt: Date | string;
    metadata?: Record<string, string>;
  }>;
}

function mapSdkEntry(entry: E2bSdkEntryLike): E2bFileEntry {
  const type =
    entry.type === "dir" ? "dir" : entry.type === "symlink" ? "symlink" : "file";
  return {
    name: entry.name,
    path: entry.path,
    type,
    size: typeof entry.size === "bigint" ? Number(entry.size) : (entry.size ?? 0),
    mode: entry.mode ?? 0,
    mtimeMs: entry.modifiedTime ? entry.modifiedTime.getTime() : 0,
    ...(entry.symlinkTarget ? { linkTarget: entry.symlinkTarget } : {}),
  };
}

function wrapSdkPtyHandle(handle: E2bSdkPtyHandleLike): E2bPtyHandle {
  return {
    pid: handle.pid,
    async wait() {
      try {
        const result = await handle.wait();
        return { exitCode: result.exitCode };
      } catch (err) {
        // The SDK throws CommandExitError for a non-zero exit; the
        // error itself carries the exit code, and a shell exiting
        // non-zero is a normal end, not a transport failure. Anything
        // else (stream died without a result, deadline, transport)
        // is a real failure and propagates as a rejection.
        const e = err as { exitCode?: unknown };
        if (typeof e?.exitCode === "number") {
          return { exitCode: e.exitCode };
        }
        throw err;
      }
    },
    disconnect: () => handle.disconnect(),
  };
}

function wrapSdkSandbox(sbx: E2bSdkSandboxLike): E2bSandboxHandle {
  return {
    sandboxId: sbx.sandboxId,
    trafficAccessToken: sbx.trafficAccessToken,
    async readFileBytes(path) {
      return sbx.files.read(path, { format: "bytes" });
    },
    async writeFileBytes(path, data) {
      await sbx.files.write(path, data);
    },
    async listDir(path) {
      const entries = await sbx.files.list(path);
      return entries.map(mapSdkEntry);
    },
    async removePath(path) {
      await sbx.files.remove(path);
    },
    async makeDir(path) {
      await sbx.files.makeDir(path);
    },
    async renamePath(oldPath, newPath) {
      await sbx.files.rename(oldPath, newPath);
    },
    async runCommand(command, opts) {
      try {
        const res = await sbx.commands.run(command, {
          cwd: opts.cwd,
          timeoutMs: opts.timeoutMs,
          stdin: opts.stdin,
          envs: opts.envs,
          user: opts.user,
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
    async getExpiry() {
      // Sandbox.getInfo() reports the server-side endAt — the real
      // expiration, which counts from the last setTimeout call. Any
      // failure (or an unparseable value) yields null so the caller
      // falls back to its tracked lifetime instead of guessing.
      try {
        const info = await sbx.getInfo();
        const ms =
          info.endAt instanceof Date
            ? info.endAt.getTime()
            : Date.parse(String(info.endAt));
        return Number.isFinite(ms) ? ms : null;
      } catch {
        return null;
      }
    },
    async getMetadata() {
      // The create-time metadata (the littree_* identity tags),
      // from the same getInfo surface as getExpiry. Any failure —
      // or an absent metadata field on an older server response —
      // yields null, and re-adoption fails closed on it.
      try {
        const info = await sbx.getInfo();
        return info.metadata ?? null;
      } catch {
        return null;
      }
    },
    setTimeout: (ms) => sbx.setTimeout(ms),
    pause: () => sbx.pause(),
    kill: () => sbx.kill(),
    isRunning: () => sbx.isRunning(),
    async createPty(opts) {
      const handle = await sbx.pty.create({
        cols: opts.cols,
        rows: opts.rows,
        onData: opts.onData,
        timeoutMs: opts.timeoutMs,
        envs: opts.envs,
        cwd: opts.cwd,
      });
      return wrapSdkPtyHandle(handle);
    },
    async connectPty(pid, opts) {
      const handle = await sbx.pty.connect(pid, {
        onData: opts.onData,
        timeoutMs: opts.timeoutMs,
      });
      return wrapSdkPtyHandle(handle);
    },
    streamPtyInput: (pid, opts) => {
      const input = sbx.pty.streamInput(pid, { timeoutMs: opts.timeoutMs });
      return {
        send: (data) => input.send(data),
        close: () => input.close(),
      };
    },
    resizePty: (pid, size) => sbx.pty.resize(pid, size),
    killPty: (pid) => sbx.pty.kill(pid),
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
        network: opts.network,
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
  /**
   * Per-call deadline for files / metadata / lifecycle requests
   * (tests inject ~50 ms). Defaults to E2B_REQUEST_TIMEOUT_MS.
   */
  requestTimeoutMs?: number;
  /**
   * Per-call deadline for client.create / client.connect (tests
   * inject ~50 ms). Defaults to E2B_CREATE_REQUEST_TIMEOUT_MS.
   */
  createRequestTimeoutMs?: number;
}

interface RegistryEntry {
  instance: SandboxInstance;
  handle: E2bSandboxHandle;
  /** Full composed environment, re-supplied per command (see create). */
  env: Record<string, string>;
  /**
   * Tracked real expiry (epoch ms): set at create from the clamped
   * create timeout and re-armed at every setTimeout this provider
   * issues, mirroring E2B's rule that the lifetime counts from the
   * last setTimeout call. exposePort prefers the handle's
   * server-reported getInfo endAt and falls back to this — never to
   * a synthetic offset.
   */
  expiresAtMs: number | null;
}

/**
 * Kept for any future provider that cannot attach a terminal (the
 * E2B provider implements connectTerminal since the terminal bridge;
 * providers without a PTY surface throw this instead of faking a
 * transport).
 */
export class E2bTerminalUnsupportedError extends Error {
  readonly code = "SANDBOX_TERMINAL_UNSUPPORTED" as const;
  constructor() {
    super(
      "This sandbox provider does not support interactive terminal attach.",
    );
    this.name = "E2bTerminalUnsupportedError";
  }
}

/** Upper bound on one recursive tree listing (sync manifest source). */
export const MAX_LIST_TREE_ENTRIES = 100_000;

/** Map an absolute-path handle entry to a root-relative transfer entry. */
function toTransferEntry(rootPath: string, entry: E2bFileEntry): SandboxFileEntry {
  const root = rootPath.endsWith("/") ? rootPath.slice(0, -1) : rootPath;
  const rel = entry.path.startsWith(`${root}/`)
    ? entry.path.slice(root.length + 1)
    : entry.name;
  return {
    path: rel,
    type: entry.type,
    size: entry.type === "file" ? entry.size : 0,
    mtimeMs: entry.mtimeMs,
    mode: entry.mode,
    ...(entry.linkTarget ? { linkTarget: entry.linkTarget } : {}),
  };
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
  private readonly requestTimeoutMs: number;
  private readonly createRequestTimeoutMs: number;
  private readonly registry = new Map<string, RegistryEntry>();

  constructor(options: E2bSandboxProviderOptions) {
    if (!options.apiKey) {
      throw new Error("E2bSandboxProvider requires an API key (E2B_API_KEY)");
    }
    this.client = options.client ?? createDefaultE2bClient(options.apiKey);
    this.templateId = options.templateId ?? DEFAULT_E2B_TEMPLATE_ID;
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = options.requestTimeoutMs ?? E2B_REQUEST_TIMEOUT_MS;
    this.createRequestTimeoutMs =
      options.createRequestTimeoutMs ?? E2B_CREATE_REQUEST_TIMEOUT_MS;
  }

  /** One files / metadata / lifecycle call, deadline-bounded. */
  private deadline<T>(promise: Promise<T>, label: string): Promise<T> {
    return withRequestDeadline(promise, this.requestTimeoutMs, label);
  }

  /** One structural call (client.create / client.connect), deadline-bounded. */
  private createDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
    return withRequestDeadline(promise, this.createRequestTimeoutMs, label);
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

    // The create-time timeoutMs is a HARD KILL in E2B, not an idle
    // timeout — despite the limits field's name. Passing
    // idleTimeoutMinutes (15) killed live workspace sandboxes at
    // exactly 15:00 mid-session (2026-11-16 proof: created 11:34:41,
    // killed 11:49:41, forward push failed 11:49:47). A workspace
    // sandbox must live for a work session: maxSessionMinutes is
    // the session-scale lifetime the limits already define (and the
    // value start() already re-arms on resume). execute() extends
    // the clock on activity, so an actively used sandbox never
    // reaches even this bound.
    const createTimeoutMs = clampSandboxTimeoutMs(limits.maxSessionMinutes * 60_000);
    const handle = await this.createDeadline(
      this.client.create({
        template: this.templateId,
        timeoutMs: createTimeoutMs,
        envs: createEnv,
        metadata: {
          littree_user_id: input.userId,
          littree_project_id: input.projectId,
          littree_workspace_id: input.workspaceId,
        },
        cpuCount: limits.cpuVcpus,
        memoryMB: limits.memoryMB,
        // Every sandbox this provider creates — canary and real
        // workspaces alike — gets the metadata egress deny rule. This
        // create() is the single funnel, so the rule cannot drift
        // between what the canary certifies and what workspaces run.
        // Public traffic is OFF for the same reason (design note §3.2):
        // a sandbox URL is worthless without its traffic access token,
        // which never leaves the terminal process.
        network: { denyOut: [...SANDBOX_EGRESS_DENY_OUT], allowPublicTraffic: false },
      }),
      "create",
    );

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
    this.registry.set(handle.sandboxId, {
      instance,
      handle,
      env,
      expiresAtMs: this.now() + createTimeoutMs,
    });
    return { ...instance };
  }

  async get(sandboxId: string): Promise<SandboxInstance | null> {
    const entry = this.registry.get(sandboxId);
    if (!entry) return this.adopt(sandboxId);
    // Liveness is verified against E2B, not just the in-process
    // registry: a sandbox E2B killed (timeout, host failure) stays in
    // this Map forever otherwise, and every caller of get() — the
    // workspace executor's ensure above all — kept certifying the
    // corpse as "running", which made the executor's recreate branch
    // unreachable until a terminal-process restart emptied the Map
    // (2026-11-16 proof). A verified-dead sandbox is forgotten here
    // so get() returns null and the caller takes its existing
    // recreate path; the volume holds the last synced state, so
    // recreation loses nothing (§2). A PAUSED sandbox (instance
    // state "stopped") also reports not-running at E2B but is
    // resumable via start()/connect — it is never probed, so pause
    // semantics are untouched. A probe error reads as dead: the
    // command a caller runs next would fail against a truly gone
    // sandbox anyway, and recreation is the designed recovery.
    if (entry.instance.state === "running") {
      let running = false;
      try {
        running = await this.deadline(entry.handle.isRunning(), "isRunning");
      } catch {
        running = false;
      }
      if (!running) {
        this.registry.delete(sandboxId);
        return null;
      }
    }
    return { ...entry.instance };
  }

  /**
   * Re-adopt a sandbox this process has never seen (provisioning
   * fix): the registry is in-memory, so after a terminal-process
   * restart every persisted binding pointed at a sandbox get() had
   * never heard of, boot reconcile deleted the binding as "not
   * found", and the next ensure paid a full cold create+mirror —
   * serialized behind the workspace lock against a settle bound
   * sized for an uncontended run, so preview, terminal, and prepare
   * ensures timed out in the queue (2026-11-19 provisioning
   * diagnosis). Adoption connects by id and recovers the sandbox's
   * identity from the metadata create() tagged it with.
   *
   * FAIL CLOSED, always: an id E2B refuses to connect, a handle
   * that cannot report metadata, or metadata missing ANY of the
   * three littree_* identity fields yields null — the caller takes
   * its existing recreate path, exactly as if the sandbox were
   * gone. A sandbox adopted with mismatched identity (possible only
   * if the metadata itself lies) is still caught downstream: the
   * executor re-verifies identity against the workspace descriptor
   * on every ensure and destroys mismatches.
   *
   * Resource limits cannot be recovered from E2B (they were never
   * more than records here — the template defines real sizing), so
   * an adopted instance carries the contract defaults; the executor
   * reads only identity and state from it. Created-at is likewise
   * unrecoverable and reads as the adoption time.
   */
  private async adopt(sandboxId: string): Promise<SandboxInstance | null> {
    let handle: E2bSandboxHandle;
    try {
      handle = await this.createDeadline(
        this.client.connect(sandboxId),
        "connect (adopt)",
      );
    } catch {
      // Gone (or unreachable) at E2B: the designed null.
      return null;
    }
    if (!handle.getMetadata) return null;
    let metadata: Record<string, string> | null;
    try {
      metadata = await this.deadline(handle.getMetadata(), "getMetadata (adopt)");
    } catch {
      return null;
    }
    const userId = metadata?.littree_user_id;
    const projectId = metadata?.littree_project_id;
    const workspaceId = metadata?.littree_workspace_id;
    if (!userId || !projectId || !workspaceId) return null;

    let running = false;
    try {
      running = await this.deadline(handle.isRunning(), "isRunning (adopt)");
    } catch {
      return null;
    }

    const env = composeSandboxEnv({
      userId,
      projectId,
      workspaceId,
      sandboxId,
    });
    const nowIso = this.isoNow();
    const instance: SandboxInstance = {
      sandboxId,
      workspaceId,
      userId,
      projectId,
      state: running ? "running" : "stopped",
      limits: { ...DEFAULT_SANDBOX_LIMITS },
      createdAt: nowIso,
      startedAt: running ? nowIso : null,
      lastActiveAt: nowIso,
      stoppedAt: running ? null : nowIso,
      failureReason: null,
      provider: this.name,
      endpoint: null,
    };
    let expiresAtMs: number | null = null;
    if (handle.getExpiry) {
      expiresAtMs = await this.deadline(handle.getExpiry(), "getExpiry (adopt)")
        .catch(() => null);
    }
    this.registry.set(sandboxId, { instance, handle, env, expiresAtMs });
    return { ...instance };
  }

  private entry(sandboxId: string): RegistryEntry {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    return entry;
  }

  async start(sandboxId: string): Promise<void> {
    const entry = this.entry(sandboxId);
    // Sandbox.connect auto-resumes a paused sandbox.
    entry.handle = await this.createDeadline(
      this.client.connect(sandboxId),
      "connect (start)",
    );
    const startTimeoutMs = clampSandboxTimeoutMs(
      entry.instance.limits.maxSessionMinutes * 60_000,
    );
    await this.deadline(entry.handle.setTimeout(startTimeoutMs), "setTimeout (start)");
    entry.expiresAtMs = this.now() + startTimeoutMs;
    entry.instance.state = "running";
    entry.instance.startedAt = this.isoNow();
    entry.instance.stoppedAt = null;
    entry.instance.lastActiveAt = this.isoNow();
  }

  async stop(sandboxId: string): Promise<void> {
    const entry = this.entry(sandboxId);
    // pause() snapshots the sandbox (disk preserved) — the contract's
    // "stop preserves disk" semantics.
    await this.deadline(entry.handle.pause(), "pause");
    entry.instance.state = "stopped";
    entry.instance.stoppedAt = this.isoNow();
  }

  async destroy(sandboxId: string): Promise<void> {
    const entry = this.registry.get(sandboxId);
    if (!entry) return; // destroying a gone sandbox is a no-op
    this.registry.delete(sandboxId);
    await this.deadline(entry.handle.kill(), "kill");
  }

  /**
   * Attach an interactive shell to a sandbox (terminal bridge,
   * TERMINAL-BRIDGE-SPEC-2026-11-17 §2.3/§2.4).
   *
   * The shell is the SDK's PTY: /bin/bash -i -l as the template's
   * default non-root user (no `user` is ever passed — lifecycle
   * repairs that need root stay on the exec path), cwd /workspace,
   * env = the sandbox's stored composed env, re-checked with
   * assertNoPlatformSecrets before the SDK call exactly like
   * create(). Caller env (options.env) layers over it through the
   * per-command value guard, exactly like execute().
   *
   * THE 60-SECOND TRAP (§2.4): the SDK defaults the timeoutMs of
   * pty.create, pty.connect AND pty.streamInput to 60,000 ms, and
   * each is the deadline for that call's whole event/input stream —
   * a shell opened without an explicit value dies at 60 seconds.
   * All three are pinned here to the sandbox's clamped session
   * lifetime (maxSessionMinutes, itself clamped to the Hobby 1-hour
   * cap), so a PTY stream can never outlive its sandbox and never
   * dies early. 0 is never used: its connect-rpc deadline semantics
   * are not the documented disable value on the create/connect path.
   */
  async connectTerminal(
    sandboxId: string,
    options: TerminalConnectOptions,
  ): Promise<TerminalTransport> {
    const entry = this.entry(sandboxId);
    if (entry.instance.state === "stopped") {
      await this.start(sandboxId);
    }
    const attach = this.preparePtyAttach(entry, options);
    // Re-arm the sandbox clock before the shell opens, copying
    // execute()'s pattern: an actively used sandbox never reaches
    // its kill bound mid-session. Best effort — a truly dead sandbox
    // fails the create below with the SDK's own error.
    await this.deadline(
      entry.handle.setTimeout(
        clampSandboxTimeoutMs(entry.instance.limits.maxSessionMinutes * 60_000),
      ),
      "setTimeout (connectTerminal)",
    ).catch(() => {});
    const pty = await this.deadline(
      entry.handle.createPty({
        cols: attach.cols,
        rows: attach.rows,
        onData: attach.onData,
        timeoutMs: attach.timeoutMs,
        envs: attach.envs,
        cwd: "/workspace",
      }),
      "createPty",
    );
    return attach.finish(pty);
  }

  /**
   * Re-attach to a still-running PTY (terminal bridge §2.3): the
   * transport sessionId (`${sandboxId}:${pid}`) names the pid, and
   * pty.connect(pid) opens a fresh event stream onto the same shell.
   * Additive to the SandboxProvider contract — the session manager
   * consumes it through a structural optional interface, and a
   * provider without it simply misses reattach (a fresh PTY opens in
   * the same sandbox instead). Throws when the sessionId does not
   * name a pid of THIS sandbox, or when the pid is gone.
   */
  async reattachTerminal(
    sandboxId: string,
    sessionId: string,
    options: TerminalConnectOptions,
  ): Promise<TerminalTransport> {
    const entry = this.entry(sandboxId);
    if (entry.instance.state === "stopped") {
      await this.start(sandboxId);
    }
    const prefix = `${sandboxId}:`;
    const pid = sessionId.startsWith(prefix)
      ? Number(sessionId.slice(prefix.length))
      : NaN;
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(
        `Invalid sandbox terminal session id for sandbox ${sandboxId}`,
      );
    }
    const attach = this.preparePtyAttach(entry, options);
    await this.deadline(
      entry.handle.setTimeout(
        clampSandboxTimeoutMs(entry.instance.limits.maxSessionMinutes * 60_000),
      ),
      "setTimeout (reattachTerminal)",
    ).catch(() => {});
    const pty = await this.deadline(
      entry.handle.connectPty(pid, {
        onData: attach.onData,
        timeoutMs: attach.timeoutMs,
      }),
      "connectPty",
    );
    return attach.finish(pty);
  }

  /**
   * Shared PTY attach preparation: clamped dimensions, the pinned
   * stream timeout, the env discipline, and the output/exit plumbing
   * every transport (create or reconnect) is built from. `onData`
   * must exist before the SDK call (it is a create/connect option),
   * while the transport exists only after — so output is decoded and
   * fanned out through this closure, and anything printed before the
   * caller registers onOutput is buffered (bounded) and replayed to
   * the first registrant, mirroring the host manager's parked-output
   * replay.
   */
  private preparePtyAttach(
    entry: RegistryEntry,
    options: TerminalConnectOptions,
  ): {
    cols: number;
    rows: number;
    timeoutMs: number;
    envs: Record<string, string>;
    onData: (data: Uint8Array) => void;
    finish: (pty: E2bPtyHandle) => TerminalTransport & { disconnect: () => void };
  } {
    // Env discipline, identical to create()/execute(): the stored
    // composed env is re-checked by NAME before any SDK call; caller
    // env layers over it guarded BY VALUE against the terminal's own
    // platform secrets (identity vars in it are dropped — identity
    // always wins).
    assertNoPlatformSecrets(entry.env);
    const envs = options.env
      ? {
          ...entry.env,
          ...guardPerCommandProjectEnv(
            options.env,
            collectPlatformSecretValues(process.env),
          ),
        }
      : entry.env;

    const cols = clampPtyDimension(options.cols, MAX_PTY_COLS);
    const rows = clampPtyDimension(options.rows, MAX_PTY_ROWS);
    // The one pinned timeout for every stream this attach opens
    // (create/connect + the input stream in finish()).
    const timeoutMs = clampSandboxTimeoutMs(
      entry.instance.limits.maxSessionMinutes * 60_000,
    );

    const decoder = new TextDecoder();
    const outputCallbacks = new Set<(data: string) => void>();
    const exitCallbacks = new Set<
      (info: { exitCode: number; signal?: string }) => void
    >();
    let exitInfo: { exitCode: number; signal?: string } | null = null;
    let buffered: string[] = [];
    let bufferedBytes = 0;

    const onData = (data: Uint8Array): void => {
      const text = decoder.decode(data, { stream: true });
      if (!text) return;
      if (outputCallbacks.size === 0) {
        const bytes = Buffer.byteLength(text, "utf8");
        if (bufferedBytes + bytes <= PTY_PRE_REGISTRATION_BUFFER_BYTES) {
          buffered.push(text);
          bufferedBytes += bytes;
        }
        return;
      }
      for (const cb of outputCallbacks) cb(text);
    };

    const finish = (
      pty: E2bPtyHandle,
    ): TerminalTransport & { disconnect: () => void } => {
      const input = entry.handle.streamPtyInput(pty.pid, { timeoutMs });
      let closed = false;
      const settleExit = (info: { exitCode: number }): void => {
        if (exitInfo) return;
        exitInfo = info;
        for (const cb of exitCallbacks) cb(info);
        exitCallbacks.clear();
      };
      pty.wait().then(
        ({ exitCode }) => settleExit({ exitCode }),
        // The stream died without a result (sandbox gone, transport
        // failure): the shell is over either way; -1 marks the
        // abnormal end, and the session manager separately probes
        // sandbox liveness for the honest user-facing state.
        () => settleExit({ exitCode: -1 }),
      );
      const transport: TerminalTransport & { disconnect: () => void } = {
        sessionId: `${entry.instance.sandboxId}:${pty.pid}`,
        write: (data) => {
          if (closed) return;
          // streamInput queues in call order (the SDK's ordered,
          // keepalive input stream) — ordering matters for a shell.
          // A failed send means the stream is gone; the exit path
          // reports the session's end, so the write itself stays
          // fire-and-forget exactly like the host PTY's write.
          void input.send(data).catch(() => {});
        },
        resize: (nextCols, nextRows) => {
          void entry.handle
            .resizePty(pty.pid, {
              cols: clampPtyDimension(nextCols, MAX_PTY_COLS),
              rows: clampPtyDimension(nextRows, MAX_PTY_ROWS),
            })
            .catch(() => {});
        },
        onOutput: (cb) => {
          outputCallbacks.add(cb);
          if (buffered.length > 0) {
            const pending = buffered;
            buffered = [];
            bufferedBytes = 0;
            for (const chunk of pending) cb(chunk);
          }
        },
        onExit: (cb) => {
          if (exitInfo) cb(exitInfo);
          else exitCallbacks.add(cb);
        },
        kill: () => {
          closed = true;
          void input.close().catch(() => {});
          void entry.handle.killPty(pty.pid).catch(() => {});
        },
        // Beyond the contract, additive: stop this attach's event
        // stream WITHOUT killing the shell, so a reattach can hand
        // the pid to a fresh stream (pty.connect) with no duplicate
        // delivery. The session manager feature-detects it.
        disconnect: () => {
          closed = true;
          void input.close().catch(() => {});
          void pty.disconnect().catch(() => {});
        },
      };
      return transport;
    };

    return { cols, rows, timeoutMs, envs, onData, finish };
  }

  async execute(
    sandboxId: string,
    input: ExecuteCommandInput,
  ): Promise<ExecuteCommandResult> {
    const entry = this.entry(sandboxId);
    if (entry.instance.state === "stopped") {
      await this.start(sandboxId);
    }
    // Per-command project env (Phase 2): guarded by VALUE against the
    // terminal's own platform secrets and layered over the composed
    // base env for this command only — the stored base env is never
    // mutated, so a later command without env sees the base again.
    // The guard runs before any SDK call, exactly like create().
    const envs = input.env
      ? {
          ...entry.env,
          ...guardPerCommandProjectEnv(
            input.env,
            collectPlatformSecretValues(process.env),
          ),
        }
      : entry.env;
    // Activity extends the sandbox's E2B lifetime: re-arm the
    // session clock BEFORE the command runs, so a long command can
    // never outlive its own sandbox and an actively used sandbox
    // never reaches the create-time kill bound. Previously this
    // method only updated the local lastActiveAt timestamp — the
    // E2B clock kept counting down regardless of activity, which is
    // how a busy workspace sandbox died at exactly 15:00
    // (2026-11-16 proof). Best effort by design: if the extension
    // itself fails, the command's own result stays authoritative —
    // a truly dead sandbox fails runCommand with the SDK's error,
    // and get()/ensure then recreate it.
    const activityTimeoutMs = clampSandboxTimeoutMs(
      entry.instance.limits.maxSessionMinutes * 60_000,
    );
    await this.deadline(
      entry.handle.setTimeout(activityTimeoutMs),
      "setTimeout (execute)",
    )
      .then(() => {
        entry.expiresAtMs = this.now() + activityTimeoutMs;
      })
      .catch(() => {});
    const startedMs = this.now();
    // The request deadline outlives the command's own budget by the
    // grace constant — it exists to unwedge a stalled transport,
    // never to cut a long command (the 900 s install runs through
    // here).
    const commandTimeoutMs = input.timeoutMs ?? 60_000;
    const result = await withRequestDeadline(
      entry.handle.runCommand(input.command, {
        cwd: input.cwd ?? "/workspace",
        timeoutMs: input.timeoutMs ?? 60_000,
        stdin: input.stdin,
        envs,
        user: input.user,
      }),
      commandTimeoutMs + E2B_COMMAND_DEADLINE_GRACE_MS,
      "runCommand",
    );
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
    // Round 16 follow-up: record WHERE the traffic token came
    // from — the sandbox handle's real token, or the random
    // fallback substituted when the handle carries none. The
    // fallback cannot authenticate against the provider's
    // private-traffic gate, so this one bit separates "the
    // terminal is sending a made-up token" from "the path to the
    // provider ingress is black-holing" on the next dead-ingress
    // proof. ONLY the source is logged — never the token value
    // or any fragment of it.
    const handleToken = entry.handle.trafficAccessToken;
    console.info(
      `[e2b-provider] exposePort sandbox=${sandboxId} port=${port} ` +
        `trafficTokenSource=${handleToken != null ? "sandbox-handle" : "random-fallback"}`,
    );
    return {
      port,
      url: `https://${host}`,
      state: "private",
      // The sandbox's real traffic access token when the SDK reports
      // one (private traffic, design note §3.2): the preview proxy
      // sends it as the `e2b-traffic-access-token` header so a leaked
      // provider hostname alone is useless. Handles that report no
      // token (older templates) fall back to an opaque correlation
      // token, exactly the Phase 1 behavior. The authenticated
      // preview proxy is the only consumer of either value; neither
      // is rendered to a browser or persisted anywhere.
      previewToken: handleToken ?? randomBytes(16).toString("hex"),
      // Truthful expiry (C3/C4): the sandbox's REAL expiration —
      // the server-reported endAt from getInfo when the handle can
      // report it, else this provider's tracked lifetime (create /
      // setTimeout re-arms). The previous value was a synthetic
      // now + idleTimeoutMinutes (15 min) offset that ignored every
      // extension, so consumers judged live addresses lapsed (and
      // lapsed ones live) on a clock nothing else obeyed.
      expiresAt: new Date(
        (await this.resolveExpiryMs(entry)) ?? this.now(),
      ).toISOString(),
    };
  }

  /**
   * The sandbox's real expiry (epoch ms): the handle's
   * server-reported endAt when available, else the tracked
   * lifetime. A getInfo answer also refreshes the tracked value so
   * later fallback reads stay close to the server truth.
   */
  private async resolveExpiryMs(entry: RegistryEntry): Promise<number | null> {
    if (entry.handle.getExpiry) {
      const reported = await this.deadline(entry.handle.getExpiry(), "getExpiry")
        .catch(() => null);
      if (reported != null) {
        entry.expiresAtMs = reported;
        return reported;
      }
    }
    return entry.expiresAtMs;
  }

  /** Extend a live sandbox's remaining lifetime (preview keepalive). */
  async extendTimeout(sandboxId: string, timeoutMs: number): Promise<void> {
    const entry = this.entry(sandboxId);
    const clampedMs = clampSandboxTimeoutMs(timeoutMs);
    await this.deadline(entry.handle.setTimeout(clampedMs), "setTimeout (extendTimeout)");
    entry.expiresAtMs = this.now() + clampedMs;
    entry.instance.lastActiveAt = this.isoNow();
  }

  /**
   * File-transfer capability (design note §1.6) over the SDK files
   * API. Listing is recursive with a hard entry cap so a pathological
   * tree cannot wedge a sync; the cap surfaces as an error the caller
   * reports, never a silent truncation.
   */
  readonly fileTransfer: SandboxFileTransfer = {
    readFile: async (sandboxId, path) => {
      const entry = this.entry(sandboxId);
      return this.deadline(entry.handle.readFileBytes(path), "readFileBytes");
    },
    writeFile: async (sandboxId, path, data) => {
      const entry = this.entry(sandboxId);
      await this.deadline(entry.handle.writeFileBytes(path, data), "writeFileBytes");
    },
    listDir: async (sandboxId, path) => {
      const entry = this.entry(sandboxId);
      const entries = await this.deadline(entry.handle.listDir(path), "listDir");
      return entries.map((e) => toTransferEntry(path, e));
    },
    listTree: async (sandboxId, path) => {
      const entry = this.entry(sandboxId);
      const out: SandboxFileEntry[] = [];
      const walk = async (dir: string): Promise<void> => {
        const entries = await this.deadline(entry.handle.listDir(dir), "listDir (tree)");
        for (const e of entries) {
          out.push(toTransferEntry(path, e));
          if (out.length > MAX_LIST_TREE_ENTRIES) {
            throw new Error(
              `Sandbox tree listing exceeded ${MAX_LIST_TREE_ENTRIES} entries at ${path}`,
            );
          }
          if (e.type === "dir") await walk(e.path);
        }
      };
      await walk(path);
      return out;
    },
    removePath: async (sandboxId, path) => {
      const entry = this.entry(sandboxId);
      await this.deadline(entry.handle.removePath(path), "removePath");
    },
    makeDir: async (sandboxId, path) => {
      const entry = this.entry(sandboxId);
      await this.deadline(entry.handle.makeDir(path), "makeDir");
    },
    renamePath: async (sandboxId, oldPath, newPath) => {
      const entry = this.entry(sandboxId);
      await this.deadline(entry.handle.renamePath(oldPath, newPath), "renamePath");
    },
  };

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
