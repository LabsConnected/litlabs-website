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

import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { delimiter as PATH_DELIMITER, dirname, join, resolve } from "path";
import { getWorkspace, type WorkspaceDescriptor } from "../workspace/WorkspaceManager";

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
}

interface PreviewStartInput {
  workspaceId: string;
  userId: string;
  framework?: string;
  command?: string;
  packageManager?: string;
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
  | "preview_no_dev_command";

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

function allocatePort(): number {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }
  throw new PreviewError(
    "preview_no_free_port",
    `No free preview ports available in range ${PORT_RANGE_START}-${PORT_RANGE_END}`,
  );
}

function releasePort(port: number): void {
  usedPorts.delete(port);
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
    return { framework: "nextjs", command: `${packageManager} dev`, packageManager };
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

async function probeHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok || resp.status === 404) {
        // 404 is still a response — server is running, just no route at /
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_PROBE_INTERVAL_MS));
  }
  return false;
}

// ─── Log buffer ────────────────────────────────────────────────────

function pushLog(runtime: PreviewRuntime, line: string): void {
  runtime.logs.push(line);
  if (runtime.logs.length > MAX_LOG_LINES) {
    runtime.logs.splice(0, runtime.logs.length - MAX_LOG_LINES);
  }
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

  // Stop existing runtime if any
  const existing = runtimes.get(workspaceId);
  if (existing) {
    stopPreview(workspaceId);
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
      const port = allocatePort();
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
  }

  const port = allocatePort();

  // Build the actual command, replacing $PORT with the allocated port
  const actualCommand = detected.command.replace("$PORT", String(port));

  // Construct a robust, non-interactive PATH. The child must not depend on
  // .bashrc / .profile / NVM init — a Railway service is non-interactive.
  const childPath = buildChildPath(ws.root);

  // Force bind to 0.0.0.0
  const env: Record<string, string> = {
    ...process.env,
    PATH: childPath,
    PORT: String(port),
    HOSTNAME: "0.0.0.0",
    HOME: ws.root,
  } as Record<string, string>;

  // For Next.js, set PORT and HOSTNAME
  if (detected.framework === "nextjs") {
    env.PORT = String(port);
    env.HOSTNAME = "0.0.0.0";
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
    error: null,
    errorCode: null,
    logs: [],
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

  const child = spawn(shell, shellArgs, {
    cwd: ws.root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  runtime.process = child;

  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString("utf-8").split("\n").filter(Boolean);
    for (const line of lines) pushLog(runtime, line);
  });

  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString("utf-8").split("\n").filter(Boolean);
    for (const line of lines) pushLog(runtime, `[stderr] ${line}`);
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
        runtime.error = `Dev server process exited (code=${code}, signal=${signal})`;
      }
      runtime.status = "failed";
    }
    runtime.process = null;
    releasePort(port);
  });

  child.on("error", (err) => {
    pushLog(runtime, `[preview] Spawn error: ${err.message}`);
    runtime.status = "failed";
    runtime.errorCode = "preview_spawn_error";
    runtime.error = err.message;
    runtime.process = null;
    releasePort(port);
  });

  // Health probe in background — don't block the response
  probeHealth(port, HEALTH_PROBE_TIMEOUT_MS)
    .then((healthy) => {
      runtime.lastHealthCheck = Date.now();
      if (healthy && runtime.status === "starting") {
        runtime.status = "ready";
        pushLog(runtime, `[preview] Health check passed — ready on port ${port}`);
      } else if (!healthy && runtime.status === "starting") {
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
    try {
      rt.process.kill("SIGTERM");
      // Force kill after 5s
      setTimeout(() => {
        try {
          rt.process?.kill("SIGKILL");
        } catch {}
      }, 5000);
    } catch {}
    rt.process = null;
  }
  releasePort(rt.port);
  pushLog(rt, "[preview] Stopped");
}

export async function restartPreview(workspaceId: string): Promise<PreviewRuntime> {
  const rt = runtimes.get(workspaceId);
  if (!rt) throw new Error("No preview runtime to restart");

  rt.status = "restarting";
  pushLog(rt, "[preview] Restarting...");

  // Stop current process
  if (rt.process) {
    try {
      rt.process.kill("SIGTERM");
    } catch {}
    rt.process = null;
  }
  releasePort(rt.port);

  // Small delay to let port free up
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Start again with same config
  return startPreview({
    workspaceId,
    userId: rt.userId,
    framework: rt.framework,
    command: rt.command,
    packageManager: "pnpm",
  });
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
    if (resp.ok || resp.status === 404) {
      rt.lastHealthCheck = Date.now();
      return true;
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
