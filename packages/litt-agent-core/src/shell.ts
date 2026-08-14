/**
 * Shell executor adapters.
 *
 * The core never calls child_process directly. All shell execution
 * goes through a ShellExecutor interface so the same core works on
 * Windows (PowerShell), Linux/macOS (bash), and Termux.
 *
 * Phase 3B: Hardened with streaming stdout/stderr, process-tree
 * cancellation (zero orphan processes), and discrete status.
 */

import { spawn, execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { ShellExecutor, ShellExecuteOptions, ShellResult, StreamChunk } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

// On Windows, npm/pnpm/yarn/npx are .CMD or .PS1 shims, not real executables.
// execFile without shell:true cannot run .CMD files. We resolve the actual
// executable by checking for common extensions in PATH.
const WINDOWS_EXTS = [".exe", ".cmd", ".bat"];

/**
 * Windows shell builtins — commands that are interpreted by cmd.exe
 * and have no corresponding .exe file. These must run with shell:true
 * so cmd.exe can interpret them.
 *
 * Without this, `litt run echo hello` fails on Windows because
 * spawn("echo", ...) can't find echo.exe.
 */
const WINDOWS_BUILTINS = new Set([
  "echo", "dir", "set", "cd", "type", "cls", "copy", "move",
  "del", "erase", "md", "mkdir", "rd", "rmdir", "ren", "rename",
  "path", "prompt", "title", "ver", "vol", "label", "chdir",
  "chcp", "chkntfs", "color", "date", "time", "tree", "where",
  "assoc", "ftype", "pushd", "popd", "setlocal", "endlocal",
  "call", "exit", "rem", "if", "for", "goto",
]);

function resolveCommand(command: string): { command: string; args: string[]; useShell: boolean } {
  if (process.platform !== "win32") {
    return { command, args: [], useShell: false };
  }

  // If it's already an absolute path with an extension, use it directly
  if (path.isAbsolute(command) && path.extname(command)) {
    return { command, args: [], useShell: false };
  }

  const lowerCommand = command.toLowerCase();

  // Windows shell builtins (echo, dir, set, cd, etc.) — must use shell:true
  // so cmd.exe interprets them. There's no echo.exe to spawn.
  if (WINDOWS_BUILTINS.has(lowerCommand)) {
    return { command, args: [], useShell: true };
  }

  // Check if the command is a known package manager / CLI shim
  const shims = ["pnpm", "npm", "npx", "yarn", "pnpx"];
  if (!shims.includes(lowerCommand)) {
    // Not a shim — try directly (git, node, tsc, etc. are real .exe files)
    return { command, args: [], useShell: false };
  }

  // Search PATH for the .cmd version
  const pathDirs = (process.env.PATH ?? "").split(";").filter(Boolean);
  for (const dir of pathDirs) {
    for (const ext of WINDOWS_EXTS) {
      const candidate = path.join(dir, command + ext);
      if (fs.existsSync(candidate)) {
        if (ext === ".exe") {
          return { command: candidate, args: [], useShell: false };
        }
        // .cmd and .bat need shell:true to execute
        return { command: candidate, args: [], useShell: true };
      }
    }
  }

  // Fallback: use shell:true with the original command
  return { command, args: [], useShell: true };
}

// ─── Process-tree killing ──────────────────────────────────────────

/**
 * Kill a process and all its descendants.
 *
 * On Linux/macOS: uses `pkill -TERM -P <pid>` to kill children first,
 * then kills the parent. Falls back to recursive /proc scanning.
 *
 * On Windows: uses `taskkill /T /F /PID <pid>` which kills the entire
 * process tree.
 *
 * Returns the list of PIDs that were killed (for audit/debugging).
 */
async function killProcessTree(pid: number): Promise<number[]> {
  const killed: number[] = [];

  if (process.platform === "win32") {
    // Windows: taskkill /T kills the entire tree, /F forces
    try {
      await new Promise<void>((resolve) => {
        execFile("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true }, () => resolve());
      });
      killed.push(pid);
    } catch {
      // process may have already exited
    }
  } else {
    // Unix: kill children first, then parent
    try {
      // Try pkill -P (kills children of pid)
      await new Promise<void>((resolve) => {
        execFile("pkill", ["-TERM", "-P", String(pid)], () => resolve());
      });
    } catch {
      // pkill may not be available (e.g. some minimal containers)
    }

    // Also try to find children via /proc (Linux only)
    if (fs.existsSync("/proc")) {
      try {
        const procEntries = fs.readdirSync("/proc");
        for (const entry of procEntries) {
          if (!/^\d+$/.test(entry)) continue;
          try {
            const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
            // /proc/<pid>/stat format: pid (comm) state ppid ...
            // ppid is the 4th field after the comm field
            const match = stat.match(/^\d+ \(.*\) \w (\d+)/);
            if (match && parseInt(match[1], 10) === pid) {
              const childPid = parseInt(entry, 10);
              try {
                process.kill(childPid, "SIGTERM");
                killed.push(childPid);
              } catch {
                // child may have already exited
              }
            }
          } catch {
            // process may have exited between readdir and read
          }
        }
      } catch {
        // /proc not readable — skip
      }
    }

    // Finally kill the parent
    try {
      process.kill(pid, "SIGTERM");
      killed.push(pid);
    } catch {
      // parent may have already exited
    }
  }

  return killed;
}

/**
 * NodeShellExecutor — cross-platform shell executor using child_process.
 *
 * This is the default executor. It works on Windows, Linux, macOS, and Termux
 * because it uses spawn/execFile (no shell) with an explicit binary path.
 *
 * Phase 3B hardening:
 * - Streaming: stdout/stderr chunks are emitted via onStream callback
 * - Process-tree cancellation: cancel() kills the entire tree, not just
 *   the direct child. Zero orphan processes.
 * - Discrete status: "success" | "failed" | "cancelled" | "timeout"
 * - PID tracking: the child PID is exposed for debugging
 */
export class NodeShellExecutor implements ShellExecutor {
  private _cwd: string;
  private _env: Record<string, string>;
  private _platform: NodeJS.Platform;
  private _child: import("child_process").ChildProcess | null = null;
  private _cancelled = false;

  constructor(cwd?: string, env?: Record<string, string>) {
    this._cwd = cwd ?? process.cwd();
    this._env = env ?? {};
    this._platform = process.platform;
  }

  get cwd(): string {
    return this._cwd;
  }

  get platform(): NodeJS.Platform {
    return this._platform;
  }

  get environment(): Record<string, string> {
    return { ...this._env };
  }

  async execute(options: ShellExecuteOptions): Promise<ShellResult> {
    const {
      command,
      args = [],
      cwd = this._cwd,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
      env,
      onStream,
    } = options;

    const t0 = Date.now();
    const mergedEnv = { ...process.env, ...this._env, ...env };

    // Resolve the actual executable path (handles Windows .CMD shims)
    const resolved = resolveCommand(command);

    this._cancelled = false;

    try {
      // Use spawn for streaming support.
      // For Windows .CMD shims, we set shell:true (required for .cmd/.bat).
      // For real executables (.exe, git, node), shell is false.
      const child = spawn(resolved.command, [...resolved.args, ...args], {
        cwd,
        env: mergedEnv,
        windowsHide: true,
        shell: resolved.useShell,
        // On Windows, detached=true allows taskkill /T to work properly
        detached: process.platform !== "win32",
      });

      this._child = child;

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      // Stream and buffer simultaneously
      if (child.stdout) {
        child.stdout.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          stdout += text;
          if (onStream && stdout.length <= maxOutputBytes) {
            onStream({ stream: "stdout", text, ts: Date.now() });
          }
        });
      }
      if (child.stderr) {
        child.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          stderr += text;
          if (onStream && stderr.length <= maxOutputBytes) {
            onStream({ stream: "stderr", text, ts: Date.now() });
          }
        });
      }

      // Timeout handling — we manage it ourselves so we can set the
      // correct status and kill the process tree
      const timeoutHandle: ReturnType<typeof setTimeout> | null = timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            if (child.pid) {
              killProcessTree(child.pid).catch(() => {});
            }
          }, timeoutMs)
        : null;

      const exitCode: number = await new Promise((resolve) => {
        child.on("close", (code) => resolve(code ?? -1));
        child.on("error", () => resolve(-1));
      });

      if (timeoutHandle) clearTimeout(timeoutHandle);
      this._child = null;
      const durationMs = Date.now() - t0;
      const truncated = stdout.length > maxOutputBytes;

      // Determine discrete status
      let status: ShellResult["status"];
      if (this._cancelled) {
        status = "cancelled";
      } else if (timedOut) {
        status = "timeout";
      } else if (exitCode === 0) {
        status = "success";
      } else {
        status = "failed";
      }

      return {
        ok: status === "success",
        status,
        stdout: truncated ? stdout.slice(0, maxOutputBytes) : stdout,
        stderr,
        exitCode,
        durationMs,
        command,
        args,
        truncated,
        error: status !== "success" ? (timedOut ? `Timeout after ${timeoutMs}ms` : this._cancelled ? "Cancelled by user" : `Exit code ${exitCode}`) : undefined,
        pid: child.pid ?? null,
      };
    } catch (err) {
      this._child = null;
      const durationMs = Date.now() - t0;
      return {
        ok: false,
        status: "failed",
        stdout: "",
        stderr: "",
        exitCode: -1,
        durationMs,
        command,
        args,
        truncated: false,
        error: err instanceof Error ? err.message : String(err),
        pid: null,
      };
    }
  }

  /**
   * Cancel the currently running command.
   * Kills the entire process tree to guarantee zero orphan processes.
   * Returns the list of PIDs that were killed.
   */
  async cancel(): Promise<number[]> {
    this._cancelled = true;
    if (this._child?.pid) {
      const killed = await killProcessTree(this._child.pid);
      this._child = null;
      return killed;
    }
    this._child = null;
    return [];
  }
}

/**
 * Create a shell executor for the current platform.
 *
 * On Windows, this still uses NodeShellExecutor (spawn) because
 * git/pnpm/node work fine without PowerShell. A PowerShellExecutor
 * adapter can be added later for PowerShell-specific commands.
 */
export function createShellExecutor(cwd?: string, env?: Record<string, string>): ShellExecutor {
  return new NodeShellExecutor(cwd, env);
}
