/**
 * PtySessionManager — canonical PTY session lifecycle for terminal-server.
 *
 * Extracts the inline `Map<string, Session>` from server.ts into a proper
 * session manager with:
 *   - Full session metadata (sessionId, userId, projectId, workspaceId, cwd, shell, timestamps)
 *   - Max concurrent PTYs per user
 *   - Idle timeout sweeper
 *   - Absolute session lifetime enforcement
 *   - Session snapshot/status (no ptyProcess leak in the public shape)
 *   - PTY stdout/stderr streamed as runtime events via callbacks
 *
 * Architecture:
 *   Socket.IO connection → PtySessionManager.create() → node-pty / Docker
 *   PtySessionManager owns the session Map and all lifecycle enforcement.
 *   server.ts delegates to it — no inline session state.
 */

import * as pty from "node-pty";
import { randomUUID } from "crypto";
import { resolve, relative, isAbsolute } from "path";
import { realpathSync } from "fs";
import { createDockerSession } from "./docker-manager.js";

// ─── Security constants ───────────────────────────────────────────

/** Max single input payload size (bytes). Prevents memory abuse via paste. */
export const MAX_INPUT_SIZE = 64 * 1024; // 64 KiB

/** Max terminal columns. */
export const MAX_COLS = 500;

/** Max terminal rows. */
export const MAX_ROWS = 200;

/**
 * Max single output chunk size (bytes). Individual PTY stdout/stderr
 * chunks larger than this are dropped to prevent memory spikes from
 * a single massive write (e.g. `cat /dev/urandom`).
 *
 * This is a PER-CHUNK cap, NOT a cumulative limit. A long-running
 * interactive session can emit unlimited total output over time —
 * only genuinely oversized individual chunks are bounded.
 */
export const MAX_OUTPUT_CHUNK = 256 * 1024; // 256 KiB per chunk

/**
 * Max pending output bytes buffered per session when the transport
 * (Socket.IO / Engine.IO) cannot keep up with PTY output.
 *
 * This is the BACKPRESSURE cap. When a slow or disconnected client
 * causes the transport to back up, the manager buffers output up to
 * this limit. Once exceeded, new output is DROPPED (not queued) to
 * prevent unbounded memory growth toward OOM.
 *
 * This works alongside the per-chunk cap (MAX_OUTPUT_CHUNK):
 *   - MAX_OUTPUT_CHUNK: bounds a single chunk (lifetime-output bug)
 *   - MAX_PENDING_OUTPUT_BYTES: bounds the queued output (backpressure bug)
 */
export const MAX_PENDING_OUTPUT_BYTES = 1024 * 1024; // 1 MiB per session

/**
 * Minimum interval between user-visible backpressure drop warnings.
 * Prevents warning spam when output is continuously dropped.
 */
export const OUTPUT_DROP_WARN_INTERVAL_MS = 5_000;

/** Max cwd path length. */
const MAX_CWD_LENGTH = 4096;

// ─── PTY environment allowlist ────────────────────────────────────

/**
 * Allowlist of environment variables that are SAFE to pass into a
 * user-controlled PTY. These are standard shell/runtime variables
 * that contain no secrets.
 *
 * This is an ALLOWLIST, not a denylist. Any environment variable NOT
 * in this list (or in the LiTT_* prefix set below) is stripped from
 * the PTY environment. This ensures that future server secrets
 * added to the terminal-server's environment cannot accidentally
 * leak into remote shells.
 *
 * Variables are matched case-sensitively on POSIX and
 * case-insensitively on Windows (Windows env vars are case-insensitive).
 */
const SAFE_ENV_ALLOWLIST: readonly string[] = [
  // Shell / terminal basics
  "TERM",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_TIME",
  "LC_COLLATE",
  "LC_NUMERIC",
  "LC_MONETARY",
  // User identity (not secrets — just usernames)
  "USER",
  "USERNAME",
  "LOGNAME",
  // Home + temp directories
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  // Path / executable search
  "PATH",
  // Windows-specific shell/runtime
  "SystemRoot",
  "COMSPEC",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMDATA",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "PSModulePath",
  // Color / terminal cosmetics
  "COLORTERM",
  "FORCE_COLOR",
  "NO_COLOR",
  // Editor (not a secret — user preference)
  "EDITOR",
  "VISUAL",
  // Pager (not a secret — user preference)
  "PAGER",
  "LESS",
  // Timezone (not a secret)
  "TZ",
];

/**
 * LiTT workspace variables that are explicitly injected into the PTY
 * environment. These are NOT secrets — they identify the workspace
 * context for the shell session.
 */
const LITT_ENV_PREFIX = "LITTREE_";

/**
 * Build a safe PTY environment from the server's process.env using
 * an allowlist. Server secrets (auth keys, database URLs, API keys,
 * Railway-provided secrets, etc.) are NEVER passed into the PTY.
 *
 * The returned environment contains:
 *   - Only variables in SAFE_ENV_ALLOWLIST (case-insensitive on Windows)
 *   - Explicitly injected LiTT workspace variables (LITTREE_*)
 *   - TERM forced to "xterm-256color"
 *
 * It does NOT contain:
 *   - process.env wholesale (no ...process.env spread)
 *   - Any secret/key/token/password/credential variable
 *   - RAILWAY_* variables
 *   - TERMINAL_AUTH_SECRET, TERMINAL_INTERNAL_SERVICE_KEY
 *   - DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   - OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY
 *   - Any future server-only secret
 */
export function buildPtyEnv(
  serverEnv: NodeJS.ProcessEnv = process.env,
  littVars: {
    userId: string;
    sessionId: string;
    workspaceId?: string | null;
    projectId?: string | null;
  },
): Record<string, string> {
  const isWindows = process.platform === "win32";
  const allowSet = new Set(
    isWindows
      ? SAFE_ENV_ALLOWLIST.map((v) => v.toUpperCase())
      : SAFE_ENV_ALLOWLIST,
  );

  const safeEnv: Record<string, string> = {};

  // Copy only allowlisted variables from the server environment
  for (const [key, value] of Object.entries(serverEnv)) {
    if (value === undefined) continue;
    const matchKey = isWindows ? key.toUpperCase() : key;
    if (allowSet.has(matchKey)) {
      safeEnv[key] = value;
    }
  }

  // Force TERM for consistent terminal emulation
  safeEnv.TERM = "xterm-256color";

  // Inject LiTT workspace context (NOT secrets)
  safeEnv[`${LITT_ENV_PREFIX}USER_ID`] = littVars.userId;
  safeEnv[`${LITT_ENV_PREFIX}SESSION_ID`] = littVars.sessionId;
  safeEnv[`${LITT_ENV_PREFIX}WORKSPACE_ID`] = littVars.workspaceId ?? "";
  safeEnv[`${LITT_ENV_PREFIX}PROJECT_ID`] = littVars.projectId ?? "";

  return safeEnv;
}

/**
 * Known server secrets that must NEVER appear in a PTY environment.
 * This is a defense-in-depth check — the allowlist should already
 * prevent these from leaking, but this list is used in tests and
 * runtime assertions to PROVE they are absent.
 */
export const KNOWN_SECRETS_TO_REJECT: readonly string[] = [
  "TERMINAL_AUTH_SECRET",
  "TERMINAL_INTERNAL_SERVICE_KEY",
  "DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "STRIPE_SECRET_KEY",
  "CLERK_SECRET_KEY",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "R2_SECRET_ACCESS_KEY",
  "R2_ACCESS_KEY_ID",
  "REDIS_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

// ─── Workspace boundary validation ────────────────────────────────

/**
 * Validate that `cwd` is safely contained within `allowedRoot`.
 *
 * Protections:
 *   - Rejects empty/overlong cwd
 *   - Resolves `..` and absolute-path escape via `resolve(root, cwd)` + `relative()`
 *   - Resolves symlink escape via `realpathSync()` on both root and target
 *   - Returns the canonicalized absolute path on success
 *   - Throws on any escape attempt
 *
 * This is the ONE function that enforces filesystem boundary for PTY sessions.
 * Every session create must pass through it.
 */
export function validateWorkspacePath(allowedRoot: string, cwd: string): string {
  if (!cwd || cwd.length === 0) {
    throw new Error("Invalid cwd — empty path");
  }
  if (cwd.length > MAX_CWD_LENGTH) {
    throw new Error("Invalid cwd — path too long");
  }

  // Step 1: lexical resolution — catch `..` and absolute-path escape
  const lexResolved = resolve(allowedRoot, cwd);
  const lexRelative = relative(allowedRoot, lexResolved);
  if (lexRelative.startsWith("..") || isAbsolute(lexRelative)) {
    throw new Error("Invalid cwd — escapes workspace root");
  }

  // Step 2: symlink resolution — catch symlink escape
  // realpathSync throws if the path doesn't exist, which is fine —
  // we want the cwd to exist before spawning a PTY there.
  let realRoot: string;
  let realTarget: string;
  try {
    realRoot = realpathSync(allowedRoot);
    realTarget = realpathSync(lexResolved);
  } catch {
    // If the root doesn't exist, that's a server config error.
    // If the target doesn't exist, reject — don't spawn a PTY in a
    // non-existent directory.
    throw new Error("Invalid cwd — path does not exist");
  }

  const realRelative = relative(realRoot, realTarget);
  if (realRelative.startsWith("..") || isAbsolute(realRelative)) {
    throw new Error("Invalid cwd — symlink escape detected");
  }

  return realTarget;
}

// ─── Types ────────────────────────────────────────────────────────

/** Abstraction over node-pty and Docker sessions — only the operations we need. */
export interface PtyProcessHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

/** Full internal session record (never exposed to clients). */
interface PtySession {
  sessionId: string;
  userId: string;
  projectId: string | null;
  workspaceId: string | null;
  cwd: string;
  shell: string;
  createdAt: number;
  lastActivityAt: number;
  handle: PtyProcessHandle;
  exited: boolean;
  exitCode: number | null;
  /** Total output bytes delivered to onData (for observability — NOT a cap). */
  totalOutputDelivered: number;
  /** Total output bytes dropped (oversized chunks + backpressure) — for observability. */
  totalOutputDropped: number;
  /** Timer for idle timeout — cleared on activity, reset on input. */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Timer for absolute lifetime — fires once, kills the session. */
  lifetimeTimer: ReturnType<typeof setTimeout> | null;

  // ─── Backpressure fields ───────────────────────────────────────
  /** Original onData callback — called when output is actually sent to the transport. */
  emitData: (data: string) => void;
  /** Called when a chunk is dropped (oversized or backpressure). */
  notifyDropped: ((info: { sessionId: string; dropped: number }) => void) | null;
  /** Called (throttled) when backpressure drops have occurred, on flush. */
  notifyBpWarning: ((info: { sessionId: string; droppedChunks: number; droppedBytes: number }) => void) | null;
  /** Predicate: is the transport ready to receive output? null = always writable. */
  isTransportWritable: (() => boolean) | null;
  /** Bounded pending output buffer — chunks waiting for the transport to become writable. */
  pendingOutput: string[];
  /** Total bytes currently in pendingOutput. */
  pendingOutputBytes: number;
  /** Max bytes allowed in pendingOutput before dropping. */
  maxPendingOutputBytes: number;
  /** Chunks dropped due to backpressure since last warning. */
  bpDroppedChunks: number;
  /** Bytes dropped due to backpressure since last warning. */
  bpDroppedBytes: number;
  /** Total chunks dropped due to backpressure (lifetime). */
  bpTotalDroppedChunks: number;
  /** Timestamp of last backpressure drop warning. */
  lastBpWarnAt: number;
  /** Whether a warning is pending (should be emitted on next successful flush). */
  bpWarnPending: boolean;
  /** Whether a setImmediate flush retry is already scheduled. */
  flushScheduled: boolean;
}

/** Public session snapshot — safe to send to clients (no ptyProcess handle). */
export interface PtySessionSnapshot {
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

export interface CreateSessionOptions {
  userId: string;
  projectId?: string | null;
  workspaceId?: string | null;
  cwd: string;
  /** Server-side resolved workspace root — cwd must be within this. */
  allowedRoot: string;
  useDocker: boolean;
  /** Streamed on every PTY stdout/stderr chunk. */
  onData: (data: string) => void;
  /** Called when the PTY process exits (natural or killed). */
  onExit: (info: { sessionId: string; exitCode: number | null; signal?: number }) => void;
  /** Called when an output chunk is dropped (oversized or backpressure). Optional. */
  onOutputDropped?: (info: { sessionId: string; dropped: number }) => void;
  /**
   * Predicate: is the transport ready to receive output right now?
   * If not provided, the transport is always treated as writable (no
   * backpressure protection — backward compatible with existing tests).
   * When provided and returns false, output is buffered up to
   * maxPendingOutputBytes, then dropped.
   */
  isTransportWritable?: () => boolean;
  /** Max pending output bytes before dropping. Default: MAX_PENDING_OUTPUT_BYTES. */
  maxPendingOutputBytes?: number;
  /**
   * Called (throttled) when output has been dropped due to backpressure,
   * at the moment the transport recovers and pending output is flushed.
   * This is the user-visible warning callback — it fires at most once
   * per OUTPUT_DROP_WARN_INTERVAL_MS.
   */
  onBackpressureWarning?: (info: { sessionId: string; droppedChunks: number; droppedBytes: number }) => void;
}

/**
 * Factory that spawns a PTY process. Injected for testing; defaults to
 * the real node-pty spawn + Docker session creator.
 */
export interface PtySpawnFactory {
  spawnHost(opts: {
    shell: string;
    cwd: string;
    env: Record<string, string>;
    onData: (data: string) => void;
    onExit: (info: { exitCode: number | null; signal?: number }) => void;
  }): PtyProcessHandle;
  spawnDocker(opts: {
    userId: string;
    sessionId: string;
    cwd: string;
    onData: (data: string) => void;
    onExit: (info: { exitCode: number | null; signal?: number }) => void;
  }): PtyProcessHandle;
}

export interface PtySessionLimits {
  /** Max concurrent PTY sessions per user. */
  maxConcurrentPerUser: number;
  /** Idle timeout in ms — session killed after this long with no input. */
  idleTimeoutMs: number;
  /** Absolute session lifetime in ms — session killed after this long regardless of activity. */
  absoluteLifetimeMs: number;
}

export const DEFAULT_LIMITS: PtySessionLimits = {
  maxConcurrentPerUser: 5,
  idleTimeoutMs: 30 * 60 * 1000,      // 30 minutes
  absoluteLifetimeMs: 8 * 60 * 60 * 1000, // 8 hours
};

// ─── Manager ──────────────────────────────────────────────────────

export class PtySessionManager {
  private sessions = new Map<string, PtySession>();
  private readonly limits: PtySessionLimits;
  private readonly spawnFactory: PtySpawnFactory;
  private sweeperTimer: ReturnType<typeof setInterval> | null = null;

  constructor(limits: Partial<PtySessionLimits> = {}, spawnFactory?: PtySpawnFactory) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.spawnFactory = spawnFactory ?? createDefaultSpawnFactory();
  }

  // ─── Create ─────────────────────────────────────────────────────

  /**
   * Create a new PTY session.
   *
   * Enforces:
   *   - Max concurrent PTYs per user (rejects if exceeded)
   *   - Spawns via node-pty (host) or createDockerSession (Docker mode)
   *   - Wires onData/onExit callbacks
   *   - Starts idle + lifetime timers
   *
   * Returns the session snapshot on success.
   * Throws if the PTY fails to spawn or limits are exceeded.
   */
  create(opts: CreateSessionOptions): PtySessionSnapshot {
    // ─── Workspace boundary enforcement ───────────────────────────
    // Validate cwd is within allowedRoot BEFORE spawning anything.
    // This is the filesystem security boundary — no PTY may run
    // outside the user's authorized workspace.
    const safeCwd = validateWorkspacePath(opts.allowedRoot, opts.cwd);

    // ─── Max concurrent enforcement ────────────────────────────────
    const userCount = this.countByUser(opts.userId);
    if (userCount >= this.limits.maxConcurrentPerUser) {
      throw new Error(
        `Max concurrent PTY sessions reached (${this.limits.maxConcurrentPerUser} per user)`,
      );
    }

    const sessionId = randomUUID();
    const shell = process.platform === "win32"
      ? "powershell.exe"
      : process.env.SHELL || "bash";
    const now = Date.now();

    // ─── Output chunk cap + backpressure protection ───────────────
    // Wrap onData with TWO layers of protection:
    //
    // 1. PER-CHUNK CAP (MAX_OUTPUT_CHUNK): Drops individual chunks
    //    larger than 256 KiB. Prevents memory spikes from a single
    //    massive write (e.g. `cat /dev/urandom`). This is the
    //    lifetime-output bug fix.
    //
    // 2. BACKPRESSURE CAP (MAX_PENDING_OUTPUT_BYTES): When the
    //    transport (Socket.IO) cannot keep up — slow client,
    //    disconnected client, or Engine.IO sendBuffer growing —
    //    output is buffered up to maxPendingOutputBytes. Once
    //    exceeded, new output is DROPPED to prevent unbounded memory
    //    growth toward OOM. This is the backpressure bug fix.
    //
    //    When the transport becomes writable again, buffered output
    //    is flushed. If any output was dropped, a single throttled
    //    warning is emitted via onBackpressureWarning.
    //
    // The cap is per-chunk + per-pending-buffer, not cumulative —
    // a long-running session with a healthy consumer can emit
    // unlimited total output over time.
    const onOutputDropped = opts.onOutputDropped;
    const wrappedOnData = (data: string): void => {
      const session = this.sessions.get(sessionId);
      if (!session || session.exited) return;

      const chunkBytes = Buffer.byteLength(data, "utf8");

      // ─── Layer 1: Per-chunk size cap ────────────────────────────
      if (chunkBytes > MAX_OUTPUT_CHUNK) {
        session.totalOutputDropped += chunkBytes;
        onOutputDropped?.({ sessionId, dropped: chunkBytes });
        return;
      }

      // ─── Layer 2: Backpressure protection ──────────────────────
      // Try to flush any previously buffered output first.
      this.flushPending(session);

      const writable = session.isTransportWritable?.() ?? true;

      // Fast path: transport is writable and nothing is pending → direct emit.
      if (writable && session.pendingOutput.length === 0) {
        session.totalOutputDelivered += chunkBytes;
        opts.onData(data);
        return;
      }

      // Transport not writable (or pending output exists) → buffer up to cap.
      if (session.pendingOutputBytes + chunkBytes <= session.maxPendingOutputBytes) {
        session.pendingOutput.push(data);
        session.pendingOutputBytes += chunkBytes;
        // Schedule a flush retry on the next tick — the transport
        // might become writable before the next PTY output arrives.
        this.scheduleFlush(session);
        return;
      }

      // Over cap → DROP. Do not queue — this is the OOM prevention.
      session.totalOutputDropped += chunkBytes;
      session.bpTotalDroppedChunks += 1;
      session.bpDroppedChunks += 1;
      session.bpDroppedBytes += chunkBytes;
      onOutputDropped?.({ sessionId, dropped: chunkBytes });

      // Mark warning pending — emitted (throttled) on next successful flush.
      session.bpWarnPending = true;
    };

    // ─── Create session record BEFORE spawning ─────────────────────
    // The session must be in the map before the PTY is spawned so that
    // the wrappedOnData / onExit callbacks (which look up the session by
    // ID) can find it. Without this, early PTY output or an immediate
    // exit would be silently dropped — the callbacks would see no session
    // and return early. We use a placeholder handle that is swapped for
    // the real one after a successful spawn.
    const placeholderHandle: PtyProcessHandle = {
      write: () => {},
      resize: () => {},
      kill: () => {},
    };

    const session: PtySession = {
      sessionId,
      userId: opts.userId,
      projectId: opts.projectId ?? null,
      workspaceId: opts.workspaceId ?? null,
      cwd: safeCwd,
      shell: process.platform === "win32" ? "powershell" : (process.env.SHELL || "bash"),
      createdAt: now,
      lastActivityAt: now,
      handle: placeholderHandle,
      exited: false,
      exitCode: null,
      totalOutputDelivered: 0,
      totalOutputDropped: 0,
      idleTimer: null,
      lifetimeTimer: null,
      // Backpressure fields
      emitData: opts.onData,
      notifyDropped: onOutputDropped ?? null,
      notifyBpWarning: opts.onBackpressureWarning ?? null,
      isTransportWritable: opts.isTransportWritable ?? null,
      pendingOutput: [],
      pendingOutputBytes: 0,
      maxPendingOutputBytes: opts.maxPendingOutputBytes ?? MAX_PENDING_OUTPUT_BYTES,
      bpDroppedChunks: 0,
      bpDroppedBytes: 0,
      bpTotalDroppedChunks: 0,
      lastBpWarnAt: 0,
      bpWarnPending: false,
      flushScheduled: false,
    };

    this.sessions.set(sessionId, session);

    // ─── Spawn PTY via factory ────────────────────────────────────
    let handle: PtyProcessHandle;

    try {
      if (opts.useDocker) {
        handle = this.spawnFactory.spawnDocker({
          userId: opts.userId,
          sessionId,
          cwd: safeCwd,
          onData: wrappedOnData,
          onExit: ({ exitCode, signal }) => {
            this.markExited(sessionId, exitCode);
            opts.onExit({ sessionId, exitCode, signal });
          },
        });
      } else {
        handle = this.spawnFactory.spawnHost({
          shell,
          cwd: safeCwd,
          env: buildPtyEnv(process.env, {
            userId: opts.userId,
            sessionId,
            workspaceId: opts.workspaceId,
            projectId: opts.projectId,
          }),
          onData: wrappedOnData,
          onExit: ({ exitCode, signal }) => {
            this.markExited(sessionId, exitCode);
            opts.onExit({ sessionId, exitCode, signal });
          },
        });
      }
    } catch (err) {
      // Spawn failed — clean up the placeholder session so it doesn't
      // leak as a ghost entry with a no-op handle.
      this.clearTimers(session);
      this.sessions.delete(sessionId);
      const message = err instanceof Error ? err.message : "Failed to start PTY";
      throw new Error(message);
    }

    // ─── Swap placeholder handle for the real one ──────────────────
    session.handle = handle;

    // ─── Start timers ─────────────────────────────────────────────
    this.resetIdleTimer(sessionId);
    session.lifetimeTimer = setTimeout(() => {
      this.killInternal(sessionId, "absolute_lifetime_exceeded");
    }, this.limits.absoluteLifetimeMs);

    return this.toSnapshot(session);
  }

  // ─── Session ownership ──────────────────────────────────────────

  /**
   * Verify that `userId` owns session `sessionId`.
   * Returns the session if owned, null otherwise.
   * Knowing a sessionId must NEVER grant access — the caller must
   * also be the session's owner.
   */
  private assertOwner(sessionId: string, userId: string): PtySession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.userId !== userId) return null;
    return session;
  }

  // ─── Input ──────────────────────────────────────────────────────

  /**
   * Send input to a PTY session owned by `userId`.
   * Enforces:
   *   - Session must exist and be owned by userId
   *   - Input payload size ≤ MAX_INPUT_SIZE
   *   - Session must not be exited
   * Updates lastActivityAt and resets the idle timer.
   * Returns true if input was written, false if rejected (wrong owner,
   * not found, exited, or oversized).
   */
  input(sessionId: string, data: string, userId: string): boolean {
    const session = this.assertOwner(sessionId, userId);
    if (!session || session.exited) return false;

    // ─── Input size limit ─────────────────────────────────────────
    if (Buffer.byteLength(data, "utf8") > MAX_INPUT_SIZE) {
      return false;
    }

    session.handle.write(data);
    session.lastActivityAt = Date.now();
    this.resetIdleTimer(sessionId);
    return true;
  }

  // ─── Resize ─────────────────────────────────────────────────────

  /**
   * Resize a PTY session owned by `userId`.
   * Enforces:
   *   - Session must exist and be owned by userId
   *   - cols ∈ [1, MAX_COLS], rows ∈ [1, MAX_ROWS]
   *   - Session must not be exited
   * Returns true if resize succeeded, false if rejected.
   */
  resize(sessionId: string, cols: number, rows: number, userId: string): boolean {
    const session = this.assertOwner(sessionId, userId);
    if (!session || session.exited) return false;

    // ─── Resize bounds ────────────────────────────────────────────
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return false;
    if (cols < 1 || cols > MAX_COLS || rows < 1 || rows > MAX_ROWS) return false;

    try {
      session.handle.resize(cols, rows);
    } catch {
      // resize can fail if the process just exited — ignore
    }
    return true;
  }

  // ─── Backpressure: flush pending output ──────────────────────────

  /**
   * Flush buffered pending output to the transport, if the transport
   * is currently writable. Called opportunistically on each new PTY
   * output chunk and via scheduleFlush.
   *
   * If output was dropped while the transport was backed up, emits a
   * single throttled warning via onBackpressureWarning before flushing.
   */
  private flushPending(session: PtySession): void {
    if (session.pendingOutput.length === 0 && !session.bpWarnPending) return;

    const writable = session.isTransportWritable?.() ?? true;
    if (!writable) return;

    // Emit throttled warning first (if drops occurred since last warning)
    if (session.bpWarnPending) {
      const now = Date.now();
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
      // If throttle interval hasn't elapsed, keep bpWarnPending true
      // and keep accumulating drops for the next flush attempt.
    }

    // Flush all buffered chunks to the transport
    while (session.pendingOutput.length > 0) {
      const chunk = session.pendingOutput.shift()!;
      const chunkBytes = Buffer.byteLength(chunk, "utf8");
      session.pendingOutputBytes -= chunkBytes;
      session.totalOutputDelivered += chunkBytes;
      session.emitData(chunk);
    }
  }

  /**
   * Schedule a flush retry on the next event loop tick. This handles
   * the case where the PTY stops emitting but the transport becomes
   * writable — the pending buffer gets flushed without waiting for
   * the next PTY output chunk.
   *
   * At most one retry is scheduled at a time (flushScheduled guard).
   */
  private scheduleFlush(session: PtySession): void {
    if (session.flushScheduled) return;
    session.flushScheduled = true;
    setImmediate(() => {
      session.flushScheduled = false;
      const s = this.sessions.get(session.sessionId);
      if (s && !s.exited) {
        this.flushPending(s);
      }
    });
  }

  /**
   * Public flush — flush pending output for a session. Useful for
   * testing and for server.ts to call on transport drain events.
   * No ownership check needed — it only flushes the session's own
   * buffer to its own onData callback.
   */
  flushPendingOutput(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) this.flushPending(session);
  }

  // ─── Kill ───────────────────────────────────────────────────────

  /**
   * Kill a PTY session owned by `userId`.
   * Enforces session ownership — knowing a sessionId is not enough.
   * Returns true if killed, false if not found or wrong owner.
   */
  kill(sessionId: string, reason: string, userId: string): boolean {
    const session = this.assertOwner(sessionId, userId);
    if (!session) return false;
    this.killInternal(sessionId, reason);
    return true;
  }

  /**
   * Internal kill — no ownership check. Used by the sweeper,
   * lifetime timer, and shutdown. Never expose to socket handlers.
   */
  private killInternal(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (!session.exited) {
      try {
        session.handle.kill();
      } catch {
        // process may have already exited — ignore
      }
    }

    // Free pending output buffer memory
    session.pendingOutput = [];
    session.pendingOutputBytes = 0;
    session.flushScheduled = false;

    this.clearTimers(session);
    this.sessions.delete(sessionId);
    console.log(`[PtySessionManager] Killed session ${sessionId}: ${reason}`);
  }

  // ─── Query ──────────────────────────────────────────────────────

  /**
   * Get a session snapshot by ID, verifying ownership.
   * Returns null if not found or not owned by userId.
   * Knowing a sessionId must NEVER grant access to another user's session.
   */
  get(sessionId: string, userId: string): PtySessionSnapshot | null {
    const session = this.assertOwner(sessionId, userId);
    if (!session) return null;
    return this.toSnapshot(session);
  }

  /**
   * Get output stats for a session (for testing/observability).
   * Verifies ownership. Returns null if not found or wrong owner.
   * Includes backpressure drop counts and pending buffer state.
   */
  getOutputStats(sessionId: string, userId: string): {
    delivered: number;
    dropped: number;
    bpDroppedChunks: number;
    pendingBytes: number;
    pendingChunks: number;
  } | null {
    const session = this.assertOwner(sessionId, userId);
    if (!session) return null;
    return {
      delivered: session.totalOutputDelivered,
      dropped: session.totalOutputDropped,
      bpDroppedChunks: session.bpTotalDroppedChunks,
      pendingBytes: session.pendingOutputBytes,
      pendingChunks: session.pendingOutput.length,
    };
  }

  /**
   * Get all session snapshots (safe to send to clients).
   */
  snapshot(): PtySessionSnapshot[] {
    return Array.from(this.sessions.values()).map((s) => this.toSnapshot(s));
  }

  /**
   * Get sessions for a specific user.
   */
  snapshotByUser(userId: string): PtySessionSnapshot[] {
    return this.snapshot().filter((s) => s.userId === userId);
  }

  /**
   * Count active sessions for a user.
   */
  countByUser(userId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.exited) count++;
    }
    return count;
  }

  /**
   * Total number of active sessions.
   */
  get size(): number {
    return this.sessions.size;
  }

  // ─── Sweeper ────────────────────────────────────────────────────

  /**
   * Start a periodic sweeper that kills sessions exceeding idle timeout
   * or absolute lifetime. Called once at server startup.
   */
  startSweeper(intervalMs: number = 60_000): void {
    if (this.sweeperTimer) return;
    this.sweeperTimer = setInterval(() => this.sweep(), intervalMs);
    // Don't keep the process alive just for the sweeper
    if (this.sweeperTimer.unref) this.sweeperTimer.unref();
  }

  /**
   * Stop the sweeper (for tests / shutdown).
   */
  stopSweeper(): void {
    if (this.sweeperTimer) {
      clearInterval(this.sweeperTimer);
      this.sweeperTimer = null;
    }
  }

  /**
   * Run one sweep — kills sessions that exceeded idle timeout or absolute lifetime.
   * Exposed for testing.
   */
  sweep(): void {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.exited) {
        // Clean up exited sessions that weren't removed yet
        this.clearTimers(session);
        this.sessions.delete(session.sessionId);
        continue;
      }
      const idleMs = now - session.lastActivityAt;
      const lifetimeMs = now - session.createdAt;
      if (idleMs > this.limits.idleTimeoutMs) {
        this.killInternal(session.sessionId, `idle_timeout (${Math.round(idleMs / 1000)}s)`);
      } else if (lifetimeMs > this.limits.absoluteLifetimeMs) {
        this.killInternal(session.sessionId, `absolute_lifetime_exceeded (${Math.round(lifetimeMs / 1000)}s)`);
      }
    }
  }

  // ─── Shutdown ───────────────────────────────────────────────────

  /**
   * Kill all sessions and stop the sweeper. Called on server shutdown.
   */
  shutdown(): void {
    this.stopSweeper();
    for (const sessionId of this.sessions.keys()) {
      this.killInternal(sessionId, "server_shutdown");
    }
  }

  // ─── Internal helpers ───────────────────────────────────────────

  private resetIdleTimer(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      this.killInternal(sessionId, "idle_timeout");
    }, this.limits.idleTimeoutMs);
  }

  private markExited(sessionId: string, exitCode: number | null): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.exited = true;
    session.exitCode = exitCode;
    // Free pending output buffer — the PTY is gone, no more output.
    session.pendingOutput = [];
    session.pendingOutputBytes = 0;
    session.flushScheduled = false;
    this.clearTimers(session);
    // Don't delete immediately — the sweeper or kill() will clean up.
    // This lets get() return the exit status briefly after exit.
  }

  private clearTimers(session: PtySession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    if (session.lifetimeTimer) {
      clearTimeout(session.lifetimeTimer);
      session.lifetimeTimer = null;
    }
  }

  private toSnapshot(session: PtySession): PtySessionSnapshot {
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

// ─── Default spawn factory (real node-pty + Docker) ────────────────

function createDefaultSpawnFactory(): PtySpawnFactory {
  return {
    spawnHost({ shell, cwd, env, onData, onExit }): PtyProcessHandle {
      const ptyProcess = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 120,
        rows: 32,
        cwd,
        env: env as Record<string, string>,
      });
      ptyProcess.onData(onData);
      ptyProcess.onExit(({ exitCode, signal }) => {
        onExit({ exitCode: exitCode ?? null, signal });
      });
      return {
        write: (data: string) => ptyProcess.write(data),
        resize: (cols: number, rows: number) => ptyProcess.resize(cols, rows),
        kill: () => ptyProcess.kill(),
      };
    },
    spawnDocker({ userId, sessionId, cwd, onData, onExit }): PtyProcessHandle {
      const dockerHandle = createDockerSession({
        userId,
        sessionId,
        workspace: cwd,
        onData,
      });
      dockerHandle.onExit(({ exitCode, signal }) => {
        onExit({ exitCode: exitCode ?? null, signal });
      });
      return {
        write: (data: string) => dockerHandle.write(data),
        resize: (cols: number, rows: number) => dockerHandle.resize(cols, rows),
        kill: () => dockerHandle.kill(),
      };
    },
  };
}
