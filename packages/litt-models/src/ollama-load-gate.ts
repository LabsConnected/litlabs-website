/**
 * Ollama model-load gate — ONE canonical mechanism shared by every LiTT
 * surface that can trigger a model load (web dev server, litt CLI,
 * terminal-side helpers).
 *
 * The problem: a request to a cold Ollama daemon triggers a model load
 * inline — and with several LiTT agent processes on one host (Next.js dev
 * server, litt CLI, spawned helpers), two agents arriving together can
 * each kick off a multi-GB load. On CPU-bound or thermally constrained
 * hosts (e.g. i5-9300H at the 45W limit) simultaneous loads thrash the
 * daemon: with OLLAMA_MAX_LOADED_MODELS=1 the second load also EVICTS the
 * model the first agent just paid to load.
 *
 * The mechanism: before sending a generation request, check /api/ps. A
 * resident model proceeds lock-free (the hot path costs one cheap local
 * GET). A cold model takes a cross-process lockfile, re-checks residency
 * (another agent may have loaded it while we waited), then performs the
 * load itself inside the lock via an explicit warm-up call — so at most
 * ONE agent ever loads at a time.
 *
 * Deliberately soft-fail: if the gate itself can't be consulted (lock
 * wait exceeded, /api/ps unreachable), the caller proceeds to its normal
 * request path — Ollama's own NUM_PARALLEL queue is the server-side
 * backstop, and the real request reports the true error rather than a
 * gate artifact.
 *
 * Kill switch: LITT_OLLAMA_LOAD_LOCK=off (or "0"/"disabled") bypasses the
 * gate entirely — pre-gate behavior for emergency debugging.
 *
 * This module does no process.env reads at import time; callers inject
 * getEnv like every other @litt/models resolver.
 */

import { tmpdir } from "node:os";
import { hostname } from "node:os";
import { join } from "node:path";
import { open, rm, stat, writeFile } from "node:fs/promises";

import type { EnvGetter } from "./ollama-endpoint.js";

/** Env var that disables the gate ("off", "0", "disabled"). */
export const OLLAMA_LOAD_LOCK_ENV_VAR = "LITT_OLLAMA_LOAD_LOCK";

/** Default lockfile location (shared across every LiTT process on the host). */
export function defaultOllamaLoadLockPath(tmp: string = tmpdir()): string {
  return join(tmp, "litt-ollama-model-load.lock");
}

/**
 * Stale-lock TTL: a lock older than this is assumed abandoned (holder
 * crashed or was killed mid-load) and reclaimed. Multi-GB GGUF loads on a
 * thermally throttled CPU have measured ~90s; 15 minutes is generous for
 * even the largest local models while still bounding a deadlock.
 */
export const OLLAMA_LOAD_LOCK_STALE_MS = 15 * 60_000;

/** How long to wait for the lock before proceeding WITHOUT it (see header). */
export const OLLAMA_LOAD_LOCK_WAIT_MS = 10 * 60_000;

/** Poll interval while waiting for the lock. */
const LOCK_POLL_MS = 250;

/** Timeout for /api/ps residency probes. */
const PS_PROBE_TIMEOUT_MS = 3_000;

interface LockHolderInfo {
  pid: number;
  host: string;
  at: string;
  model: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockDisabled(getEnv: EnvGetter): boolean {
  const v = (getEnv(OLLAMA_LOAD_LOCK_ENV_VAR) ?? "").trim().toLowerCase();
  return v === "off" || v === "0" || v === "disabled";
}

// ─── Resident-model probe (/api/ps) ──────────────────────────────

export interface OllamaResidentModel {
  name: string;
  sizeMb: number;
}

/**
 * Which models are currently resident (loaded) at `endpoint`.
 * Throws on network failure — callers decide whether that's fatal.
 */
export async function listResidentOllamaModels(
  endpoint: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("ps probe timeout", "TimeoutError")),
    opts.timeoutMs ?? PS_PROBE_TIMEOUT_MS,
  );
  const onAbort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await doFetch(`${endpoint}/api/ps`, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Ollama /api/ps ${res.status}`);
    }
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    return (data.models ?? [])
      .map((m) => m.name ?? m.model)
      .filter((n): n is string => !!n);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

// ─── Cross-process lockfile ───────────────────────────────────────

export interface OllamaLoadLock {
  /** Release the lock. Idempotent. */
  release: () => Promise<void>;
  /** Diagnostics: the lockfile path actually held. */
  path: string;
}

export interface OllamaLoadLockOptions {
  /** Lockfile path — default is shared host-wide; override in tests. */
  path?: string;
  /** Max time to wait for the lock before throwing OllamaLoadLockTimeout. */
  waitMs?: number;
  /** Age at which an existing lockfile is considered abandoned. */
  staleMs?: number;
  /** Model tag recorded in the lockfile (diagnostics). */
  model?: string;
  /** Abort waiting. */
  signal?: AbortSignal;
  /** Injectable clock for tests. */
  now?: () => number;
}

export class OllamaLoadLockTimeout extends Error {
  constructor(
    public readonly path: string,
    public readonly waitedMs: number,
  ) {
    super(`Timed out after ${waitedMs}ms waiting for Ollama model-load lock at ${path}`);
    this.name = "OllamaLoadLockTimeout";
  }
}

/**
 * Acquire the cross-process model-load lock.
 *
 * Uses an atomic create-exclusive (`open(path, "wx")`) spin — the only
 * primitive that is atomic across processes on every filesystem Node
 * targets. A lockfile older than `staleMs` is reclaimed: a crashed holder
 * must not deadlock every other agent on the host.
 *
 * Throws OllamaLoadLockTimeout when the lock can't be taken within
 * `waitMs`. Callers that prefer graceful degradation should catch it.
 */
export async function acquireOllamaLoadLock(
  options: OllamaLoadLockOptions = {},
): Promise<OllamaLoadLock> {
  const path = options.path ?? defaultOllamaLoadLockPath();
  const waitMs = options.waitMs ?? OLLAMA_LOAD_LOCK_WAIT_MS;
  const staleMs = options.staleMs ?? OLLAMA_LOAD_LOCK_STALE_MS;
  const now = options.now ?? (() => Date.now());
  const deadline = now() + waitMs;

  const holder: LockHolderInfo = {
    pid: process.pid,
    host: hostname(),
    at: new Date().toISOString(),
    model: options.model ?? null,
  };

  while (true) {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
    }
    try {
      const fh = await open(path, "wx");
      try {
        await fh.writeFile(JSON.stringify(holder));
      } finally {
        await fh.close();
      }
      let released = false;
      return {
        path,
        release: async () => {
          if (released) return;
          released = true;
          await rm(path, { force: true }).catch(() => {});
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Lock held — reclaim if abandoned, otherwise wait and retry.
      try {
        const st = await stat(path);
        if (now() - st.mtimeMs > staleMs) {
          await rm(path, { force: true }).catch(() => {});
          continue;
        }
      } catch {
        // stat raced with the holder's release — retry immediately.
        continue;
      }
      if (now() >= deadline) {
        throw new OllamaLoadLockTimeout(path, waitMs);
      }
      await sleep(Math.min(LOCK_POLL_MS, Math.max(25, deadline - now())));
    }
  }
}

/** Run `fn` under the model-load lock; always releases. */
export async function withOllamaModelLoadLock<T>(
  fn: () => Promise<T>,
  options: OllamaLoadLockOptions = {},
): Promise<T> {
  const lock = await acquireOllamaLoadLock(options);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

// ─── ensure-resident facade ───────────────────────────────────────

export type OllamaEnsureState =
  /** Model was already loaded — hot path, no lock taken. */
  | "already-resident"
  /** Another agent loaded it while we waited on the lock. */
  | "became-resident"
  /** We took the lock and performed the load ourselves. */
  | "loaded-under-lock"
  /** LITT_OLLAMA_LOAD_LOCK disabled the gate — nothing was checked. */
  | "gate-disabled"
  /** Lock wait exceeded — caller proceeds WITHOUT the guarantee. */
  | "lock-timeout-proceeded"
  /** The lock itself errored (e.g. tmpdir unwritable) — caller proceeds. */
  | "lock-error-proceeded"
  /** /api/ps probe failed — caller proceeds without knowing residency. */
  | "probe-failed";

export interface OllamaEnsureResult {
  state: OllamaEnsureState;
  /** True when a real load was performed inside the lock. */
  loadedByUs: boolean;
}

export interface EnsureOllamaModelOptions {
  getEnv?: EnvGetter;
  fetchImpl?: typeof fetch;
  /** keep_alive to send on the warm-up load (e.g. "1m", "30m"). */
  keepAlive?: string;
  /** Budget for the warm-up load call itself (cold multi-GB loads are slow). */
  loadTimeoutMs?: number;
  signal?: AbortSignal;
  lockPath?: string;
  staleMs?: number;
  waitMs?: number;
  /** Called for soft-fail diagnostics ("lock-timeout-proceeded", "probe-failed"). */
  onNote?: (state: OllamaEnsureState, detail: string) => void;
}

/**
 * Ensure `model` is resident at `endpoint`, serializing actual loads
 * across every LiTT process on the host.
 *
 *   warm (hot path): /api/ps shows the model → return immediately.
 *   cold:            take lockfile → re-check /api/ps → POST /api/generate
 *                    (empty prompt performs the load) inside the lock.
 *
 * Never performs a load outside the lock, and never throws merely because
 * the gate was unreachable — soft-fail states are returned for the caller
 * to log, and the subsequent real request surfaces any true daemon error.
 */
export async function ensureOllamaModelResident(
  endpoint: string,
  model: string,
  options: EnsureOllamaModelOptions = {},
): Promise<OllamaEnsureResult> {
  const getEnv = options.getEnv ?? ((key: string) => process.env[key]);
  if (lockDisabled(getEnv)) return { state: "gate-disabled", loadedByUs: false };

  const doFetch = options.fetchImpl ?? fetch;
  const note = options.onNote ?? (() => {});
  const probe = () =>
    listResidentOllamaModels(endpoint, {
      fetchImpl: doFetch,
      signal: options.signal,
    });

  let resident: string[];
  try {
    resident = await probe();
  } catch (err) {
    const state: OllamaEnsureState = "probe-failed";
    note(state, err instanceof Error ? err.message : String(err));
    return { state, loadedByUs: false };
  }
  if (resident.includes(model)) return { state: "already-resident", loadedByUs: false };

  let lock: OllamaLoadLock;
  try {
    lock = await acquireOllamaLoadLock({
      path: options.lockPath,
      waitMs: options.waitMs,
      staleMs: options.staleMs,
      model,
      signal: options.signal,
    });
  } catch (err) {
    const state: OllamaEnsureState =
      err instanceof OllamaLoadLockTimeout ? "lock-timeout-proceeded" : "lock-error-proceeded";
    note(state, err instanceof Error ? err.message : String(err));
    return { state, loadedByUs: false };
  }

  try {
    // Re-check: the previous holder may have loaded exactly this model.
    try {
      const again = await probe();
      if (again.includes(model)) return { state: "became-resident", loadedByUs: false };
    } catch {
      // Probe hiccup inside the lock — attempt the load anyway; the
      // /api/generate response carries the true outcome.
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException("model load timeout", "TimeoutError")),
      options.loadTimeoutMs ?? 300_000,
    );
    const onAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await doFetch(`${endpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: "",
          stream: false,
          ...(options.keepAlive ? { keep_alive: options.keepAlive } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Ollama warm-load ${res.status}: ${txt.slice(0, 200)}`);
      }
      // Drain the body best-effort (some injected fetches lack it).
      try { await res.arrayBuffer?.(); } catch { /* drain is best-effort */ }
      return { state: "loaded-under-lock", loadedByUs: true };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  } finally {
    await lock.release();
  }
}
