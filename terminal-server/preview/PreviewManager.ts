/**
 * PreviewManager — owns one preview runtime per workspace.
 *
 * Lifecycle:
 *   stopped → starting → ready → (stopped | failed | restarting)
 *
 * On `start()`:
 *   1. Detect framework from package.json / files in workspace root
 *   2. Resolve the package manager executable (pnpm/npm/yarn) — fail with a
 *      typed error if it is genuinely unavailable, never surface a bare
 *      exit 127 as a generic crash.
 *   3. Allocate a free internal port
 *   4. Spawn the dev server bound to 0.0.0.0:<port> with a robust,
 *      non-interactive PATH (no .bashrc / .profile / NVM init required)
 *   5. Probe http://127.0.0.1:<port> until healthy
 *   6. Only then set status = "ready"
 *
 * The child process stdout/stderr is captured into a ring buffer
 * for the logs endpoint.
 */

import { execFile, spawn, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import { createServer as createTcpServer } from "net";
import { delimiter as PATH_DELIMITER, dirname, join, resolve } from "path";
import { promisify } from "util";
import { parse as parseDotenv } from "dotenv";
import { getWorkspace, type WorkspaceDescriptor } from "../workspace/WorkspaceManager";
import { resolveBindHost } from "../network-bind";

/**
 * Environment variables that may be inherited from the terminal server.
 * Workspace-specific configuration is loaded separately from the workspace.
 */
export const PREVIEW_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TZ",
  "NODE_ENV",
  "DEBUG",
  "LOG_LEVEL",
  "SystemRoot",
  "ComSpec",
  "TEMP",
  "TMP",
] as const;

export function buildPreviewEnv(
  projectEnv: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PREVIEW_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, projectEnv);
  return env;
}

function loadWorkspaceEnv(root: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const filename of [".env", ".env.local"]) {
    const path = join(root, filename);
    if (!existsSync(path)) continue;
    try {
      Object.assign(env, parseDotenv(readFileSync(path)));
    } catch {
      // Workspace startup will surface invalid configuration through its normal diagnostics.
    }
  }
  return env;
}

const execFileAsync = promisify(execFile);

/**
 * Preview children mirror the parent terminal-server's own resolved bind
 * host (Railway → 0.0.0.0, --tailscale/--lan → explicit, else 127.0.0.1) —
 * see ../network-bind.ts. Called at each use site (not cached at module
 * load) so a --tailscale failure surfaces as a normal preview-start error
 * through this file's existing error handling, rather than crashing the
 * whole process during module import — server.ts's own startup guard is
 * what aborts the process for that case; this is a defensive second layer.
 */
function previewBindHost(): string {
  return resolveBindHost().host;
}

export type PreviewStatus = "stopped" | "starting" | "ready" | "failed" | "restarting";

export interface PreviewRuntime {
  workspaceId: string;
  userId: string;
  projectId: string;
  process: ChildProcess | null;
  port: number;
  framework: string;
  command: string;
  status: PreviewStatus;
  startedAt: number | null;
  lastHealthCheck: number | null;
  error: string | null;
  errorCode: PreviewErrorCode | null;
  logs: string[];
  /**
   * Fingerprint of the resolved Clerk project env this runtime started
   * with (see fingerprintProjectEnv). Used to restart only when the env
   * actually changed. Null for runtimes created before this field existed.
   */
  clerkEnvFingerprint: string | null;
  /**
   * The Clerk subset of projectEnv passed at start (extractClerkEnv).
   * Persisted so an explicit restart re-resolves the same project env
   * instead of silently dropping it.
   */
  clerkProjectEnv: Record<string, string> | null;
}

interface PreviewStartInput {
  workspaceId: string;
  userId: string;
  framework?: string;
  command?: string;
  packageManager?: string;
  /**
   * Project-configured environment (e.g. Clerk keys resolved from the
   * project's secret store by the web app). Only the Clerk subset is
   * ever extracted — see extractClerkEnv. Merged BELOW workspace
   * .env/.env.local, which keep Next.js dev precedence.
   */
  projectEnv?: Record<string, string>;
  /**
   * Bypass the reuse-a-healthy-runtime optimization and always tear
   * down + restart. Used by explicit restart (the user asked for a
   * fresh dev server, not a no-op).
   */
  forceRestart?: boolean;
}

/**
 * Typed preview error codes. These map runtime failures to actionable
 * states instead of surfacing a meaningless "Preview unavailable".
 */
export type PreviewErrorCode =
  | "preview_package_manager_missing"
  | "preview_command_not_found"
  | "preview_dev_server_failed"
  | "preview_workspace_not_found"
  | "preview_port_never_ready"
  | "preview_spawn_error"
  | "preview_no_free_port"
  | "preview_port_conflict"
  | "preview_no_dev_command"
  | "preview_dependency_install_failed"
  | "preview_root_route_missing"
  | "preview_clerk_config_error"
  | "preview_auth_config_error";

export class PreviewError extends Error {
  readonly code: PreviewErrorCode;
  readonly diagnostic: PreviewDiagnostic;
  constructor(code: PreviewErrorCode, message: string, diagnostic: Partial<PreviewDiagnostic> = {}) {
    super(message);
    this.name = "PreviewError";
    this.code = code;
    this.diagnostic = {
      command: diagnostic.command ?? null,
      cwd: diagnostic.cwd ?? null,
      exitCode: diagnostic.exitCode ?? null,
      packageManager: diagnostic.packageManager ?? null,
      pathSearched: diagnostic.pathSearched ?? null,
      runtimeNodePath: diagnostic.runtimeNodePath ?? null,
      suggestedRemediation: diagnostic.suggestedRemediation ?? null,
      ...diagnostic,
    } as PreviewDiagnostic;
  }
}

export interface PreviewDiagnostic {
  command: string | null;
  cwd: string | null;
  exitCode: number | null;
  packageManager: string | null;
  pathSearched: string | null;
  runtimeNodePath: string | null;
  suggestedRemediation: string | null;
  [key: string]: unknown;
}

const MAX_LOG_LINES = 500;
const HEALTH_PROBE_INTERVAL_MS = 1000;
const HEALTH_PROBE_TIMEOUT_MS = 60_000; // 60s to start
const PORT_RANGE_START = 4100;
const PORT_RANGE_END = 4200;

const runtimes = new Map<string, PreviewRuntime>();

// ─── Port allocation ───────────────────────────────────────────────

const usedPorts = new Set<number>();

/** True when nothing is bound to `port` on `host` right now. */
export function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const test = createTcpServer();
    test.once("error", () => resolvePromise(false));
    test.once("listening", () => {
      test.close(() => resolvePromise(true));
    });
    test.listen(port, host);
  });
}

/**
 * Poll until `port` accepts a bind on `host` — i.e. no process owns it —
 * up to timeoutMs. Returns false while still occupied.
 */
async function waitForPortFree(
  port: number,
  host: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port, host)) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  return isPortFree(port, host);
}

/**
 * Allocate a preview port that is actually bindable — not merely absent
 * from the in-process usedPorts set.
 *
 * The old allocator trusted usedPorts alone: after a terminal-server
 * restart the set is empty while orphaned dev servers still hold
 * 4100-4200. `next dev --port <p>` then auto-increments ("Port 4100 is
 * in use, trying 4101") and the runtime kept pointing at the squatter —
 * the health probe and the iframe proxy both talked to the wrong
 * process, which is how a dead port could read "Preview ready" while
 * serving "Cannot GET /".
 */
export async function allocateFreePort(): Promise<number> {
  const bindHost = previewBindHost();
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (usedPorts.has(port)) continue;
    // The child binds `bindHost`; the probe and proxy reach the server
    // via 127.0.0.1. A squatter on either interface makes the port
    // unsafe to hand out — skip it.
    if (!(await isPortFree(port, bindHost))) continue;
    if (bindHost !== "127.0.0.1" && !(await isPortFree(port, "127.0.0.1"))) continue;
    usedPorts.add(port);
    return port;
  }
  throw new PreviewError(
    "preview_no_free_port",
    `No free preview ports available in range ${PORT_RANGE_START}-${PORT_RANGE_END}`,
  );
}

function releasePort(port: number): void {
  usedPorts.delete(port);
}

/**
 * Extract the port a dev server actually bound from one output line.
 * Covers the two truthful announcements:
 *   Next.js : "⚠ Port 4100 is in use, trying 4101 instead."
 *   Next/Vite/…: "- Local:   http://localhost:4101" / "➜  Local:  http://127.0.0.1:5174/"
 * Returns null when the line carries no bound-port information.
 */
export function detectBoundPort(line: string): number | null {
  const trying = /port\s+\d+\s+is\s+in\s+use,?\s+trying\s+(\d{2,5})/i.exec(line);
  if (trying) return Number(trying[1]);
  // Host may be a name, IPv4, or bracketed IPv6 — the port is the last
  // ":digits" before the path/end.
  const local = /\bLocal:\s+https?:\/\/[\w.\-[\]:]+:(\d{2,5})(?:[/?]|$)/i.exec(line);
  if (local) return Number(local[1]);
  return null;
}

/**
 * Retarget the runtime when the dev server announces a bound port
 * different from the allocated one — `next dev` auto-increments on
 * EADDRINUSE instead of failing. Keeping runtime.port on the squatter
 * would route the probe and the iframe proxy to the wrong process.
 *
 * If the announced port is already allocated to another preview, the
 * child landed on a foreign dev server — adopting it would serve
 * another workspace's app (tenant crossover), so fail instead.
 */
export function adoptBoundPort(runtime: PreviewRuntime, bound: number): void {
  if (bound === runtime.port) return;
  if (bound < 1024 || bound > 65535) return;
  if (runtime.status !== "starting" && runtime.status !== "ready") return;
  if (usedPorts.has(bound)) {
    runtime.status = "failed";
    runtime.errorCode = "preview_port_conflict";
    runtime.error =
      `Dev server bound port ${bound}, which is already allocated to ` +
      "another preview runtime. Restart preview to allocate a fresh port.";
    pushLog(runtime, `[preview] Port conflict — dev server bound ${bound}, already allocated to another workspace`);
    return;
  }
  pushLog(
    runtime,
    `[preview] Allocated port ${runtime.port} was taken — dev server ` +
      `actually bound ${bound}; retargeting runtime and proxy`,
  );
  releasePort(runtime.port);
  usedPorts.add(bound);
  runtime.port = bound;
}

// ─── Robust PATH construction ──────────────────────────────────────
//
// A Railway service is non-interactive: there is no .bashrc, .profile, or
// NVM initialization. The child process PATH must be constructed from
// known runtime locations so that node/pnpm/npm are always discoverable.
//
// Order (prepended, deduplicated, empty entries ignored):
//   1. NODE_BIN_DIR override (optional — validated to exist)
//   2. Directory containing process.execPath (the running Node's bin dir)
//   3. Project-local node_modules/.bin (workspace dev binaries)
//   4. Existing process.env.PATH (preserved, never replaced)

/**
 * Build a robust PATH for a preview child process. Never replaces the
 * existing PATH — prepends known-good directories and deduplicates.
 */
export function buildChildPath(root: string): string {
  const entries: string[] = [];

  // 1. NODE_BIN_DIR override (optional). Validate it exists; never
  //    silently prepend a dead path.
  const nodeBinDir = process.env.NODE_BIN_DIR;
  if (nodeBinDir) {
    try {
      if (existsSync(nodeBinDir) && statSync(nodeBinDir).isDirectory()) {
        entries.push(resolve(nodeBinDir));
      }
    } catch {
      // dead path — skip
    }
  }

  // 2. Directory containing the running Node executable. This is where
  //    corepack-managed pnpm/npm shims live on a node:22 image.
  const runtimeNodeDir = dirname(process.execPath);
  entries.push(runtimeNodeDir);

  // 3. Project-local node_modules/.bin — workspace dev binaries.
  const projectBin = join(root, "node_modules", ".bin");
  entries.push(projectBin);

  // 4. Existing PATH — preserved, never replaced.
  const existingPath = process.env.PATH ?? "";
  if (existingPath) {
    entries.push(...existingPath.split(PATH_DELIMITER).filter(Boolean));
  }

  // Deduplicate (preserve first occurrence order), drop empties.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const e of entries) {
    const norm = e.replace(/\/+$/, "");
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      deduped.push(norm);
    }
  }
  return deduped.join(PATH_DELIMITER);
}

// ─── Package manager resolution ────────────────────────────────────

interface ResolvedPackageManager {
  /** The executable to spawn (e.g. "pnpm", "/usr/local/bin/pnpm"). */
  executable: string;
  /** True if the executable was found on PATH. */
  found: boolean;
  /** The PATH that was searched. */
  pathSearched: string;
}

/**
 * Resolve the package manager executable for a workspace. Does NOT assume
 * pnpm exists — verifies it is discoverable on the constructed PATH.
 *
 * Resolution order for pnpm:
 *   1. Direct `pnpm` on PATH (corepack shim on node images)
 *   2. corepack pnpm shim via `corepack pnpm`
 *
 * For npm/yarn: direct lookup on PATH.
 */
export function resolvePackageManager(
  pm: string,
  root: string,
): ResolvedPackageManager {
  const childPath = buildChildPath(root);
  const isWin = process.platform === "win32";

  // Try direct lookup of the package manager on the constructed PATH.
  const direct = lookupExecutable(pm, childPath, isWin);
  if (direct) {
    return { executable: pm, found: true, pathSearched: childPath };
  }

  // For pnpm, try the corepack shim as a fallback.
  if (pm === "pnpm") {
    const corepack = lookupExecutable("corepack", childPath, isWin);
    if (corepack) {
      return { executable: "corepack", found: true, pathSearched: childPath };
    }
  }

  return { executable: pm, found: false, pathSearched: childPath };
}

/**
 * Check whether an executable exists on a given PATH-style string.
 * Returns the resolved path if found, null otherwise.
 */
function lookupExecutable(name: string, pathStr: string, isWin: boolean): string | null {
  const dirs = pathStr.split(PATH_DELIMITER).filter(Boolean);
  const candidates = isWin
    ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name]
    : [name];
  for (const dir of dirs) {
    for (const cand of candidates) {
      const full = join(dir, cand);
      try {
        if (existsSync(full)) {
          // On Windows, .cmd/.bat are fine. On Unix, check executable bit.
          if (!isWin) {
            const st = statSync(full);
            if (!(st.mode & 0o111)) continue; // not executable
          }
          return full;
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function redactDiagnosticText(value: unknown): string {
  return String(value ?? "")
    .replace(/(token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(-4000);
}

// ─── Clerk configuration validation ────────────────────────────────
//
// The preview runtime must not inherit the terminal-server's process.env.
// A stale, rotated, or malformed terminal-server CLERK_SECRET_KEY can make
// the preview's Clerk middleware crash with a 500.
//
// Workspace .env files are loaded explicitly into the isolated preview env so
// Next.js does not accidentally prefer a terminal-server value.
//
// These validators run BEFORE spawning the dev server so we surface a
// truthful, deterministic configuration error instead of a generic
// 60-second "Dev server did not become healthy" timeout.

interface ClerkValidationResult {
  ok: boolean;
  reason: string | null;
  /** Whether the workspace project uses Clerk at all. */
  usesClerk: boolean;
}

/**
 * Detect whether the workspace project uses Clerk by checking package.json
 * for @clerk/nextjs, @clerk/backend, or @clerk/clerk-sdk-node.
 */
function workspaceUsesClerk(root: string): boolean {
  const pkgJsonPath = join(root, "package.json");
  if (!existsSync(pkgJsonPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    return Boolean(
      deps["@clerk/nextjs"] ||
      deps["@clerk/backend"] ||
      deps["@clerk/clerk-sdk-node"] ||
      deps["@clerk/remix"],
    );
  } catch {
    return false;
  }
}

/**
 * Clean an env value: trim whitespace, newlines, and surrounding quotes
 * that can sneak in from copy-paste or Railway variable editing.
 */
function cleanEnvValue(value: string | undefined): string {
  if (!value) return "";
  let v = value.trim();
  // Strip surrounding quotes (single or double)
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

/**
 * Compute a short SHA-256 fingerprint of a secret for safe logging.
 * Never log the full key value.
 */
function fingerprintSecret(value: string): string {
  if (!value) return "none";
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Validate the Clerk configuration that will reach the preview runtime.
 *
 * Checks:
 *   1. If the workspace uses Clerk, CLERK_SECRET_KEY must be present.
 *   2. CLERK_SECRET_KEY must start with sk_test_ or sk_live_ (not pk_).
 *   3. CLERK_SECRET_KEY must not equal the publishable key.
 *   4. NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (or CLERK_PUBLISHABLE_KEY fallback)
 *      must be present.
 *   5. Values are cleaned of whitespace/newlines/quotes.
 *
 * Returns a validation result with `ok` and a human-readable `reason`.
 * Also returns `usesClerk` so the caller can skip validation for non-Clerk
 * projects.
 */
export function validateClerkConfig(
  env: Record<string, string>,
  root: string,
): ClerkValidationResult {
  const usesClerk = workspaceUsesClerk(root);
  if (!usesClerk) {
    return { ok: true, reason: null, usesClerk: false };
  }

  const secretKey = cleanEnvValue(env.CLERK_SECRET_KEY);
  const publishableKey = cleanEnvValue(
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? env.CLERK_PUBLISHABLE_KEY,
  );

  if (!secretKey) {
    return {
      ok: false,
      reason:
        "CLERK_SECRET_KEY is missing. The workspace uses @clerk/nextjs but " +
        "no secret key was found in the preview runtime environment. " +
        "Add it to the workspace .env.local or configure it in the preview env.",
      usesClerk: true,
    };
  }

  if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("sk_live_")) {
    // Check if it's a publishable key accidentally in the secret slot
    if (secretKey.startsWith("pk_test_") || secretKey.startsWith("pk_live_")) {
      return {
        ok: false,
        reason:
          "CLERK_SECRET_KEY contains a publishable key (pk_*) instead of a " +
          "secret key (sk_*). Swap the values — the secret key must start " +
          "with sk_test_ or sk_live_.",
        usesClerk: true,
      };
    }
    return {
      ok: false,
      reason:
        `CLERK_SECRET_KEY has an unexpected prefix "${secretKey.slice(0, 8)}". ` +
        "Clerk secret keys must start with sk_test_ or sk_live_.",
      usesClerk: true,
    };
  }

  if (publishableKey && secretKey === publishableKey) {
    return {
      ok: false,
      reason:
        "CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY are " +
        "identical. The secret key and publishable key must be different " +
        "values from the same Clerk instance.",
      usesClerk: true,
    };
  }

  if (!publishableKey) {
    return {
      ok: false,
      reason:
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing. The workspace uses " +
        "@clerk/nextjs which requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY " +
        "(or CLERK_PUBLISHABLE_KEY as fallback) in the preview environment.",
      usesClerk: true,
    };
  }

  if (
    !publishableKey.startsWith("pk_test_") &&
    !publishableKey.startsWith("pk_live_")
  ) {
    return {
      ok: false,
      reason:
        `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY has an unexpected prefix ` +
        `"${publishableKey.slice(0, 8)}". Clerk publishable keys must ` +
        "start with pk_test_ or pk_live_.",
      usesClerk: true,
    };
  }

  // Check for test/live mismatch (test secret + live publishable or vice versa)
  const secretIsLive = secretKey.startsWith("sk_live_");
  const publishableIsLive = publishableKey.startsWith("pk_live_");
  if (secretIsLive !== publishableIsLive) {
    return {
      ok: false,
      reason:
        `Clerk key environment mismatch: CLERK_SECRET_KEY is ` +
        `${secretIsLive ? "live" : "test"} but ` +
        `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is ` +
        `${publishableIsLive ? "live" : "test"}. Both keys must be ` +
        "from the same Clerk environment (both test or both live).",
      usesClerk: true,
    };
  }

  return { ok: true, reason: null, usesClerk: true };
}

/**
 * Build a redacted fingerprint of the Clerk env for safe logging.
 * Never includes the full key value — only prefix + length + hash.
 */
export function fingerprintClerkEnv(
  env: Record<string, string>,
): Record<string, unknown> {
  const secret = cleanEnvValue(env.CLERK_SECRET_KEY);
  const publishable = cleanEnvValue(
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? env.CLERK_PUBLISHABLE_KEY,
  );
  return {
    CLERK_SECRET_KEY: {
      present: Boolean(secret),
      prefix: secret ? secret.slice(0, 8) : null,
      length: secret.length,
      fingerprint: fingerprintSecret(secret),
    },
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: {
      present: Boolean(publishable),
      prefix: publishable ? publishable.slice(0, 8) : null,
      length: publishable.length,
      fingerprint: fingerprintSecret(publishable),
    },
  };
}

// ─── Project env resolution (Clerk) ────────────────────────────────
//
// Since PR #444 the preview child inherits ONLY the allowlisted container
// vars plus the workspace's own .env/.env.local. That isolation is
// deliberate (a user workspace must never inherit the terminal server's
// production secrets), but it leaves Clerk workspaces with no way to get
// their own keys when the container clone has no .env.local.
//
// The web app resolves the project's configured Clerk keys from its
// secret store and passes them as `projectEnv` on preview start. Only
// the Clerk subset is ever extracted — everything else stays out of the
// child process. Merge precedence (lowest → highest):
//   container allowlist < project secrets < workspace .env < .env.local
// which mirrors Next.js dev semantics: local files win.

/**
 * Extract the Clerk subset from an arbitrary env map (e.g. decrypted
 * project secrets). Maps CLERK_PUBLISHABLE_KEY to
 * NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY when the latter is absent, cleans
 * values, and drops empties. Never includes non-Clerk keys.
 */
export function extractClerkEnv(
  source: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const secret = cleanEnvValue(source.CLERK_SECRET_KEY);
  if (secret) out.CLERK_SECRET_KEY = secret;
  const publishable = cleanEnvValue(
    source.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? source.CLERK_PUBLISHABLE_KEY,
  );
  if (publishable) out.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = publishable;
  return out;
}

/**
 * Resolve the project-level env for a preview spawn: project secrets
 * first, then the workspace's own .env/.env.local on top.
 */
export function resolvePreviewProjectEnv(
  projectEnv: Record<string, string> | undefined,
  workspaceRoot: string,
): Record<string, string> {
  return {
    ...extractClerkEnv(projectEnv ?? {}),
    ...loadWorkspaceEnv(workspaceRoot),
  };
}

/**
 * Stable fingerprint of the resolved Clerk project env, for change
 * detection. Safe to log — it's a hash, never the values.
 */
export function fingerprintProjectEnv(env: Record<string, string>): string {
  const subset = extractClerkEnv(env);
  const keys = Object.keys(subset).sort();
  if (keys.length === 0) return "none";
  return createHash("sha256")
    .update(keys.map((k) => `${k}=${subset[k]}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Decide whether an existing preview runtime can be reused instead of
 * torn down and restarted. Only when it is healthy (ready/starting),
 * its process is still alive, and the resolved Clerk env is
 * byte-identical to what it started with. A null stored fingerprint
 * (pre-upgrade runtime) never matches — it takes the full restart path.
 */
export function shouldReuseRuntime(
  existing: Pick<PreviewRuntime, "status" | "clerkEnvFingerprint" | "process">,
  newFingerprint: string,
): boolean {
  if (!existing.clerkEnvFingerprint) return false;
  if (existing.status !== "ready" && existing.status !== "starting") return false;
  const proc = existing.process;
  if (!proc || proc.exitCode !== null || proc.killed) return false;
  return existing.clerkEnvFingerprint === newFingerprint;
}

async function installWorkspaceDependencies(
  root: string,
  packageManager: string,
  executable: string,
): Promise<void> {  if (!existsSync(join(root, "package.json")) || packageManager === "npx") return;

  const args = executable === "corepack"
    ? ["pnpm", "install", "--prefer-offline"]
    : ["install", "--prefer-offline"];
  if (packageManager === "pnpm" && existsSync(join(root, "pnpm-lock.yaml"))) {
    args.push("--frozen-lockfile");
  }

  const childPath = buildChildPath(root);
  const nodeBinDir = process.env.NODE_BIN_DIR?.trim();
  const env: Record<string, string> = {
    ...buildPreviewEnv(loadWorkspaceEnv(root)),
    PATH: nodeBinDir ? `${nodeBinDir}${PATH_DELIMITER}${childPath}` : childPath,
    NODE_ENV: "development",
    NPM_CONFIG_IGNORE_WORKSPACE_ROOT_CHECK: "true",
  };

  const resolvedExecutable = lookupExecutable(executable, childPath, process.platform === "win32") ?? executable;
  try {
    await execFileAsync(resolvedExecutable, args, {
      cwd: root,
      env,
      timeout: 300_000,
      maxBuffer: 8 * 1024 * 1024,
      shell: process.platform === "win32"
        ? (process.env.ComSpec ?? process.env.COMSPEC ?? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\cmd.exe`)
        : false,
    });
  } catch (error) {
    const failure = error as { code?: number | string; message?: string; stdout?: string; stderr?: string };
    const command = `${resolvedExecutable} ${args.join(" ")}`;
    const stderr = redactDiagnosticText(failure.stderr);
    const stdout = redactDiagnosticText(failure.stdout);
    const failureMessage = redactDiagnosticText(failure.message);
    const exitCode = typeof failure.code === "number" ? failure.code : null;
    throw new PreviewError(
      "preview_dependency_install_failed",
      `Dependency install failed${exitCode === null ? "" : ` (exit ${exitCode})`}: ${stderr || stdout || failureMessage || "unknown error"}`,
      {
        command,
        cwd: root,
        packageManager,
        exitCode,
        stderr,
        stdout,
        suggestedRemediation: "Repair the workspace dependency store and retry preview startup.",
      },
    );
  }
}

// ─── Framework detection ───────────────────────────────────────────

interface FrameworkInfo {
  framework: string;
  command: string;
  packageManager: string;
}

function detectFramework(root: string): FrameworkInfo {
  const pkgJsonPath = join(root, "package.json");
  const hasPkgJson = existsSync(pkgJsonPath);
  const hasNextConfig =
    existsSync(join(root, "next.config.ts")) ||
    existsSync(join(root, "next.config.js")) ||
    existsSync(join(root, "next.config.mjs"));
  const hasViteConfig =
    existsSync(join(root, "vite.config.ts")) ||
    existsSync(join(root, "vite.config.js"));
  const hasIndexHtml = existsSync(join(root, "index.html"));

  let packageManager = "pnpm";
  if (existsSync(join(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (existsSync(join(root, "yarn.lock"))) packageManager = "yarn";
  else if (existsSync(join(root, "package-lock.json"))) packageManager = "npm";

  // Read package.json scripts for dev command
  let devScript: string | null = null;
  let declaredPm: string | null = null;
  if (hasPkgJson) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      devScript = pkg?.scripts?.dev ?? null;
      // packageManager field (e.g. "pnpm@9.15.0") takes precedence
      if (typeof pkg?.packageManager === "string") {
        const m = pkg.packageManager.match(/^([a-z]+)/i);
        if (m) declaredPm = m[1].toLowerCase();
      }
    } catch {
      // ignore parse errors
    }
  }
  if (declaredPm) packageManager = declaredPm;

  if (hasNextConfig || (hasPkgJson && devScript?.includes("next dev"))) {
    // Run `next dev` directly with the allocated port via $PORT placeholder.
    // We bypass the project's dev script because it may hardcode a port
    // (e.g. "next dev --turbo -p 3001") which would conflict with the
    // PreviewManager's allocated port. Using `--port $PORT` ensures the
    // preview always binds to the port we probe for health checks.
    // `--turbopack` is added explicitly to match the default Next.js 16 dev
    // experience; older Next.js versions ignore unknown flags gracefully.
    const nextBin = `${packageManager} exec next`;
    return {
      framework: "nextjs",
      command: `${nextBin} dev --port $PORT --hostname ${previewBindHost()}`,
      packageManager,
    };
  }

  if (hasViteConfig || (hasPkgJson && devScript?.includes("vite"))) {
    return { framework: "vite", command: `${packageManager} dev`, packageManager };
  }

  if (hasIndexHtml && !hasPkgJson) {
    return { framework: "static", command: "npx --yes serve -s . -l $PORT", packageManager: "npx" };
  }

  if (hasPkgJson && devScript) {
    return { framework: "node", command: `${packageManager} dev`, packageManager };
  }

  // Fallback: static server if index.html exists
  if (hasIndexHtml) {
    return { framework: "static", command: "npx --yes serve -s . -l $PORT", packageManager: "npx" };
  }

  return { framework: "unknown", command: "", packageManager };
}

// ─── Health probing ────────────────────────────────────────────────

/**
 * Result of a health probe. Distinguishes:
 *   - healthy: server is running and responding
 *   - auth_config_error: server booted but Clerk/auth config is broken (500)
 *   - not_ready: server not responding yet
 */
interface HealthProbeResult {
  healthy: boolean;
  /** If the server returned a 500 with auth-related error text. */
  authConfigError: boolean;
  /** The HTTP status code if the server responded. */
  status: number | null;
  /** Snippet of the response body if status >= 400 (redacted). */
  bodySnippet: string | null;
  /** The process answered, but the preview entry route returned 404. */
  rootRouteMissing: boolean;
}

export async function probeHealth(
  port: number | (() => number),
  timeoutMs: number,
): Promise<HealthProbeResult> {
  // Accept a resolver so the probe follows a port the dev server moved
  // to (adoptBoundPort) instead of polling the squatter that took the
  // allocated port.
  const currentPort = () => (typeof port === "function" ? port() : port);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${currentPort()}/`, {
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        return { healthy: true, authConfigError: false, status: resp.status, bodySnippet: null, rootRouteMissing: false };
      }
      if (resp.status === 404) {
        // A running process is not a usable website preview when its root
        // route is missing. This is the source of the visible "Cannot GET /"
        // state; keep it truthful instead of marking the runtime ready.
        return {
          healthy: false,
          authConfigError: false,
          status: resp.status,
          bodySnippet: "The preview server returned 404 for /. A website preview must serve its entry route at /.",
          rootRouteMissing: true,
        };
      }
      // 5xx — server booted but something is broken. Capture the body
      // to detect Clerk/auth config errors vs. generic server errors.
      if (resp.status >= 500) {
        const body = await resp.text().catch(() => "");
        const bodySnippet = redactDiagnosticText(body.slice(0, 2000));
        const isAuthError = detectAuthConfigError(body);
        if (isAuthError) {
          return {
            healthy: false,
            authConfigError: true,
            status: resp.status,
            bodySnippet,
            rootRouteMissing: false,
          };
        }
      }
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_PROBE_INTERVAL_MS));
  }
  return { healthy: false, authConfigError: false, status: null, bodySnippet: null, rootRouteMissing: false };
}

/**
 * Detect whether an error response body indicates an authentication
 * configuration failure (Clerk, Auth.js, etc.) rather than a generic
 * server crash. This lets the health check surface a truthful
 * "auth config broken" error instead of a generic timeout.
 */
function detectAuthConfigError(body: string): boolean {
  const lower = body.toLowerCase();
  // Clerk-specific error patterns
  if (lower.includes("clerk") && lower.includes("secret")) return true;
  if (lower.includes("secret-key-invalid")) return true;
  if (lower.includes("handshake token verification failed")) return true;
  if (lower.includes("clerk_secret_key")) return true;
  if (lower.includes("publishable key") && lower.includes("clerk")) return true;
  // Generic auth config patterns
  if (lower.includes("auth") && lower.includes("config")) return true;
  if (lower.includes("missing") && lower.includes("secret") && lower.includes("key")) return true;
  return false;
}

// ─── Log buffer ────────────────────────────────────────────────────

function pushLog(runtime: PreviewRuntime, line: string): void {
  runtime.logs.push(line);
  if (runtime.logs.length > MAX_LOG_LINES) {
    runtime.logs.splice(0, runtime.logs.length - MAX_LOG_LINES);
  }
}

/**
 * Format process output for a failure diagnostic without cutting an error
 * through the middle of a line. The runtime log is already a bounded ring;
 * keep a useful tail of complete, individually-redacted lines from both
 * stdout and stderr.
 */
export function formatPreviewDiagnostic(logs: readonly string[]): string {
  const maxLines = 200;
  const maxChars = 16_000;
  const lines = logs
    .slice(-maxLines)
    .map((line) => redactDiagnosticText(line))
    .filter(Boolean);

  const selected: string[] = [];
  let chars = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const nextChars = chars + line.length + (selected.length > 0 ? 1 : 0);
    if (nextChars > maxChars) break;
    selected.unshift(line);
    chars = nextChars;
  }
  return selected.join("\n");
}

// ─── Public API ────────────────────────────────────────────────────

export function getPreview(workspaceId: string): PreviewRuntime | undefined {
  return runtimes.get(workspaceId);
}

export function getPreviewStatus(workspaceId: string): {
  status: PreviewStatus;
  port: number | null;
  framework: string | null;
  command: string | null;
  startedAt: number | null;
  lastHealthCheck: number | null;
  error: string | null;
  errorCode: PreviewErrorCode | null;
  logs: string[];
} {
  const rt = runtimes.get(workspaceId);
  if (!rt) {
    return {
      status: "stopped",
      port: null,
      framework: null,
      command: null,
      startedAt: null,
      lastHealthCheck: null,
      error: null,
      errorCode: null,
      logs: [],
    };
  }
  return {
    status: rt.status,
    port: rt.port,
    framework: rt.framework,
    command: rt.command,
    startedAt: rt.startedAt,
    lastHealthCheck: rt.lastHealthCheck,
    error: rt.error,
    errorCode: rt.errorCode,
    logs: [...rt.logs],
  };
}

export function getPreviewLogs(workspaceId: string, lines = 100): string[] {
  const rt = runtimes.get(workspaceId);
  if (!rt) return [];
  return rt.logs.slice(-lines);
}

export async function startPreview(input: PreviewStartInput): Promise<PreviewRuntime> {
  const { workspaceId, userId } = input;

  // Verify workspace ownership
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    throw new PreviewError(
      "preview_workspace_not_found",
      `Workspace not found: ${workspaceId}`,
      { cwd: null },
    );
  }
  if (ws.userId !== userId) throw new Error("Forbidden");
  if (!ws.ready) throw new Error("Workspace not ready");

  // Resolve the project env BEFORE touching any existing runtime, so a
  // healthy runtime whose env is unchanged can be reused instead of
  // torn down. Precedence: project secrets < .env < .env.local.
  const clerkProjectEnv = extractClerkEnv(input.projectEnv ?? {});
  const projectEnv = resolvePreviewProjectEnv(input.projectEnv, ws.root);
  const newFingerprint = fingerprintProjectEnv(projectEnv);
  const storedClerkEnv =
    Object.keys(clerkProjectEnv).length > 0 ? clerkProjectEnv : null;

  // Stop existing runtime if any — wait for the process to exit so
  // the port is released before we try to rebind. A healthy runtime
  // whose resolved env is unchanged is reused as-is (no disruptive
  // restart) — unless the caller forced a restart or the requested
  // framework/command differs from what is running. Anything else
  // takes the full stop + start path.
  const existing = runtimes.get(workspaceId);
  const preservedLogs = existing?.logs ?? [];
  const configMatches =
    !existing ||
    ((input.framework === undefined || input.framework === existing.framework) &&
      (input.command === undefined || input.command === existing.command));
  if (
    !input.forceRestart &&
    existing &&
    configMatches &&
    shouldReuseRuntime(existing, newFingerprint)
  ) {
    return existing;
  }
  if (existing) {
    await stopPreviewAndWait(workspaceId);
  }

  // Detect framework
  const detected = input.framework && input.command
    ? {
        framework: input.framework,
        command: input.command,
        packageManager: input.packageManager ?? "pnpm",
      }
    : detectFramework(ws.root);

  if (!detected.command) {
    const err = new PreviewError(
      "preview_no_dev_command",
      `Cannot determine dev command for framework: ${detected.framework}`,
      { cwd: ws.root, packageManager: detected.packageManager },
    );
    throw err;
  }

  // Resolve the package manager BEFORE spawning. If it is genuinely
  // unavailable, fail with a typed error — never surface a bare exit 127.
  let resolvedPackageManager: ResolvedPackageManager | null = null;
  if (detected.packageManager !== "npx") {
    const resolved = resolvePackageManager(detected.packageManager, ws.root);
    if (!resolved.found) {
      const err = new PreviewError(
        "preview_package_manager_missing",
        `Package manager "${detected.packageManager}" not found on PATH. ` +
          `The terminal-server image must have it installed (corepack for pnpm).`,
        {
          packageManager: detected.packageManager,
          pathSearched: resolved.pathSearched,
          runtimeNodePath: process.execPath,
          cwd: ws.root,
          suggestedRemediation:
            "Ensure the Dockerfile runner stage runs `corepack enable && corepack prepare pnpm@9.15.0 --activate`, " +
            "or set NODE_BIN_DIR to a directory containing the package manager.",
        },
      );
      // Record a failed runtime so the status endpoint can report it.
      const port = await allocateFreePort();
      const runtime: PreviewRuntime = {
        workspaceId,
        userId,
        projectId: ws.projectId,
        process: null,
        port,
        framework: detected.framework,
        command: detected.command,
        status: "failed",
        startedAt: Date.now(),
        lastHealthCheck: null,
        clerkEnvFingerprint: newFingerprint,
        clerkProjectEnv: storedClerkEnv,
        error: err.message,
        errorCode: err.code,
        logs: [
          `[preview] Package manager "${detected.packageManager}" not found on PATH`,
          `[preview] PATH searched: ${resolved.pathSearched}`,
          `[preview] Runtime Node: ${process.execPath}`,
          `[preview] Suggested: ${err.diagnostic.suggestedRemediation}`,
        ],
      };
      runtimes.set(workspaceId, runtime);
      releasePort(port);
      throw err;
    }
    resolvedPackageManager = resolved;
  }

  if (resolvedPackageManager) {
    await installWorkspaceDependencies(
      ws.root,
      detected.packageManager,
      resolvedPackageManager.executable,
    );
  }

  const port = await allocateFreePort();

  // Build the actual command, replacing $PORT with the allocated port
  const actualCommand = detected.command.replace("$PORT", String(port));

  // Construct a robust, non-interactive PATH. The child must not depend on
  // .bashrc / .profile / NVM init — a Railway service is non-interactive.
  const childPath = buildChildPath(ws.root);

  // Bind host follows the parent terminal-server's own resolved policy —
  // see previewBindHost() / ../network-bind.ts.
  // Project env (project secrets, then workspace .env/.env.local) is
  // merged over the allowlisted container vars — never the reverse.
  const env: Record<string, string> = {
    ...buildPreviewEnv(projectEnv),
    PATH: childPath,
    PORT: String(port),
    HOSTNAME: previewBindHost(),
    // Override NODE_ENV=production (inherited from Railway) to development
    // for the dev server. Next.js warns about non-standard NODE_ENV values
    // and pnpm skips devDependencies when NODE_ENV=production.
    NODE_ENV: "development",
    // Allow pnpm to add deps to the workspace root if Next.js auto-installs
    // TypeScript deps during dev server startup. Without this, pnpm rejects
    // the auto-install with ERR_PNPM_ADDING_TO_ROOT.
    NPM_CONFIG_IGNORE_WORKSPACE_ROOT_CHECK: "true",
  };

  // Service users on Railway often lack nvm-installed Node/pnpm in PATH.
  // Prepend the Node bin directory so package manager binaries are found.
  const nodeBinDir = process.env.NODE_BIN_DIR?.trim();
  if (nodeBinDir) {
    env.PATH = `${nodeBinDir}${env.PATH ? ":" + env.PATH : ""}`;
  }

  // For Next.js, set PORT and HOSTNAME
  if (detected.framework === "nextjs") {
    env.PORT = String(port);
    env.HOSTNAME = previewBindHost();
  }

  // ─── Clerk env normalization ──────────────────────────────────────
  // The terminal-server may have CLERK_PUBLISHABLE_KEY but not
  // NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (the var name @clerk/nextjs
  // expects). Map it so the preview runtime gets the right var.
  // Also clean whitespace/newlines/quotes that sneak in from Railway
  // variable editing or copy-paste.
  if (
    !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    env.CLERK_PUBLISHABLE_KEY
  ) {
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = cleanEnvValue(env.CLERK_PUBLISHABLE_KEY);
  }
  if (env.CLERK_SECRET_KEY) {
    env.CLERK_SECRET_KEY = cleanEnvValue(env.CLERK_SECRET_KEY);
  }
  if (env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = cleanEnvValue(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  }

  // ─── Clerk config validation ─────────────────────────────────────
  // Validate BEFORE spawning so we surface a truthful configuration
  // error instead of a 60-second timeout masking a Clerk 500.
  const clerkValidation = validateClerkConfig(env, ws.root);
  if (!clerkValidation.ok) {
    const err = new PreviewError(
      "preview_clerk_config_error",
      clerkValidation.reason ?? "Clerk configuration is invalid",
      {
        cwd: ws.root,
        suggestedRemediation:
          "Provide both keys for this project — via its Studio project " +
          "secrets, the workspace .env.local, or the terminal-server " +
          "Railway env. Check that CLERK_SECRET_KEY starts with sk_test_ " +
          "or sk_live_, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY starts with " +
          "pk_test_ or pk_live_, both are from the same Clerk environment, " +
          "and neither has whitespace or quotes.",
      },
    );
    const failedPort = await allocateFreePort();
    const fingerprint = fingerprintClerkEnv(env);
    const failedRuntime: PreviewRuntime = {
      workspaceId,
      userId,
      projectId: ws.projectId,
      process: null,
      port: failedPort,
      framework: detected.framework,
      command: actualCommand,
      status: "failed",
      startedAt: Date.now(),
      lastHealthCheck: null,
      clerkEnvFingerprint: newFingerprint,
      clerkProjectEnv: storedClerkEnv,
      error: err.message,
      errorCode: err.code,
      logs: [
        ...preservedLogs,
        `[preview] Clerk configuration error: ${err.message}`,
        `[preview] Clerk env fingerprint: ${JSON.stringify(fingerprint)}`,
        `[preview] Suggested: ${err.diagnostic.suggestedRemediation}`,
      ],
    };
    runtimes.set(workspaceId, failedRuntime);
    releasePort(failedPort);
    throw err;
  }

  const runtime: PreviewRuntime = {
    workspaceId,
    userId,
    projectId: ws.projectId,
    process: null,
    port,
    framework: detected.framework,
    command: actualCommand,
    status: "starting",
    startedAt: Date.now(),
    lastHealthCheck: null,
    clerkEnvFingerprint: newFingerprint,
    clerkProjectEnv: storedClerkEnv,
    error: null,
    errorCode: null,
    logs: [...preservedLogs],
  };

  runtimes.set(workspaceId, runtime);

  // Parse command into shell + args
  const isWin = process.platform === "win32";
  const shell = isWin ? "powershell.exe" : "bash";
  const shellArgs = isWin
    ? ["-NoProfile", "-Command", actualCommand]
    : ["-c", actualCommand];

  pushLog(runtime, `[preview] Starting ${detected.framework} on port ${port}: ${actualCommand}`);
  pushLog(runtime, `[preview] PATH: ${childPath}`);
  pushLog(runtime, `[preview] Runtime Node: ${process.execPath}`);

  // Log a redacted fingerprint of the Clerk env so we can diagnose
  // which key the runtime received without ever logging the full value.
  if (clerkValidation.usesClerk) {
    const fingerprint = fingerprintClerkEnv(env);
    pushLog(runtime, `[preview] Clerk env fingerprint: ${JSON.stringify(fingerprint)}`);
  }

  const child = spawn(shell, shellArgs, {
    cwd: ws.root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  runtime.process = child;

  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString("utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      pushLog(runtime, line);
      // Dev servers that auto-increment on EADDRINUSE (next dev: "Port
      // 4100 is in use, trying 4101") announce the port they actually
      // bound — retarget the runtime so the probe and proxy never point
      // at the squatter on the allocated port.
      const bound = detectBoundPort(line);
      if (bound) adoptBoundPort(runtime, bound);
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString("utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      pushLog(runtime, `[stderr] ${line}`);
      const bound = detectBoundPort(line);
      if (bound) adoptBoundPort(runtime, bound);
    }
  });

  child.on("exit", (code, signal) => {
    pushLog(runtime, `[preview] Process exited: code=${code} signal=${signal}`);
    if (runtime.status !== "stopped" && runtime.status !== "failed") {
      // Map exit 127 to a typed, actionable error.
      if (code === 127) {
        runtime.errorCode = "preview_command_not_found";
        runtime.error =
          `Command not found (exit 127): "${actualCommand}". ` +
          `The package manager or dev binary is not on the child PATH. ` +
          `PATH: ${childPath}`;
      } else {
        runtime.errorCode = "preview_dev_server_failed";
        const recentOutput = formatPreviewDiagnostic(runtime.logs);
        runtime.error = [
          `Dev server process exited (code=${code}, signal=${signal})`,
          recentOutput ? `Recent output:\n${recentOutput}` : "",
        ].filter(Boolean).join("\n");
      }
      runtime.status = "failed";
    }
    runtime.process = null;
    releasePort(runtime.port);
  });

  child.on("error", (err) => {
    pushLog(runtime, `[preview] Spawn error: ${err.message}`);
    runtime.status = "failed";
    runtime.errorCode = "preview_spawn_error";
    runtime.error = err.message;
    runtime.process = null;
    releasePort(runtime.port);
  });

  // Health probe in background — don't block the response. The resolver
  // follows runtime.port so a dev server that announced a different
  // bound port (auto-increment) is probed where it actually listens.
  probeHealth(() => runtime.port, HEALTH_PROBE_TIMEOUT_MS)
    .then((result) => {
      runtime.lastHealthCheck = Date.now();
      if (result.healthy && runtime.status === "starting") {
        runtime.status = "ready";
        pushLog(runtime, `[preview] Health check passed — ready on port ${runtime.port}`);
      } else if (result.rootRouteMissing && runtime.status === "starting") {
        runtime.status = "failed";
        runtime.errorCode = "preview_root_route_missing";
        runtime.error = [
          "The preview server is running, but GET / returned 404 (Cannot GET /).",
          "The detected dev server does not expose the project entry route at /.",
          "Fix the project's dev command or serve index.html from the root, then restart preview.",
        ].join(" ");
        pushLog(runtime, `[preview] Root route missing (HTTP ${result.status})`);
      } else if (result.authConfigError && runtime.status === "starting") {
        // Server booted but Clerk/auth config is broken — surface the
        // real error, not a generic timeout.
        runtime.status = "failed";
        runtime.errorCode = "preview_auth_config_error";
        runtime.error = [
          `Dev server booted but returned a ${result.status} with an ` +
            "authentication configuration error.",
          result.bodySnippet
            ? `Response body:\n${result.bodySnippet}`
            : "",
          "This is NOT a generic preview failure. The Clerk secret key " +
            "or publishable key is invalid, stale, or mismatched. Check " +
            "the Clerk env fingerprint in the preview logs and update " +
            "the keys in the terminal-server Railway env or workspace " +
            ".env.local.",
        ].filter(Boolean).join("\n");
        pushLog(runtime, `[preview] Auth config error (HTTP ${result.status})`);
        if (result.bodySnippet) {
          pushLog(runtime, `[preview] ${result.bodySnippet.slice(0, 500)}`);
        }
      } else if (!result.healthy && runtime.status === "starting") {
        runtime.status = "failed";
        runtime.errorCode = "preview_port_never_ready";
        runtime.error = `Dev server did not become healthy within ${HEALTH_PROBE_TIMEOUT_MS / 1000}s`;
        pushLog(runtime, `[preview] Health check failed — timeout`);
      }
    })
    .catch(() => {
      if (runtime.status === "starting") {
        runtime.status = "failed";
        runtime.errorCode = "preview_port_never_ready";
        runtime.error = "Health check threw an error";
      }
    });

  return runtime;
}

export function stopPreview(workspaceId: string): void {
  const rt = runtimes.get(workspaceId);
  if (!rt) return;

  rt.status = "stopped";
  if (rt.process) {
    const proc = rt.process;
    const pid = proc.pid;
    try {
      // Kill the entire process group (negative PID) so child processes
      // (pnpm → next dev) are also terminated.
      if (pid) process.kill(-pid, "SIGTERM");
    } catch {
      try { proc.kill("SIGTERM"); } catch {}
    }
    // Force kill after 5s
    setTimeout(() => {
      try { if (pid) process.kill(-pid, "SIGKILL"); } catch {}
      try { proc.kill("SIGKILL"); } catch {}
    }, 5000);
    rt.process = null;
  }
  releasePort(rt.port);
  pushLog(rt, "[preview] Stopped");
}

/**
 * Stop a preview and wait for the process to actually exit so the port
 * is released. Use this before rebinding to the same port.
 */
export async function stopPreviewAndWait(workspaceId: string): Promise<void> {
  const rt = runtimes.get(workspaceId);
  if (!rt) return;

  rt.status = "stopped";
  if (rt.process) {
    const proc = rt.process;
    const pid = proc.pid;
    const exitPromise = new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
      setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
        // Also try killing the process group
        try { if (pid) process.kill(-pid, "SIGKILL"); } catch {}
      }, 5000);
      setTimeout(resolve, 7000);
    });
    try {
      // Kill the entire process group (negative PID) so child processes
      // (pnpm → next dev) are also terminated, not just the shell.
      if (pid) process.kill(-pid, "SIGTERM");
    } catch {
      // Fallback: kill just the process
      try { proc.kill("SIGTERM"); } catch {}
    }
    rt.process = null;
    await exitPromise;
  }
  // The tracked child exiting does not guarantee the port is free — a
  // detached grandchild (pnpm → next dev) can keep it bound, and that
  // squatter would then be re-allocated to the next preview and serve
  // it the wrong app. Wait briefly for the OS to release it; if an
  // orphan survives, allocateFreePort will simply skip this port.
  const port = rt.port;
  if (await waitForPortFree(port, previewBindHost(), 5000)) {
    pushLog(rt, `[preview] Port ${port} released`);
  } else {
    pushLog(rt, `[preview] Port ${port} still bound after stop — an orphaned process may still own it`);
  }
  releasePort(port);
  pushLog(rt, "[preview] Stopped (waited for exit)");
}

export async function restartPreview(
  workspaceId: string,
  projectEnv?: Record<string, string>,
): Promise<PreviewRuntime> {
  const rt = runtimes.get(workspaceId);
  if (!rt) throw new Error("No preview runtime to restart");

  rt.status = "restarting";
  pushLog(rt, "[preview] Restarting...");

  // Stop current process and wait for it to actually exit so the port
  // is released before we try to rebind. A 1-second delay is not enough
  // for Next.js/Turbopack to release the port — it causes EADDRINUSE.
  await stopPreviewAndWait(workspaceId);

  // Wait for the port to actually be free. The OS may hold the socket
  // in TIME_WAIT even after the process exits — and a detached
  // grandchild can keep it bound indefinitely.
  const port = rt.port;
  if (await waitForPortFree(port, previewBindHost(), 5000)) {
    pushLog(rt, `[preview] Port ${port} is free`);
  } else {
    pushLog(rt, `[preview] Port ${port} never freed up — allocation will skip it if still bound`);
  }

  // Start again with same config. A freshly provided projectEnv wins;
  // otherwise reuse the env this runtime was started with, so an
  // explicit restart never silently drops the resolved Clerk keys.
  // forceRestart bypasses the reuse-a-healthy-runtime optimization —
  // an explicit restart always means a fresh dev server.
  return startPreview({
    workspaceId,
    userId: rt.userId,
    framework: rt.framework,
    command: rt.command,
    packageManager: "pnpm",
    projectEnv: projectEnv ?? rt.clerkProjectEnv ?? undefined,
    forceRestart: true,
  });
}

/**
 * Restart the preview ONLY if the resolved project env changed since
 * the runtime started. Returns whether a restart happened.
 *
 * This is the hook for secret rotation: when the project's configured
 * Clerk keys change, the caller re-resolves them and calls this — the
 * preview is recreated with the new env, without a disruptive restart
 * when nothing changed. When no runtime exists, nothing happens and
 * the caller should start one normally.
 */
export async function ensurePreviewEnv(
  workspaceId: string,
  userId: string,
  projectEnv?: Record<string, string>,
): Promise<{ restarted: boolean; runtime: PreviewRuntime | null }> {
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    throw new PreviewError(
      "preview_workspace_not_found",
      `Workspace not found: ${workspaceId}`,
      { cwd: null },
    );
  }
  if (ws.userId !== userId) throw new Error("Forbidden");
  if (!ws.ready) throw new Error("Workspace not ready");

  const existing = runtimes.get(workspaceId);
  if (!existing) return { restarted: false, runtime: null };

  const newFingerprint = fingerprintProjectEnv(
    resolvePreviewProjectEnv(projectEnv, ws.root),
  );
  if (shouldReuseRuntime(existing, newFingerprint)) {
    return { restarted: false, runtime: existing };
  }

  const runtime = await startPreview({ workspaceId, userId, projectEnv });
  return { restarted: true, runtime };
}

/**
 * Verify that a preview runtime is actually alive — the process
 * exists AND HTTP health check passes. Used by GET /preview to
 * avoid trusting stale DB state.
 */
export async function verifyPreviewHealth(workspaceId: string): Promise<boolean> {
  const rt = runtimes.get(workspaceId);
  if (!rt || !rt.process || rt.status !== "ready") return false;

  try {
    const resp = await fetch(`http://127.0.0.1:${rt.port}/`, {
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      rt.lastHealthCheck = Date.now();
      return true;
    }
    if (resp.status === 404) {
      rt.status = "failed";
      rt.errorCode = "preview_root_route_missing";
      rt.error = "The preview server is running, but GET / returned 404 (Cannot GET /). Fix the project's root entry route and restart preview.";
      pushLog(rt, "[preview] Root route missing during live health check (HTTP 404)");
      return false;
    }
    // Detect auth config errors on live health checks too
    if (resp.status >= 500) {
      const body = await resp.text().catch(() => "");
      if (detectAuthConfigError(body)) {
        rt.status = "failed";
        rt.errorCode = "preview_auth_config_error";
        rt.error =
          `Health check detected an authentication configuration error ` +
          `(HTTP ${resp.status}). The Clerk secret key or publishable ` +
          "key is invalid, stale, or mismatched.";
        pushLog(rt, `[preview] Auth config error detected during health check (HTTP ${resp.status})`);
        return false;
      }
    }
  } catch {
    // Process may have died
  }

  // Process is dead — update status
  rt.status = "failed";
  rt.errorCode = "preview_dev_server_failed";
  rt.error = "Health check failed — process may have crashed";
  return false;
}

// ─── Proxy-time servability guard (2026-09-18) ──────────────────────
// The public preview proxy (/preview/:workspaceId) is the last mile to
// the user's eyes, but it only checked the IN-MEMORY runtime status
// ("ready" + port) — never whether the backend is still serving the app.
// When the process on the recorded port stopped serving the entry route
// (a stale/wrong server on the port, a crash between the status check
// and the proxy), the iframe showed the backend's white "Cannot GET /"
// while every badge still said "Preview ready".
//
// The proxy now applies the same entry-route invariant the health probe
// uses: a 404 on / at proxy time flips the runtime to failed and serves
// an honest error page — never the raw backend 404.

/**
 * Whether a proxied request path is the preview entry path.
 * Only the entry document determines "the app loads" — asset 404s
 * (/_next/static/..., /favicon.ico, ...) are normal and must never fail
 * the runtime.
 */
export function isPreviewEntryPath(strippedPath: string): boolean {
  const path = strippedPath.split("?")[0].split("#")[0];
  return path === "" || path === "/";
}

/**
 * Decide what the preview proxy should do with a backend response.
 * A 404 on the entry path means the thing on the preview port is not
 * serving the app — the proxy must not forward that as a ready preview.
 */
export function decideProxiedEntryResponse(
  strippedPath: string,
  backendStatus: number,
): "proxy" | "entry_route_missing" {
  if (backendStatus === 404 && isPreviewEntryPath(strippedPath)) {
    return "entry_route_missing";
  }
  return "proxy";
}

/**
 * Flip a preview runtime to failed because the backend 404'd the entry
 * path at proxy time. Mirrors verifyPreviewHealth's rootRouteMissing flip
 * so every surface (status endpoint, UI badge, proxy) converges on the
 * same truth. Returns true when a runtime was flipped.
 */
export function markPreviewRootRouteMissing(workspaceId: string): boolean {
  const rt = runtimes.get(workspaceId);
  if (!rt || rt.status === "failed" || rt.status === "stopped") return false;
  rt.status = "failed";
  rt.errorCode = "preview_root_route_missing";
  rt.error =
    "The preview server is running, but GET / returned 404 (Cannot GET /). Fix the project's root entry route and restart preview.";
  pushLog(rt, "[preview] Entry route 404 at proxy time — runtime marked failed");
  return true;
}

/**
 * Flip a preview runtime to failed because the backend connection failed
 * at proxy time (the process died between the status check and the
 * proxy). Returns true when a runtime was flipped.
 */
export function markPreviewBackendUnreachable(workspaceId: string): boolean {
  const rt = runtimes.get(workspaceId);
  if (!rt || rt.status === "failed" || rt.status === "stopped") return false;
  rt.status = "failed";
  rt.errorCode = "preview_dev_server_failed";
  rt.error =
    "The preview proxy could not reach the dev server — the process may have crashed. Restart preview to try again.";
  pushLog(rt, "[preview] Backend unreachable at proxy time — runtime marked failed");
  return true;
}

export interface PreviewErrorPageOpts {
  heading: string;
  message: string;
  command?: string | null;
  framework?: string | null;
  errorCode?: string | null;
  workspaceId: string;
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Honest, self-contained error page for the preview iframe. Served by the
 * proxy when the backend cannot produce the app — the user sees what
 * happened and what to do, never a bare backend 404. Notifies the Studio
 * parent window so the "Preview ready" badge flips without waiting for
 * the next status poll.
 */
export function buildPreviewErrorPage(opts: PreviewErrorPageOpts): string {
  const heading = escapeHtmlAttr(opts.heading);
  const message = escapeHtmlAttr(opts.message);
  const command = escapeHtmlAttr(opts.command ?? "unknown");
  const framework = escapeHtmlAttr(opts.framework ?? "unknown");
  const errorCode = escapeHtmlAttr(opts.errorCode ?? "preview_error");
  const workspaceId = escapeHtmlAttr(opts.workspaceId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading} — LiTT Preview</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0a0a0b; color: #e4e4e7; font-family: system-ui, -apple-system, sans-serif; }
  .card { max-width: 560px; margin: 24px; padding: 32px; border: 1px solid #27272a; border-radius: 12px;
          background: #111113; }
  h1 { font-size: 20px; margin: 0 0 12px; color: #fafafa; }
  p { font-size: 14px; line-height: 1.6; color: #a1a1aa; margin: 0 0 16px; }
  .meta { font-size: 12px; color: #71717a; border-top: 1px solid #27272a; padding-top: 16px; }
  .meta div { margin: 4px 0; }
  code { background: #1c1c1f; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #d4d4d8; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; margin-right: 8px; }
</style>
</head>
<body>
  <div class="card">
    <h1><span class="dot"></span>${heading}</h1>
    <p>${message}</p>
    <p>Restart the preview from Studio — if it still fails, check the preview logs for the dev server output.</p>
    <div class="meta">
      <div>Command: <code>${command}</code></div>
      <div>Framework: <code>${framework}</code> &middot; Error: <code>${errorCode}</code></div>
    </div>
  </div>
  <script>
    try {
      window.parent.postMessage(
        { source: "litt-preview", type: "preview-entry-missing", workspaceId: "${workspaceId}" },
        "*"
      );
    } catch (e) { /* parent unreachable — the page itself is the message */ }
  </script>
</body>
</html>`;
}

/**
 * Stop all previews for a given user (used on workspace cleanup).
 */
export function stopAllPreviewsForUser(userId: string): void {
  for (const [workspaceId, rt] of runtimes) {
    if (rt.userId === userId) {
      stopPreview(workspaceId);
    }
  }
}
