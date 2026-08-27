/**
 * LiTT Desktop launcher.
 *
 * `litt desktop` routes here. Bare `litt` does NOT — it launches the Ink
 * cockpit inside the current terminal. This command opens the Desktop/Tauri
 * GUI surface, which shares the same canonical RuntimeSession as the cockpit.
 *
 * Responsibilities:
 * - resolve the caller's canonical project root
 * - persist trusted launch context for the native Desktop
 * - reuse/start the single shared runtime on :4001
 * - open/focus/restart the native LiTT Desktop safely
 *
 * Project identity is intentionally separate from the runtime's
 * server-managed execution workspace.
 */

import {
  execFileSync,
  execSync,
  spawn,
} from "node:child_process";

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { homedir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

import {
  c,
  detectProject,
  fail,
  header,
  ok,
  warn,
  resolveProjectCwd,
} from "../lib/utils.js";

const RUNTIME_PORT = 4001;
const RUNTIME_URL = `http://127.0.0.1:${RUNTIME_PORT}`;
const HEALTH_URL = `${RUNTIME_URL}/health`;

interface WorkspaceContext {
  cwd: string;
  updatedAt: string;
}

function getLiTTHome(): string {
  return process.env.LITT_HOME ?? join(homedir(), ".litt");
}

/**
 * Resolve the repository containing this CLI package rather than using
 * process.cwd(), because process.cwd() is the USER'S active project.
 */
function getLiTTRepoRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);

  // dist/commands/desktop.js
  // -> dist
  // -> litt-cli
  // -> packages
  // -> repo root
  return resolve(dirname(currentFile), "..", "..", "..", "..");
}

function normalizePath(value: string): string {
  return normalize(resolve(value)).toLowerCase();
}

function readWorkspaceContext(): WorkspaceContext | null {
  const contextPath = join(getLiTTHome(), "runtime", "desktop-cwd.json");

  if (!existsSync(contextPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      readFileSync(contextPath, "utf-8"),
    ) as Partial<WorkspaceContext>;

    if (typeof parsed.cwd !== "string" || !parsed.cwd.trim()) {
      return null;
    }

    return {
      cwd: parsed.cwd,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : "",
    };
  } catch {
    return null;
  }
}

/**
 * Write project identity only. No tokens, API keys, auth headers,
 * or other secrets belong in this file.
 */
function writeWorkspaceContext(cwd: string): void {
  const runtimeDir = join(getLiTTHome(), "runtime");
  mkdirSync(runtimeDir, { recursive: true });

  const contextPath = join(runtimeDir, "desktop-cwd.json");
  const tempPath = `${contextPath}.${process.pid}.tmp`;

  const context: WorkspaceContext = {
    cwd,
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(
    tempPath,
    `${JSON.stringify(context, null, 2)}\n`,
    "utf-8",
  );

  // Windows rename does not reliably replace an existing file.
  rmSync(contextPath, { force: true });
  renameSync(tempPath, contextPath);
}

function parseEnvFile(path: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  };

  if (!existsSync(path)) {
    return env;
  }

  const contents = readFileSync(path, "utf-8");

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match) {
      continue;
    }

    const [, name, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Existing process environment wins.
    if (!env[name]) {
      env[name] = value;
    }
  }

  return env;
}

async function runtimeReady(): Promise<boolean> {
  try {
    const response = await fetch(HEALTH_URL, {
      signal: AbortSignal.timeout(1500),
    });

    if (!response.ok) {
      return false;
    }

    const body = (await response.json()) as {
      status?: string;
      readiness?: string;
    };

    return body.status === "ok" && body.readiness === "ready";
  } catch {
    return false;
  }
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolveResult) => {
    const socket = createConnection({
      host: "127.0.0.1",
      port,
    });

    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveResult(value);
    };

    socket.setTimeout(500);

    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function ensureRuntime(repoRoot: string): Promise<boolean> {
  if (await runtimeReady()) {
    ok("LiTT Runtime: SHARED / READY");
    return true;
  }

  if (await portOpen(RUNTIME_PORT)) {
    fail(
      `Port ${RUNTIME_PORT} is occupied, but it is not a READY LiTT runtime.`,
    );
    console.error(
      `${c.dim}Refusing to kill or replace an unknown process.${c.reset}`,
    );
    return false;
  }

  const envFile = join(repoRoot, ".env.local");
  const env = parseEnvFile(envFile);

  if (
    (env.TERMINAL_INTERNAL_SERVICE_KEY ?? "").length < 32
  ) {
    fail("LiTT runtime configuration is missing.");
    console.error(
      `${c.dim}Expected TERMINAL_INTERNAL_SERVICE_KEY in ${envFile}${c.reset}`,
    );
    return false;
  }

  const logsDir = join(getLiTTHome(), "logs");
  mkdirSync(logsDir, { recursive: true });

  const runtimeLog = join(logsDir, "runtime.log");

  const stdoutFd = openSync(runtimeLog, "a");
  const stderrFd = openSync(runtimeLog, "a");

  try {
    const child =
      process.platform === "win32"
        ? spawn(
            "cmd.exe",
            ["/d", "/s", "/c", "pnpm terminal:dev"],
            {
              cwd: repoRoot,
              detached: true,
              windowsHide: true,
              stdio: ["ignore", stdoutFd, stderrFd],
              env,
            },
          )
        : spawn(
            "pnpm",
            ["terminal:dev"],
            {
              cwd: repoRoot,
              detached: true,
              stdio: ["ignore", stdoutFd, stderrFd],
              env,
            },
          );

    child.unref();
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  process.stdout.write("Starting shared LiTT Runtime");

  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (await runtimeReady()) {
      process.stdout.write("\n");
      ok("LiTT Runtime: SHARED / READY");
      return true;
    }

    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 500));
  }

  process.stdout.write("\n");
  fail("LiTT Runtime failed to become ready.");
  console.error(`${c.dim}Runtime log: ${runtimeLog}${c.reset}`);

  return false;
}

function findDesktopProcess(): number | null {
  try {
    if (process.platform === "win32") {
      const output = execSync(
        'tasklist /FI "IMAGENAME eq litt-shell.exe" /FO CSV /NH',
        {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();

      if (
        !output ||
        output.toLowerCase().includes("no tasks are running")
      ) {
        return null;
      }

      const firstLine = output.split(/\r?\n/)[0];
      const fields = firstLine
        .split(",")
        .map((field) => field.replace(/^"|"$/g, ""));

      // tasklist CSV:
      // image name, PID, session name, session #, memory usage
      const pid = Number.parseInt(fields[1] ?? "", 10);

      return Number.isFinite(pid) ? pid : null;
    }

    const output = execSync("pgrep -f litt-shell", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const firstPid = Number.parseInt(output.split(/\r?\n/)[0] ?? "", 10);

    return Number.isFinite(firstPid) ? firstPid : null;
  } catch {
    return null;
  }
}

function focusDesktop(pid: number): void {
  if (process.platform !== "win32") {
    return;
  }

  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ws = New-Object -ComObject WScript.Shell; [void]$ws.AppActivate(${pid})`,
      ],
      {
        windowsHide: true,
        stdio: "ignore",
      },
    );
  } catch {
    // Focusing is best-effort only.
  }
}

function stopDesktopExactly(pid: number): void {
  if (process.platform === "win32") {
    execFileSync(
      "taskkill.exe",
      ["/PID", String(pid), "/T", "/F"],
      {
        windowsHide: true,
        stdio: "ignore",
      },
    );

    return;
  }

  process.kill(pid, "SIGTERM");
}

function getDesktopExecutable(repoRoot: string): string | null {
  const override = process.env.LITT_DESKTOP_EXE;

  if (override && existsSync(override)) {
    return override;
  }

  const candidates =
    process.platform === "win32"
      ? [
          join(
            homedir(),
            "AppData",
            "Local",
            "litlabs",
            "litt-shell",
            "litt-shell.exe",
          ),
          join(
            repoRoot,
            "packages",
            "litt-shell",
            "src-tauri",
            "target",
            "release",
            "litt-shell.exe",
          ),

        ]
      : process.platform === "darwin"
        ? [
            "/Applications/LiTT.app/Contents/MacOS/LiTT",
            join(
              homedir(),
              "Applications",
              "LiTT.app",
              "Contents",
              "MacOS",
              "LiTT",
            ),
          ]
        : [
            "/usr/bin/litt-shell",
            "/usr/local/bin/litt-shell",
            join(
              homedir(),
              ".local",
              "share",
              "litt-shell",
              "litt-shell",
            ),
          ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  if (process.platform === "win32") {
    try {
      const result = execFileSync(
        "where.exe",
        ["litt-shell.exe"],
        {
          encoding: "utf-8",
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
        .trim()
        .split(/\r?\n/)
        .find(Boolean);

      if (result && existsSync(result)) {
        return result;
      }
    } catch {
      // Not available on PATH.
    }
  }

  return null;
}

async function launchDesktop(
  desktopPath: string,
  projectRoot: string,
): Promise<number> {
  header("Launching LiTT Desktop");

  try {
    const child = spawn(desktopPath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });

    child.unref();

    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, 750),
    );

    ok("LiTT Desktop launched");
    console.log(
      `${c.dim}Project: ${projectRoot}${c.reset}`,
    );

    return 0;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    fail(`Failed to launch LiTT Desktop: ${message}`);
    return 1;
  }
}

export async function desktopCommand(
  _args: string[],
): Promise<number> {
  const project = detectProject(resolveProjectCwd());
  const projectRoot = project.rootDir;

  const repoRoot = getLiTTRepoRoot();
  const previousContext = readWorkspaceContext();

  writeWorkspaceContext(projectRoot);

  const runtimeOk = await ensureRuntime(repoRoot);

  if (!runtimeOk) {
    return 1;
  }

  const desktopPath = getDesktopExecutable(repoRoot);

  if (!desktopPath) {
    fail("LiTT Desktop executable not found.");
    console.error("");
    console.error(
      `${c.dim}Expected a built native executable under packages/litt-shell/src-tauri/target.${c.reset}`,
    );
    return 1;
  }

  const existingPid = findDesktopProcess();

  if (existingPid) {
    const sameProject =
      previousContext !== null &&
      normalizePath(previousContext.cwd) ===
        normalizePath(projectRoot);

    if (sameProject) {
      focusDesktop(existingPid);

      ok(
        `LiTT Desktop already running (PID ${existingPid})`,
      );
      console.log(
        `${c.dim}Project: ${projectRoot}${c.reset}`,
      );

      return 0;
    }

    warn(
      `LiTT Desktop is switching projects; restarting exact PID ${existingPid}.`,
    );

    try {
      stopDesktopExactly(existingPid);
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 600),
      );
    } catch (error) {
      fail(
        `Could not restart LiTT Desktop safely: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );

      return 1;
    }
  }

  return await launchDesktop(
    desktopPath,
    projectRoot,
  );
}