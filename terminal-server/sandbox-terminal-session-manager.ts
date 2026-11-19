/**
 * Sandbox terminal session manager — the terminal bridge
 * (TERMINAL-BRIDGE-SPEC-2026-11-17 §2.5).
 *
 * Owns interactive shells that live INSIDE a workspace's E2B sandbox
 * (a Firecracker microVM), as opposed to PtySessionManager's host
 * shells. The semantics deliberately mirror PtySessionManager —
 * snapshot shape, detach/reattach ownership + workspace-scope
 * re-checks, output chunk/pending caps with backpressure warnings,
 * input size cap — with sandbox-specific bounds and duties:
 *
 *   - max 2 concurrent sandbox shells per user (they all share the
 *     one per-workspace sandbox);
 *   - 15-minute idle kill (the sandbox's own idleTimeoutMinutes —
 *     killing the PTY never touches the sandbox);
 *   - detach parks for the caller's grace window (server.ts passes
 *     the same PTY_RESUME_GRACE_MS the host path uses); reattach
 *     re-opens the PTY's event stream via the provider's
 *     pty.connect(pid) path, and a dead pid is a resume miss — the
 *     caller opens a fresh PTY in the same sandbox;
 *   - PTY input re-arms the sandbox's lifetime clock (throttled to
 *     one call per minute, clamped by the provider to the plan cap),
 *     copying execute()'s keepalive pattern;
 *   - sync-back: an interactive shell mutates the sandbox directly,
 *     bypassing exec's held sync-back, so this manager triggers the
 *     executor's syncBackForTerminal when a PTY exits or is killed
 *     and every 5 minutes while a session is attached. Failures are
 *     logged loudly and surfaced to the session's onLog channel —
 *     never silently dropped;
 *   - sandbox death is the absolute ceiling: when the provider
 *     reports the sandbox gone at PTY exit, the exit notice carries
 *     `sandboxEnded` so the server can tell the user the truth
 *     (§4 states table) instead of a bare exit code.
 *
 * The session map is in-memory, exactly like the host manager's: a
 * terminal-server restart orphans the mapping, not the sandbox — the
 * client's resumeSessionId simply misses and a fresh PTY opens in
 * the same sandbox via the executor's ensure.
 *
 * Fail-closed: create() runs only after the executor's gate-checked
 * ensure returns a sandbox; there is no path from here to a host
 * process, and a failed attach is an error, never a fallback.
 *
 * Create is single-flight per (userId, workspaceId) and adopts
 * existing live sessions on reconnect (see create()'s own
 * docstring), and each provisioning stage is settle-bounded
 * (SANDBOX_TERMINAL_PROVISION_TIMEOUT_MS) — both added after the
 * 2026-11-19 live proof, where a cold open raced a second
 * provision and hung past every client timeout with no error.
 */

import { randomUUID } from "crypto";
import {
  DEFAULT_SANDBOX_LIMITS,
  type SandboxProvider,
  type TerminalConnectOptions,
  type TerminalTransport,
} from "./sandbox/provider";
import {
  SANDBOX_HOME_DIR,
  SANDBOX_WORKSPACE_ROOT,
} from "./sandbox/workspace-executor";
import type { WorkspaceDescriptor } from "./workspace/WorkspaceManager";
import {
  MAX_COLS,
  MAX_INPUT_SIZE,
  MAX_OUTPUT_CHUNK,
  MAX_PENDING_OUTPUT_BYTES,
  MAX_ROWS,
  OUTPUT_DROP_WARN_INTERVAL_MS,
} from "./pty-session-manager";

// ─── Bounds (spec §2.5) ─────────────────────────────────────────────

/** Max concurrent sandbox shells per user. Host path keeps its own 5. */
export const SANDBOX_TERMINAL_MAX_SESSIONS_PER_USER = 2;
/** Idle kill for the PTY — the sandbox's idleTimeoutMinutes, in ms. */
export const SANDBOX_TERMINAL_IDLE_TIMEOUT_MS =
  DEFAULT_SANDBOX_LIMITS.idleTimeoutMinutes * 60_000;
/** Sync-back cadence while a session is attached. */
export const SANDBOX_TERMINAL_SYNC_INTERVAL_MS = 5 * 60_000;
/** Minimum spacing between sandbox-clock re-arms from PTY input. */
export const SANDBOX_TERMINAL_REARM_INTERVAL_MS = 60_000;
/**
 * The re-arm value: the session-scale lifetime, which the provider
 * clamps to the plan cap (E2B Hobby: 1 hour) at its own boundary.
 */
export const SANDBOX_TERMINAL_REARM_TIMEOUT_MS =
  DEFAULT_SANDBOX_LIMITS.maxSessionMinutes * 60_000;

/** Default PTY dimensions at open; the client resizes right after ready. */
const PTY_DEFAULT_COLS = 120;
const PTY_DEFAULT_ROWS = 32;
/**
 * Settle bound for one provisioning stage of create() (the executor
 * ensure, then the provider PTY attach). Matches the preview
 * recreation path's create bound
 * (PREVIEW_RECREATION_CREATE_TIMEOUT_MS = 480_000): a legitimate
 * first-open mirror of the biggest tree on the platform takes
 * minutes, so the bound must be generous — its job is to convert a
 * NEVER-settling await into a bounded, surfaced failure (the
 * server's catch emits terminal:error and the panel offers Retry)
 * instead of an eternal "provisioning" heartbeat. Added after the
 * 2026-11-19 live proof: a cold terminal open hung silently for
 * 13+ minutes because no layer of this path had any deadline.
 */
export const SANDBOX_TERMINAL_PROVISION_TIMEOUT_MS = 480_000;

/**
 * Race `promise` against a settle deadline of `timeoutMs`. Same
 * shape and discipline as the preview path's settleWithin
 * (preview/sandbox-runtime.ts): the promise is never cancelled —
 * a promise cannot be — it keeps running detached, and the race's
 * own handlers consume its eventual settle, so a late rejection is
 * never an unhandled rejection. The timer is unref'd: a pending
 * bound must not keep the process alive on its own.
 */
type SettleOutcome<T> = { settled: true; value: T } | { settled: false };

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<SettleOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value): SettleOutcome<T> => ({ settled: true, value })),
      new Promise<SettleOutcome<T>>((resolve) => {
        timer = setTimeout(() => resolve({ settled: false }), timeoutMs);
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ─── Dependency shapes ──────────────────────────────────────────────

/**
 * The executor surface this manager needs. SandboxWorkspaceExecutor
 * satisfies it structurally; tests inject a fake.
 */
export interface SandboxTerminalExecutor {
  ensureSandboxForTerminal(
    descriptor: WorkspaceDescriptor,
  ): Promise<{ sandboxId: string } | null>;
  syncBackForTerminal(descriptor: WorkspaceDescriptor): Promise<void>;
}

/**
 * The provider surface this manager needs: the untouched contract,
 * plus the additive reattach capability (implemented by the E2B
 * provider). A provider without reattachTerminal simply misses
 * reattach — a fresh PTY opens in the same sandbox.
 */
export interface SandboxTerminalProvider extends SandboxProvider {
  reattachTerminal?(
    sandboxId: string,
    sessionId: string,
    options: TerminalConnectOptions,
  ): Promise<TerminalTransport>;
}

export interface SandboxTerminalSessionManagerDeps {
  provider: SandboxTerminalProvider;
  executor: SandboxTerminalExecutor;
  /** Lifecycle/info log sink. Defaults to console.info. */
  log?: (message: string) => void;
  /** Loud failure log sink (sync-back failures). Defaults to console.error. */
  logError?: (message: string) => void;
  /** Clock injection (tests). */
  now?: () => number;
  /**
   * Per-stage settle bound for create()'s provisioning
   * (ensure, then PTY attach). Defaults to
   * SANDBOX_TERMINAL_PROVISION_TIMEOUT_MS; tests inject a short
   * bound so a never-settling fake fails in milliseconds.
   */
  provisionTimeoutMs?: number;
}

// ─── Session shapes ─────────────────────────────────────────────────

export interface SandboxTerminalExitInfo {
  sessionId: string;
  exitCode: number | null;
  signal?: number;
  /**
   * True when the sandbox itself is gone (its 1-hour lifetime ended
   * or the provider lost it) — the server renders the honest
   * sandbox-ended state from this, per spec §4.
   */
  sandboxEnded?: boolean;
}

export interface SandboxTerminalSessionSnapshot {
  sessionId: string;
  userId: string;
  projectId: string | null;
  workspaceId: string | null;
  cwd: string;
  shell: string;
  createdAt: number;
  lastActivityAt: number;
  exited: boolean;
  exitCode: number | null;
}

export interface CreateSandboxTerminalSessionOptions {
  userId: string;
  projectId?: string | null;
  workspaceId: string;
  /** The workspace descriptor the socket auth middleware verified. */
  descriptor: WorkspaceDescriptor;
  onData: (data: string) => void;
  onExit: (info: SandboxTerminalExitInfo) => void;
  onOutputDropped?: (info: { sessionId: string; dropped: number }) => void;
  isTransportWritable?: () => boolean;
  onBackpressureWarning?: (info: {
    sessionId: string;
    droppedChunks: number;
    droppedBytes: number;
  }) => void;
  /**
   * User-visible log surface for asynchronous failures that happen
   * off the request path (sync-back failures) — server.ts wires this
   * to the socket so the line lands in the panel's Logs tab.
   */
  onLog?: (message: string) => void;
  /**
   * The session id the connecting client offered for resume, when
   * the caller's reattach() attempt already missed. The miss happens
   * in a real race: a fast reconnect is processed before the old
   * socket's disconnect parks the session, so reattach() — which
   * only accepts parked sessions — refuses a session that is in
   * fact the caller's own live shell. create() then adopts that
   * named session (callbacks rebound to this caller) instead of
   * provisioning a second shell for the same workspace. Ownership
   * and workspace scope are re-checked here exactly as in
   * reattach(); a stale or foreign id is ignored, never adopted.
   */
  adoptSessionId?: string | null;
}

export interface SandboxTerminalCallbacks {
  onData: (data: string) => void;
  onExit: (info: SandboxTerminalExitInfo) => void;
  isTransportWritable?: () => boolean;
  onBackpressureWarning?: CreateSandboxTerminalSessionOptions["onBackpressureWarning"];
  onLog?: (message: string) => void;
}

/** Full internal session record (never exposed to clients). */
interface SandboxTerminalSession {
  sessionId: string;
  userId: string;
  projectId: string | null;
  workspaceId: string;
  descriptor: WorkspaceDescriptor;
  sandboxId: string;
  /** Provider transport id (`${sandboxId}:${pid}`); names the pid. */
  transportSessionId: string;
  cwd: string;
  shell: "bash";
  createdAt: number;
  lastActivityAt: number;
  transport: TerminalTransport | null;
  /** Incremented on every transport swap; stale transports go inert. */
  transportGeneration: number;
  exited: boolean;
  exitCode: number | null;
  exitSettled: boolean;
  // Output accounting (observability — mirrors the host manager).
  totalOutputDelivered: number;
  totalOutputDropped: number;
  // Backpressure (mirrors the host manager).
  emitData: (data: string) => void;
  emitExit: (info: SandboxTerminalExitInfo) => void;
  notifyDropped: ((info: { sessionId: string; dropped: number }) => void) | null;
  notifyBpWarning: CreateSandboxTerminalSessionOptions["onBackpressureWarning"] | null;
  isTransportWritable: (() => boolean) | null;
  pendingOutput: string[];
  pendingOutputBytes: number;
  bpDroppedChunks: number;
  bpDroppedBytes: number;
  bpTotalDroppedChunks: number;
  lastBpWarnAt: number;
  bpWarnPending: boolean;
  flushScheduled: boolean;
  onLog: ((message: string) => void) | null;
  // Lifecycle timers.
  idleTimer: ReturnType<typeof setTimeout> | null;
  detachTimer: ReturnType<typeof setTimeout> | null;
  syncTimer: ReturnType<typeof setInterval> | null;
  detachedAt: number | null;
  lastRearmAt: number;
  syncInFlight: boolean;
}

// ─── Manager ────────────────────────────────────────────────────────

export class SandboxTerminalSessionManager {
  private readonly sessions = new Map<string, SandboxTerminalSession>();
  /**
   * In-flight provisioning per (userId, workspaceId). Two sockets
   * racing one workspace (a reconnect during a cold open, a second
   * mounted panel) must not each run the executor ensure — the
   * second would queue behind the workspace lock for the whole
   * mirror and then open a duplicate shell. The later create()
   * joins the flight and adopts the resulting session instead.
   */
  private readonly createFlights = new Map<
    string,
    Promise<SandboxTerminalSession>
  >();
  private readonly provider: SandboxTerminalProvider;
  private readonly executor: SandboxTerminalExecutor;
  private readonly log: (message: string) => void;
  private readonly logError: (message: string) => void;
  private readonly now: () => number;
  private readonly provisionTimeoutMs: number;

  constructor(deps: SandboxTerminalSessionManagerDeps) {
    this.provider = deps.provider;
    this.executor = deps.executor;
    this.log = deps.log ?? ((m) => console.info(m));
    this.logError = deps.logError ?? ((m) => console.error(m));
    this.now = deps.now ?? Date.now;
    this.provisionTimeoutMs =
      deps.provisionTimeoutMs ?? SANDBOX_TERMINAL_PROVISION_TIMEOUT_MS;
  }

  // ─── Create ─────────────────────────────────────────────────────

  /**
   * Open a sandbox shell for a connecting socket. Three paths, in
   * order:
   *
   *   1. ADOPT — the caller names its previous session
   *      (adoptSessionId, offered when its reattach() missed the
   *      disconnect-parking race), or a parked live session exists
   *      for this (userId, workspaceId): the existing shell is
   *      handed to the new socket by rebinding its callbacks. No
   *      second provision, no duplicate PTY — a reconnect reaches
   *      the already-provisioned session and the server can emit
   *      session:ready for it immediately.
   *   2. JOIN — a provisioning for this (userId, workspaceId) is
   *      already in flight (a racing socket): join it and adopt
   *      the resulting session instead of queueing a second ensure
   *      behind the workspace lock.
   *   3. PROVISION — provisionSession(): gate-checked ensure
   *      through the executor, then the provider's PTY attach,
   *      each stage settle-bounded.
   *
   * Throws when the per-user cap is reached, when the gate is
   * closed (ensure declined), when a stage does not settle within
   * the provision bound, or when the attach itself fails — never
   * falls back to any host path.
   */
  async create(
    opts: CreateSandboxTerminalSessionOptions,
  ): Promise<SandboxTerminalSessionSnapshot> {
    // 1a. The named resume target reattach() could not take (it was
    // not parked yet when the reconnect was processed). Ownership
    // and workspace scope are re-checked; anything else is ignored.
    if (opts.adoptSessionId) {
      const named = this.assertOwner(opts.adoptSessionId, opts.userId);
      if (
        named &&
        !named.exited &&
        named.workspaceId === opts.workspaceId &&
        this.sessions.get(named.sessionId) === named
      ) {
        return this.adoptSession(named, opts, "resume target");
      }
    }

    // 1b. A parked (socketless) live session for this workspace is
    // the caller's shell coming back — hand it over rather than
    // provisioning a twin the user never asked for.
    const parked = this.findLiveSession(
      opts.userId,
      opts.workspaceId,
      (s) => s.detachedAt !== null,
    );
    if (parked) {
      return this.adoptSession(parked, opts, "parked session");
    }

    // 2. Join an in-flight provisioning for the same workspace.
    const key = `${opts.userId}\n${opts.workspaceId}`;
    const flight = this.createFlights.get(key);
    if (flight) {
      const session = await flight;
      if (!session.exited && this.sessions.get(session.sessionId) === session) {
        return this.adoptSession(session, opts, "joined in-flight create");
      }
      // The joined session died before the handoff (exit raced the
      // attach) — fall through and provision a fresh one.
      return this.create(opts);
    }

    // 3. Provision, registered as the flight for this key until it
    // settles so a racing create() joins instead of duplicating it.
    const tracked = this.provisionSession(opts).finally(() => {
      if (this.createFlights.get(key) === tracked) {
        this.createFlights.delete(key);
      }
    });
    this.createFlights.set(key, tracked);
    const session = await tracked;
    return this.toSnapshot(session);
  }

  /**
   * Hand an existing live session to a new socket: the session's
   * output/exit/log callbacks are rebound to the caller (the latest
   * socket wins — the previous socket is gone or going), any park
   * is cancelled, output buffered while parked is replayed, and
   * the idle clock restarts. The PTY stream itself is untouched:
   * output already flows through the session record's callbacks.
   */
  private adoptSession(
    session: SandboxTerminalSession,
    opts: CreateSandboxTerminalSessionOptions,
    reason: string,
  ): SandboxTerminalSessionSnapshot {
    if (session.detachTimer) clearTimeout(session.detachTimer);
    session.detachTimer = null;
    session.detachedAt = null;
    session.emitData = opts.onData;
    session.emitExit = opts.onExit;
    session.notifyDropped = opts.onOutputDropped ?? null;
    session.notifyBpWarning = opts.onBackpressureWarning ?? null;
    session.isTransportWritable = opts.isTransportWritable ?? null;
    session.onLog = opts.onLog ?? null;
    session.lastActivityAt = this.now();
    this.resetIdleTimer(session);
    this.flushPending(session);
    this.log(
      `[sandbox-terminal] adopted session=${session.sessionId} sandbox=${session.sandboxId} ` +
        `user=${opts.userId} workspace=${opts.workspaceId} (${reason})`,
    );
    return this.toSnapshot(session);
  }

  /** First live session for (userId, workspaceId) matching `where`. */
  private findLiveSession(
    userId: string,
    workspaceId: string,
    where: (s: SandboxTerminalSession) => boolean,
  ): SandboxTerminalSession | null {
    for (const session of this.sessions.values()) {
      if (session.userId !== userId) continue;
      if (session.workspaceId !== workspaceId) continue;
      if (session.exited) continue;
      if (where(session)) return session;
    }
    return null;
  }

  /**
   * The provisioning path of create(): cap check, settle-bounded
   * ensure, session record, settle-bounded PTY attach. On a
   * non-settling attach the half-created record is deleted before
   * the throw, so no phantom session consumes the per-user cap or
   * adopts a later caller; a transport that arrives late anyway is
   * killed on arrival rather than left as an orphan shell.
   */
  private async provisionSession(
    opts: CreateSandboxTerminalSessionOptions,
  ): Promise<SandboxTerminalSession> {
    const userCount = this.countByUser(opts.userId);
    if (userCount >= SANDBOX_TERMINAL_MAX_SESSIONS_PER_USER) {
      throw new Error(
        `Max concurrent sandbox terminal sessions reached (${SANDBOX_TERMINAL_MAX_SESSIONS_PER_USER} per user)`,
      );
    }

    const ensureOutcome = await settleWithin(
      this.executor.ensureSandboxForTerminal(opts.descriptor),
      this.provisionTimeoutMs,
    );
    if (!ensureOutcome.settled) {
      throw new Error(
        `sandbox terminal provisioning did not settle within ${this.provisionTimeoutMs} ms (stage: ensure)`,
      );
    }
    const ensured = ensureOutcome.value;
    if (!ensured) {
      // The gate closed between the socket gate and now (canary went
      // stale, routing flipped). Fail closed with the refusal truth.
      throw new Error("Terminal unavailable: isolation not verified");
    }

    const sessionId = randomUUID();
    const now = this.now();
    const session: SandboxTerminalSession = {
      sessionId,
      userId: opts.userId,
      projectId: opts.projectId ?? null,
      workspaceId: opts.workspaceId,
      descriptor: opts.descriptor,
      sandboxId: ensured.sandboxId,
      transportSessionId: "",
      cwd: SANDBOX_WORKSPACE_ROOT,
      shell: "bash",
      createdAt: now,
      lastActivityAt: now,
      transport: null,
      transportGeneration: 0,
      exited: false,
      exitCode: null,
      exitSettled: false,
      totalOutputDelivered: 0,
      totalOutputDropped: 0,
      emitData: opts.onData,
      emitExit: opts.onExit,
      notifyDropped: opts.onOutputDropped ?? null,
      notifyBpWarning: opts.onBackpressureWarning ?? null,
      isTransportWritable: opts.isTransportWritable ?? null,
      pendingOutput: [],
      pendingOutputBytes: 0,
      bpDroppedChunks: 0,
      bpDroppedBytes: 0,
      bpTotalDroppedChunks: 0,
      lastBpWarnAt: 0,
      bpWarnPending: false,
      flushScheduled: false,
      onLog: opts.onLog ?? null,
      idleTimer: null,
      detachTimer: null,
      syncTimer: null,
      detachedAt: null,
      lastRearmAt: now,
      syncInFlight: false,
    };
    this.sessions.set(sessionId, session);

    const connectPromise = this.provider.connectTerminal(ensured.sandboxId, {
      shell: "bash",
      cols: PTY_DEFAULT_COLS,
      rows: PTY_DEFAULT_ROWS,
      // The composed base env's HOME is /workspace (Phase 1
      // default); exec pins HOME to the sandbox home per command
      // so caches and git config stay out of the synced tree. The
      // shell gets the same pin through the contract's caller-env
      // channel (value-guarded by the provider).
      env: { HOME: SANDBOX_HOME_DIR },
    });
    const connectOutcome = await settleWithin(
      connectPromise,
      this.provisionTimeoutMs,
    );
    if (!connectOutcome.settled) {
      // Half-created session: delete the record before throwing so
      // nothing phantom holds the per-user cap. The attach promise
      // itself cannot be cancelled; if a transport ever arrives,
      // kill it on arrival instead of leaking an orphan shell.
      this.sessions.delete(sessionId);
      void connectPromise.then(
        (lateTransport) => {
          try {
            lateTransport.kill();
          } catch {
            // best effort — the sandbox's own lifetime is the ceiling
          }
        },
        () => {},
      );
      throw new Error(
        `sandbox terminal provisioning did not settle within ${this.provisionTimeoutMs} ms (stage: connect)`,
      );
    }
    try {
      this.wireTransport(session, connectOutcome.value);
    } catch (err) {
      this.sessions.delete(sessionId);
      throw err;
    }

    this.resetIdleTimer(session);
    this.startSyncTimer(session);
    this.log(
      `[sandbox-terminal] opened session=${sessionId} sandbox=${ensured.sandboxId} ` +
        `user=${opts.userId} workspace=${opts.workspaceId} transport=${session.transportSessionId}`,
    );
    return session;
  }

  // ─── Detach / resume ────────────────────────────────────────────

  /**
   * Park a session while its socket is gone (host-manager
   * semantics): output buffers up to the normal cap, the shell is
   * killed only if nobody resumes within `graceMs`, and a grace
   * expiry syncs the sandbox back before the PTY dies. Ownership is
   * enforced — returns false for an unknown session or another user.
   */
  detach(sessionId: string, userId: string, graceMs: number): boolean {
    const session = this.assertOwner(sessionId, userId);
    if (!session) return false;
    if (session.exited) {
      this.killInternal(sessionId, "detached_after_exit");
      return true;
    }
    session.detachedAt = this.now();
    session.isTransportWritable = () => false;
    session.emitData = () => {};
    session.emitExit = () => {};
    session.notifyBpWarning = null;
    if (session.detachTimer) clearTimeout(session.detachTimer);
    session.detachTimer = setTimeout(() => {
      this.killInternal(sessionId, `detached_grace_expired (${Math.round(graceMs / 1000)}s)`);
    }, graceMs);
    if (session.detachTimer.unref) session.detachTimer.unref();
    return true;
  }

  /**
   * Re-attach a parked session to a new socket. Only the owning
   * user, only while detached and alive, only from the same
   * workspace scope — knowing a sessionId never grants access
   * (host-manager semantics). The PTY's event stream is re-opened
   * through the provider's pty.connect(pid) path; a dead pid (the
   * shell exited while parked, the provider cannot reattach) is a
   * resume miss and returns null, so the caller opens a fresh PTY
   * in the same sandbox.
   */
  async reattach(
    sessionId: string,
    userId: string,
    scope: { workspaceId: string | null },
    callbacks: SandboxTerminalCallbacks,
  ): Promise<SandboxTerminalSessionSnapshot | null> {
    const session = this.assertOwner(sessionId, userId);
    if (!session || session.exited || session.detachedAt === null) return null;
    if ((session.workspaceId ?? null) !== (scope.workspaceId ?? null)) return null;
    if (!this.provider.reattachTerminal) return null;

    let transport: TerminalTransport;
    try {
      transport = await this.provider.reattachTerminal(
        session.sandboxId,
        session.transportSessionId,
        {
          shell: "bash",
          cols: PTY_DEFAULT_COLS,
          rows: PTY_DEFAULT_ROWS,
          env: { HOME: SANDBOX_HOME_DIR },
        },
      );
    } catch {
      // Resume miss — the pid is gone or the stream cannot reopen.
      return null;
    }
    // The session may have exited (or been killed) while the connect
    // was in flight; never resurrect it.
    if (session.exited || this.sessions.get(sessionId) !== session) {
      this.disconnectTransport(transport);
      return null;
    }

    if (session.detachTimer) clearTimeout(session.detachTimer);
    session.detachTimer = null;
    session.detachedAt = null;
    session.emitData = callbacks.onData;
    session.emitExit = callbacks.onExit;
    session.isTransportWritable = callbacks.isTransportWritable ?? null;
    session.notifyBpWarning = callbacks.onBackpressureWarning ?? null;
    session.onLog = callbacks.onLog ?? null;
    session.lastActivityAt = this.now();

    // Swap transports: the old stream goes inert (generation guard)
    // and is disconnected so the pid has exactly one live stream.
    const oldTransport = session.transport;
    this.wireTransport(session, transport);
    if (oldTransport && oldTransport !== transport) {
      this.disconnectTransport(oldTransport);
    }

    this.resetIdleTimer(session);
    // Replay whatever the shell printed while nobody was listening.
    this.flushPending(session);
    this.log(
      `[sandbox-terminal] resumed session=${sessionId} sandbox=${session.sandboxId} transport=${session.transportSessionId}`,
    );
    return this.toSnapshot(session);
  }

  /** True while a session is parked waiting for a resume. */
  isDetached(sessionId: string, userId: string): boolean {
    const session = this.assertOwner(sessionId, userId);
    return !!session && session.detachedAt !== null;
  }

  // ─── Input / resize ─────────────────────────────────────────────

  /**
   * Send input to a sandbox shell owned by `userId`. Enforces
   * ownership, the input size cap, and a live session — the same
   * contract as the host manager's input(). Activity re-arms the
   * sandbox clock (throttled) and resets the idle timer.
   */
  input(sessionId: string, data: string, userId: string): boolean {
    const session = this.assertOwner(sessionId, userId);
    if (!session || session.exited || !session.transport) return false;
    if (Buffer.byteLength(data, "utf8") > MAX_INPUT_SIZE) return false;

    try {
      session.transport.write(data);
    } catch {
      return false;
    }
    session.lastActivityAt = this.now();
    this.resetIdleTimer(session);
    this.maybeRearmSandboxClock(session);
    return true;
  }

  /** Resize a sandbox shell owned by `userId` (host bounds apply). */
  resize(sessionId: string, cols: number, rows: number, userId: string): boolean {
    const session = this.assertOwner(sessionId, userId);
    if (!session || session.exited || !session.transport) return false;
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return false;
    if (cols < 1 || cols > MAX_COLS || rows < 1 || rows > MAX_ROWS) return false;
    try {
      session.transport.resize(cols, rows);
    } catch {
      // resize can fail if the PTY just exited — ignore
    }
    return true;
  }

  // ─── Kill ───────────────────────────────────────────────────────

  /** Kill a session owned by `userId`. Ownership enforced. */
  kill(sessionId: string, reason: string, userId: string): boolean {
    const session = this.assertOwner(sessionId, userId);
    if (!session) return false;
    this.killInternal(sessionId, reason);
    return true;
  }

  /**
   * Internal kill — no ownership check (idle timer, grace expiry,
   * shutdown). Kills the PTY (never the sandbox), frees the session,
   * and syncs the sandbox back so the shell's work is durable. The
   * transport's own exit settlement still delivers the exit notice
   * to the last attached callbacks.
   */
  private killInternal(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.clearTimers(session);
    this.sessions.delete(sessionId);
    if (!session.exited && session.transport) {
      try {
        session.transport.kill();
      } catch {
        // PTY may have already exited — ignore
      }
    }
    session.pendingOutput = [];
    session.pendingOutputBytes = 0;
    session.flushScheduled = false;
    this.log(`[sandbox-terminal] killed session=${sessionId}: ${reason}`);
    void this.syncBack(session, `kill:${reason}`);
  }

  // ─── Query ──────────────────────────────────────────────────────

  get(sessionId: string, userId: string): SandboxTerminalSessionSnapshot | null {
    const session = this.assertOwner(sessionId, userId);
    if (!session) return null;
    return this.toSnapshot(session);
  }

  snapshot(): SandboxTerminalSessionSnapshot[] {
    return Array.from(this.sessions.values()).map((s) => this.toSnapshot(s));
  }

  snapshotByUser(userId: string): SandboxTerminalSessionSnapshot[] {
    return this.snapshot().filter((s) => s.userId === userId);
  }

  countByUser(userId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.exited) count++;
    }
    return count;
  }

  get size(): number {
    return this.sessions.size;
  }

  /** Kill every session (server shutdown). Sync-back is best-effort. */
  shutdown(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.killInternal(sessionId, "server_shutdown");
    }
  }

  // ─── Transport wiring ───────────────────────────────────────────

  /**
   * Bind a transport to a session: output flows through the chunk
   * cap + backpressure wrapper, exit settles the session exactly
   * once. Every swap increments the generation — a stale transport's
   * callbacks go inert, so a disconnected stream can never deliver
   * output or a second exit after a reattach.
   */
  private wireTransport(
    session: SandboxTerminalSession,
    transport: TerminalTransport,
  ): void {
    session.transport = transport;
    session.transportSessionId = transport.sessionId;
    const generation = ++session.transportGeneration;

    transport.onOutput((data) => {
      if (generation !== session.transportGeneration) return;
      this.handleOutput(session, data);
    });
    transport.onExit(({ exitCode }) => {
      if (generation !== session.transportGeneration) return;
      void this.settleExit(session, exitCode);
    });
  }

  private disconnectTransport(transport: TerminalTransport): void {
    const maybe = transport as TerminalTransport & {
      disconnect?: () => void;
    };
    try {
      maybe.disconnect?.();
    } catch {
      // best effort — the generation guard already made it inert
    }
  }

  /**
   * Settle a PTY exit exactly once: mark the session, free it, tell
   * the attached socket (with the honest sandboxEnded flag), and
   * sync back when the sandbox itself survived.
   */
  private async settleExit(
    session: SandboxTerminalSession,
    exitCode: number | null,
  ): Promise<void> {
    if (session.exitSettled) return;
    session.exitSettled = true;
    session.exited = true;
    session.exitCode = exitCode;
    this.clearTimers(session);
    if (this.sessions.get(session.sessionId) === session) {
      this.sessions.delete(session.sessionId);
    }
    session.pendingOutput = [];
    session.pendingOutputBytes = 0;
    session.flushScheduled = false;

    // Did the sandbox itself die with the shell? The provider's get
    // verifies liveness against E2B (and forgets a verified-dead
    // sandbox), so null here means the microVM is gone — the 1-hour
    // cap or a provider-side loss. A probe error reads as gone: the
    // shell is over either way, and Reconnect's ensure recreates
    // from the volume's last synced state.
    let sandboxEnded = false;
    try {
      sandboxEnded = (await this.provider.get(session.sandboxId)) === null;
    } catch {
      sandboxEnded = true;
    }

    session.emitExit({
      sessionId: session.sessionId,
      exitCode,
      ...(sandboxEnded ? { sandboxEnded: true } : {}),
    });
    this.log(
      `[sandbox-terminal] session=${session.sessionId} exited code=${exitCode ?? "null"} sandboxEnded=${sandboxEnded}`,
    );
    if (!sandboxEnded) {
      void this.syncBack(session, "exit");
    }
  }

  // ─── Output: chunk cap + backpressure (host-manager semantics) ──

  private handleOutput(session: SandboxTerminalSession, data: string): void {
    if (session.exited) return;
    const chunkBytes = Buffer.byteLength(data, "utf8");

    // Layer 1: per-chunk cap.
    if (chunkBytes > MAX_OUTPUT_CHUNK) {
      session.totalOutputDropped += chunkBytes;
      session.notifyDropped?.({ sessionId: session.sessionId, dropped: chunkBytes });
      return;
    }

    // Layer 2: backpressure — flush what is parked, then deliver or
    // buffer up to the pending cap; beyond it, drop with a warning.
    this.flushPending(session);
    const writable = session.isTransportWritable?.() ?? true;
    if (writable && session.pendingOutput.length === 0) {
      session.totalOutputDelivered += chunkBytes;
      session.emitData(data);
      return;
    }
    if (session.pendingOutputBytes + chunkBytes <= MAX_PENDING_OUTPUT_BYTES) {
      session.pendingOutput.push(data);
      session.pendingOutputBytes += chunkBytes;
      this.scheduleFlush(session);
      return;
    }
    session.totalOutputDropped += chunkBytes;
    session.bpTotalDroppedChunks += 1;
    session.bpDroppedChunks += 1;
    session.bpDroppedBytes += chunkBytes;
    session.notifyDropped?.({ sessionId: session.sessionId, dropped: chunkBytes });
    session.bpWarnPending = true;
  }

  private flushPending(session: SandboxTerminalSession): void {
    if (session.pendingOutput.length === 0 && !session.bpWarnPending) return;
    const writable = session.isTransportWritable?.() ?? true;
    if (!writable) return;

    if (session.bpWarnPending) {
      const now = this.now();
      if (session.lastBpWarnAt === 0 || now - session.lastBpWarnAt >= OUTPUT_DROP_WARN_INTERVAL_MS) {
        if (session.bpDroppedChunks > 0 || session.bpDroppedBytes > 0) {
          session.notifyBpWarning?.({
            sessionId: session.sessionId,
            droppedChunks: session.bpDroppedChunks,
            droppedBytes: session.bpDroppedBytes,
          });
        }
        session.bpDroppedChunks = 0;
        session.bpDroppedBytes = 0;
        session.bpWarnPending = false;
        session.lastBpWarnAt = now;
      }
    }

    while (session.pendingOutput.length > 0) {
      const chunk = session.pendingOutput.shift()!;
      const chunkBytes = Buffer.byteLength(chunk, "utf8");
      session.pendingOutputBytes -= chunkBytes;
      session.totalOutputDelivered += chunkBytes;
      session.emitData(chunk);
    }
  }

  private scheduleFlush(session: SandboxTerminalSession): void {
    if (session.flushScheduled) return;
    session.flushScheduled = true;
    setImmediate(() => {
      session.flushScheduled = false;
      if (this.sessions.get(session.sessionId) === session && !session.exited) {
        this.flushPending(session);
      }
    });
  }

  /** Public flush — flush a session's parked output to its socket. */
  flushPendingOutput(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) this.flushPending(session);
  }

  // ─── Sandbox clock re-arm + sync-back ───────────────────────────

  /**
   * PTY activity keeps the sandbox alive: re-arm its lifetime clock
   * at most once a minute (the provider clamps the value to the
   * plan cap), copying execute()'s pattern. Best effort — a failed
   * extension never breaks input; a truly dead sandbox surfaces at
   * the PTY's exit instead.
   */
  private maybeRearmSandboxClock(session: SandboxTerminalSession): void {
    if (!this.provider.extendTimeout) return;
    const now = this.now();
    if (now - session.lastRearmAt < SANDBOX_TERMINAL_REARM_INTERVAL_MS) return;
    session.lastRearmAt = now;
    void this.provider
      .extendTimeout(session.sandboxId, SANDBOX_TERMINAL_REARM_TIMEOUT_MS)
      .catch(() => {});
  }

  private startSyncTimer(session: SandboxTerminalSession): void {
    if (session.syncTimer) clearInterval(session.syncTimer);
    session.syncTimer = setInterval(() => {
      // Spec §2.5: the periodic trigger runs while a session is
      // attached. A parked session syncs on grace expiry instead.
      if (session.exited || session.detachedAt !== null) return;
      void this.syncBack(session, "periodic");
    }, SANDBOX_TERMINAL_SYNC_INTERVAL_MS);
    if (session.syncTimer.unref) session.syncTimer.unref();
  }

  /**
   * One sync-back for a session, deduplicated while in flight.
   * Failures are LOUD: logged with the full reason and surfaced on
   * the session's onLog channel (the panel's Logs tab) — a shell's
   * work must never silently fail to become durable.
   */
  private async syncBack(
    session: SandboxTerminalSession,
    reason: string,
  ): Promise<void> {
    if (session.syncInFlight) return;
    session.syncInFlight = true;
    try {
      await this.executor.syncBackForTerminal(session.descriptor);
      this.log(
        `[sandbox-terminal] sync-back ok session=${session.sessionId} workspace=${session.workspaceId} reason=${reason}`,
      );
    } catch (err) {
      const message =
        `[sandbox-terminal] SYNC-BACK FAILED session=${session.sessionId} ` +
        `workspace=${session.workspaceId} reason=${reason}: ` +
        (err instanceof Error ? err.message : String(err));
      this.logError(message);
      session.onLog?.(message);
    } finally {
      session.syncInFlight = false;
    }
  }

  // ─── Ownership + timers ─────────────────────────────────────────

  private assertOwner(
    sessionId: string,
    userId: string,
  ): SandboxTerminalSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.userId !== userId) return null;
    return session;
  }

  private resetIdleTimer(session: SandboxTerminalSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      this.killInternal(session.sessionId, "idle_timeout");
    }, SANDBOX_TERMINAL_IDLE_TIMEOUT_MS);
    if (session.idleTimer.unref) session.idleTimer.unref();
  }

  private clearTimers(session: SandboxTerminalSession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    if (session.detachTimer) {
      clearTimeout(session.detachTimer);
      session.detachTimer = null;
    }
    if (session.syncTimer) {
      clearInterval(session.syncTimer);
      session.syncTimer = null;
    }
  }

  private toSnapshot(
    session: SandboxTerminalSession,
  ): SandboxTerminalSessionSnapshot {
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      projectId: session.projectId,
      workspaceId: session.workspaceId,
      cwd: session.cwd,
      shell: session.shell,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      exited: session.exited,
      exitCode: session.exitCode,
    };
  }
}
