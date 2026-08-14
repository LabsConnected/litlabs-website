/**
 * Shell executor adapters.
 *
 * The core never calls child_process directly. All shell execution
 * goes through a ShellExecutor interface so the same core works on
 * Windows (PowerShell), Linux/macOS (bash), and Termux.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import type { ShellExecutor, ShellExecuteOptions, ShellResult } from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

// On Windows, npm/pnpm/yarn/npx are .CMD or .PS1 shims, not real executables.
// execFile without shell:true cannot run .CMD files. We resolve the actual
// executable by checking for common extensions in PATH.
const WINDOWS_EXTS = [".exe", ".cmd", ".bat"];

function resolveCommand(command: string): { command: string; args: string[]; useShell: boolean } {
  if (process.platform !== "win32") {
    return { command, args: [], useShell: false };
  }

  // If it's already an absolute path with an extension, use it directly
  if (path.isAbsolute(command) && path.extname(command)) {
    return { command, args: [], useShell: false };
  }

  // Check if the command is a known package manager / CLI shim
  const shims = ["pnpm", "npm", "npx", "yarn", "pnpx"];
  if (!shims.includes(command.toLowerCase())) {
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
 * NodeShellExecutor — cross-platform shell executor using child_process.execFile.
 *
 * This is the default executor. It works on Windows, Linux, macOS, and Termux
 * because it uses execFile (no shell) with an explicit binary path.
 *
 * It does NOT use PowerShell or bash. It runs the command binary directly.
 * For git, pnpm, node, etc. this is sufficient and platform-independent.
 */
export class NodeShellExecutor implements ShellExecutor {
  private _cwd: string;
  private _env: Record<string, string>;
  private _platform: NodeJS.Platform;
  private _child: import("child_process").ChildProcess | null = null;

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
    } = options;

    const t0 = Date.now();
    const mergedEnv = { ...process.env, ...this._env, ...env };

    // Resolve the actual executable path (handles Windows .CMD shims)
    const resolved = resolveCommand(command);

    try {
      // Use execFile for safety and cross-platform compatibility.
      // For Windows .CMD shims, we set shell:true (required for .cmd/.bat).
      // For real executables (.exe, git, node), shell is false.
      const child = execFile(resolved.command, [...resolved.args, ...args], {
        cwd,
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes,
        env: mergedEnv,
        windowsHide: true,
        shell: resolved.useShell,
      });

      this._child = child;

      let stdout = "";
      let stderr = "";

      if (child.stdout) {
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
      }
      if (child.stderr) {
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
      }

      const exitCode: number = await new Promise((resolve) => {
        child.on("close", (code) => resolve(code ?? -1));
        child.on("error", () => resolve(-1));
      });

      this._child = null;
      const durationMs = Date.now() - t0;
      const truncated = stdout.length > maxOutputBytes;

      return {
        ok: exitCode === 0,
        stdout: truncated ? stdout.slice(0, maxOutputBytes) : stdout,
        stderr,
        exitCode,
        durationMs,
        command,
        args,
        truncated,
        error: exitCode !== 0 ? `Exit code ${exitCode}` : undefined,
      };
    } catch (err) {
      this._child = null;
      const durationMs = Date.now() - t0;
      return {
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: -1,
        durationMs,
        command,
        args,
        truncated: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async cancel(): Promise<void> {
    if (this._child) {
      try {
        this._child.kill("SIGTERM");
      } catch {
        // ignore — process may have already exited
      }
      this._child = null;
    }
  }
}

/**
 * Create a shell executor for the current platform.
 *
 * On Windows, this still uses NodeShellExecutor (execFile) because
 * git/pnpm/node work fine without PowerShell. A PowerShellExecutor
 * adapter can be added later for PowerShell-specific commands.
 */
export function createShellExecutor(cwd?: string, env?: Record<string, string>): ShellExecutor {
  return new NodeShellExecutor(cwd, env);
}
