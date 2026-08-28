/**
 * PreviewManager — owns one preview runtime per workspace.
 *
 * Lifecycle:
 *   stopped → starting → ready → (stopped | failed | restarting)
 *
 * On `start()`:
 *   1. Detect framework from package.json / files in workspace root
 *   2. Allocate a free internal port
 *   3. Spawn the dev server bound to 0.0.0.0:<port>
 *   4. Probe http://127.0.0.1:<port> until healthy
 *   5. Only then set status = "ready"
 *
 * The child process stdout/stderr is captured into a ring buffer
 * for the logs endpoint.
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
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
  logs: string[];
}

interface PreviewStartInput {
  workspaceId: string;
  userId: string;
  framework?: string;
  command?: string;
  packageManager?: string;
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
  throw new Error("No free preview ports available");
}

function releasePort(port: number): void {
  usedPorts.delete(port);
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
  if (hasPkgJson) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      devScript = pkg?.scripts?.dev ?? null;
    } catch {
      // ignore parse errors
    }
  }

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
  if (!ws) throw new Error("Workspace not found");
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
    throw new Error(`Cannot determine dev command for framework: ${detected.framework}`);
  }

  const port = allocatePort();

  // Build the actual command, replacing $PORT with the allocated port
  const actualCommand = detected.command.replace("$PORT", String(port));

  // Force bind to 0.0.0.0
  const env: Record<string, string> = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "0.0.0.0",
    HOME: ws.root,
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
      runtime.status = "failed";
      runtime.error = `Process exited unexpectedly (code=${code}, signal=${signal})`;
    }
    runtime.process = null;
    releasePort(port);
  });

  child.on("error", (err) => {
    pushLog(runtime, `[preview] Spawn error: ${err.message}`);
    runtime.status = "failed";
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
        runtime.error = `Dev server did not become healthy within ${HEALTH_PROBE_TIMEOUT_MS / 1000}s`;
        pushLog(runtime, `[preview] Health check failed — timeout`);
      }
    })
    .catch(() => {
      if (runtime.status === "starting") {
        runtime.status = "failed";
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
