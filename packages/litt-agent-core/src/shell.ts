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
import { buildChildEnv } from "./child-env.js";
import type { ShellExecutor, ShellExecuteOptions, ShellResult, StreamChunk } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

/**
 * After a child emits "exit", stdio streams can stay open indefinitely
 * when an orphaned grandchild inherited the pipe handles — "close" then
 * never fires and execute() hangs forever (observed: mission stuck in
 * "verifying" 16+ min with no live process). Give streams this long to
 * flush, then force-destroy them.
 */
const STDIO_CLOSE_GRACE_MS = 2_000;
/** Hard fallback if "close" still hasn't fired after streams destroyed. */
const EXIT_FALLBACK_MS = 1_000;

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
  "path", "prompt", "title", "ver", "vol", "chdir",
  "chcp", "chkntfs", "color", "tree", "where",
  "assoc", "ftype", "pushd", "popd", "setlocal", "endlocal",
  "call", "exit", "rem", "if", "for", "goto",
  // NOTE: "date", "time", and "label" are deliberately absent — the
  // cmd.exe builtins are interactive setters that PROMPT for input
  // (e.g. `date +%Y` hangs at "Enter the new date:"). Resolving them
  // via PATH finds real executables (Git's date.exe/time.exe) whose
  // read semantics match what agents expect; with none installed the
  // command fails cleanly instead of hanging until the timeout.
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
  const shims = ["pnpm", "npm", "npx", "yarn", "pnpx", "litt"];
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

/**
 * cmd.exe metacharacters and whitespace that require quoting. Inside a
 * quoted cmd token, & | < > are literal; "%VAR%" still expands (cmd has
 * no escape for it) but quoting keeps the token grouped. A literal '"'
 * cannot be escaped for cmd's own parser — we double it ("") which
 * CommandLineToArgvW/MSVCRT argv collapse back to a single '"' for the
 * child while cmd's separator scan stays inside quotes.
 */
const CMD_NEEDS_QUOTES_RE = /[\s"&|<>^%]/;

function quoteCmdToken(token: string): string {
  if (token === "") return '""';
  if (CMD_NEEDS_QUOTES_RE.test(token)) {
    return `"${token.replace(/"/g, '""')}"`;
  }
  return token;
}

/**
 * Build the full cmd.exe command line for a shell-resolved invocation.
 *
 * Node's spawn({shell:true}) joins file+args with bare spaces and hands
 * the result to `cmd.exe /d /s /c "..."` — it does NOT quote the file.
 * A .cmd shim under a path with spaces (e.g. "C:\Program Files\
 * nodejs\npm.cmd") then fails with `'C:\Program' is not recognized`,
 * and raw args let cmd metacharacters (& | < > ^ %) inject commands —
 * silently breaking the documented "no shell" contract of project.run.
 * Quoting every token restores that contract.
 */
function buildCmdCommandLine(command: string, args: string[]): string {
  return [quoteCmdToken(command), ...args.map(quoteCmdToken)].join(" ");
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
    // Unix: detached spawn creates a dedicated process group whose
    // group id is the child's PID. Signal the entire group atomically.
    //
    // This avoids a race in the old child-first approach:
    // killing the child can cause the parent shell to exit before the
    // parent PID is recorded, producing an empty killed[] even though
    // cancellation actually succeeded.
    try {
      process.kill(-pid, "SIGTERM");
      killed.push(pid);
      return killed;
    } catch {
      // The child may not be a process-group leader (for example if
      // detached spawning was unavailable). Fall through to the
      // portable child/parent fallback below.
    }

    // Fallback: kill children first, then parent
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
  /**
   * ALL in-flight children. A single slot was a real bug: the agent
   * loop dispatches parallel read-only tool calls, each overwrote
   * `_child`, and cancel() then killed only the last spawn — earlier
   * children became untracked orphans that could hang forever.
   * `_cancelled` was likewise shared: a later execute() reset the flag
   * mid-cancel for every in-flight command.
   */
  private _active = new Set<{ child: import("child_process").ChildProcess; cancelled: boolean }>();

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
      stdin,
    } = options;

    const t0 = Date.now();
    // Allowlisted host env + explicit layers. Never re-merge raw process.env:
    // a filtered `env` argument that simply omits a secret would otherwise
    // leave the host value in the child (`printenv TERMINAL_INTERNAL_SERVICE_KEY`).
    const mergedEnv = buildChildEnv(process.env, [this._env, env]);

    // Resolve the actual executable path (handles Windows .CMD shims)
    const resolved = resolveCommand(command);

    // Lets the catch path release the tracking slot if anything throws
    // between spawn and the settle await — otherwise a dead entry would
    // linger in _active (harmless to cancel(), but a slow leak).
    let releaseActive: (() => void) | null = null;

    try {
      // Use spawn for streaming support.
      // For Windows .CMD shims, we set shell:true (required for .cmd/.bat)
      // but must build the command line ourselves — see buildCmdCommandLine.
      // For real executables (.exe, git, node), shell is false.
      const useShell = resolved.useShell;
      const spawnFile = useShell
        ? buildCmdCommandLine(resolved.command, [...resolved.args, ...args])
        : resolved.command;
      const spawnArgs = useShell ? [] : [...resolved.args, ...args];
      const child = spawn(spawnFile, spawnArgs, {
        cwd,
        env: mergedEnv,
        windowsHide: true,
        shell: useShell,
        // detached=true allows process-tree kill (taskkill /T on Windows,
        // pkill -P on Linux). On Linux, this creates a new process group
        // which may fail in restricted containers. We catch the error and
        // retry without detached if spawn fails.
        detached: process.platform !== "win32",
      });

      const active = { child, cancelled: false };
      this._active.add(active);
      releaseActive = () => { this._active.delete(active); };

      // Pipe explicit stdin to the child, then EOF. Without this, commands
      // that read stdin (e.g. `git commit --file=-`) block forever.
      if (stdin !== undefined) {
        try {
          child.stdin?.write(stdin);
          child.stdin?.end();
        } catch {
          // If stdin is unavailable the child sees EOF; don't fail the spawn.
        }
      }

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
        let procExitCode: number | null = null;
        let settled = false;
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        let hardTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (code: number | null) => {
          if (settled) return;
          settled = true;
          if (graceTimer) clearTimeout(graceTimer);
          if (hardTimer) clearTimeout(hardTimer);
          resolve(code ?? -1);
        };
        child.on("error", (err) => {
          // Log the actual spawn error for debugging — the default
          // behavior silently returns -1 which masks the root cause.
          console.error(`[ShellExecutor] spawn error for "${resolved.command}":`, err.message);
          finish(-1);
        });
        child.on("exit", (code) => {
          procExitCode = code ?? -1;
          // "close" waits for stdio streams to end. An orphaned
          // grandchild that inherited our pipes keeps them open after
          // the process tree is dead — "close" then NEVER fires and
          // execute() hangs forever (the observed mission stall). Give
          // streams a grace period to flush, then force-destroy them;
          // a hard fallback resolves even if "close" still doesn't fire.
          graceTimer = setTimeout(() => {
            try { child.stdout?.destroy(); } catch { /* already closed */ }
            try { child.stderr?.destroy(); } catch { /* already closed */ }
            try { child.stdin?.destroy(); } catch { /* already closed */ }
            hardTimer = setTimeout(() => finish(procExitCode), EXIT_FALLBACK_MS);
            hardTimer.unref?.();
          }, STDIO_CLOSE_GRACE_MS);
          graceTimer.unref?.();
        });
        child.on("close", (code) => finish(procExitCode ?? code ?? -1));
      });

      if (timeoutHandle) clearTimeout(timeoutHandle);
      releaseActive?.();
      const durationMs = Date.now() - t0;
      const truncated = stdout.length > maxOutputBytes;

      // Determine discrete status
      let status: ShellResult["status"];
      if (active.cancelled) {
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
        error: status !== "success" ? (timedOut ? `Timeout after ${timeoutMs}ms` : active.cancelled ? "Cancelled by user" : `Exit code ${exitCode}`) : undefined,
        pid: child.pid ?? null,
      };
    } catch (err) {
      releaseActive?.();
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
   * Cancel ALL currently running commands on this executor.
   * Kills every tracked process tree to guarantee zero orphan processes.
   * Each in-flight execute() resolves with status: "cancelled".
   * Returns the combined list of PIDs that were killed.
   */
  async cancel(): Promise<number[]> {
    const active = [...this._active];
    const killed: number[] = [];
    for (const a of active) {
      a.cancelled = true;
      if (a.child.pid) {
        try {
          killed.push(...await killProcessTree(a.child.pid));
        } catch {
          // tree already gone — the execute() promise still resolves
          // via exit/close/fallback timers
        }
      }
    }
    return killed;
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
