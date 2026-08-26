/**
 * Canonical executable resolution for the CLI.
 *
 * WHY THIS EXISTS
 * ---------------
 * `litt doctor` reported "pnpm: not installed" / "npm: not installed" /
 * "yarn: not installed" on machines where all three were installed and
 * on PATH, while correctly reporting git. The probe used
 * `execFileSync(cmd, args, { shell: false })`, which on Windows is a raw
 * CreateProcess — it can only launch real PE executables. `git`
 * resolves to `git.exe` and worked. `pnpm`, `npm` and `yarn` are `.CMD`
 * batch shims, so every call threw and was reported as "not installed".
 *
 * A diagnostic that lies is worse than no diagnostic, so resolution now
 * goes through this module:
 *
 *   - Windows: walk PATH directory by directory, trying each PATHEXT
 *     extension within it (real cmd.exe order), then route `.cmd`/`.bat`
 *     shims through cmd.exe because they cannot be CreateProcess'd.
 *   - POSIX/Termux: walk PATH and take the first executable match, with
 *     no extension guessing.
 *
 * The previous `shell: false` design existed for a reason — the code it
 * replaced spawned powershell.exe per probe (~1.5s each, ~12s total).
 * This module keeps that win: resolution is pure filesystem stats, and
 * only genuine batch shims pay for a cmd.exe spawn (~30ms), which is
 * two orders of magnitude cheaper than PowerShell. Nothing here ever
 * spawns a shell to *find* a command.
 *
 * Termux notes: there is no /bin/sh and binaries live in $PREFIX/bin
 * (/data/data/com.termux/files/usr/bin). Because resolution never shells
 * out and never assumes /bin/sh, the same code path is correct there.
 */

import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { win32 as winPath, posix as posixPath } from "node:path";

/**
 * Extensions Windows treats as executable when PATHEXT is unset.
 *
 * Restricted to types this module can actually LAUNCH: .COM and .EXE are
 * PE executables that CreateProcess handles directly; .BAT and .CMD are
 * batch shims routed through cmd.exe. .JS/.VBS/.WSF/.MSC are dropped —
 * they cannot be CreateProcess'd, are not batch shims, and including
 * them in resolution would produce paths that execution cannot handle.
 */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/** Batch shims cannot be CreateProcess'd — they need cmd.exe. */
const CMD_SHIM_EXTENSIONS = [".cmd", ".bat"];

/** Characters that alter CMD parsing in arguments. */
const CMD_UNSAFE_CHARS = /["&|<>%^()]/;
/** Same concern for resolved paths, plus CR/LF which break command strings. */
const CMD_UNSAFE_CHARS_PATH = /[\r\n"%]/;

export interface WhichEnv {
  /** Defaults to process.platform. Injected in tests. */
  platform?: NodeJS.Platform;
  /** Defaults to process.env.PATH. */
  pathVar?: string;
  /** Windows only. Defaults to process.env.PATHEXT, then DEFAULT_PATHEXT. */
  pathExt?: string;
  /** Existence/executability check. Injected in tests. */
  existsImpl?: (path: string) => boolean;
  /** Spawn timeout in ms. Defaults to 5000. Injected in tests for short-timeout tests. */
  timeoutMs?: number;
}

/** Real filesystem probe: the path must exist, be a file, and on POSIX be executable. */
function realExists(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
  } catch {
    return false;
  }
  if (platform === "win32") return true;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Candidate names for a command, in the order the platform would try them. */
function candidateNames(command: string, platform: NodeJS.Platform, pathExt: string): string[] {
  if (platform !== "win32") return [command];

  const extensions = pathExt
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);

  const lower = command.toLowerCase();
  const alreadyExtended = extensions.some((ext) => lower.endsWith(ext.toLowerCase()));

  return alreadyExtended
    ? [command, ...extensions.map((ext) => command + ext)]
    : extensions.map((ext) => command + ext);
}

/**
 * Resolve a command to an absolute executable path, or null.
 *
 * Mirrors platform lookup semantics: on Windows, PATH directories are
 * the OUTER loop and PATHEXT the INNER one, so a `.cmd` in an earlier
 * directory wins over a `.exe` in a later one — matching what would
 * actually run.
 */
export function whichSync(command: string, env: WhichEnv = {}): string | null {
  if (!command) return null;

  const platform = env.platform ?? process.platform;
  const pathExt = env.pathExt ?? process.env.PATHEXT ?? DEFAULT_PATHEXT;
  const exists = env.existsImpl ?? ((p: string) => realExists(p, platform));

  const names = candidateNames(command, platform, pathExt);
  const pathApi = platform === "win32" ? winPath : posixPath;

  if (pathApi.isAbsolute(command) || command.includes("/") || (platform === "win32" && command.includes("\\"))) {
    for (const name of names) {
      if (exists(name)) return name;
    }
    return null;
  }

  const rawPath = env.pathVar ?? process.env.PATH ?? "";
  const separator = platform === "win32" ? ";" : ":";
  const directories = rawPath.split(separator).filter((d) => d.trim().length > 0);

  for (const directory of directories) {
    const cleaned = directory.replace(/^"|"$/g, "");
    for (const name of names) {
      const candidate = pathApi.join(cleaned, name);
      if (exists(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * True when a resolved path is a Windows batch shim, which must be run
 * through cmd.exe rather than launched directly. Always false on POSIX —
 * Termux has no cmd.exe, and a file merely named `*.cmd` there is an
 * ordinary executable.
 */
export function needsCmdShell(resolvedPath: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32") return false;
  const lower = resolvedPath.toLowerCase();
  return CMD_SHIM_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Build a safe CMD command string for `cmd /d /v:off /s /c`.
 *
 * CENTRALIZED here so both the sync and async probes share one
 * command-construction path. Narrowly scoped to version-probe
 * execution (`--version` etc):
 *
 *   - The resolved path is always double-quoted (it may contain
 *     spaces). A path containing a literal double-quote, CR, LF, or
 *     `%` is rejected — it cannot be safely quoted for CMD.
 *   - Each argument is checked for CMD metacharacters (& | < > % ^ ( )
 *     "). Any arg containing them is REJECTED.
 *   - Arguments containing spaces are double-quoted.
 *   - The ENTIRE command string is wrapped in outer double-quotes.
 *     This is required for `cmd /s /c`: the `/s` flag tells cmd.exe
 *     to strip the FIRST and LAST quote from the command string. By
 *     wrapping the whole thing, `/s` strips the outer pair and leaves
 *     the inner quotes around the resolved path intact.
 *
 * Throws on unsafe input — callers catch and report null.
 */
export function buildCmdCommandString(resolved: string, args: string[]): string {
  if (CMD_UNSAFE_CHARS_PATH.test(resolved)) {
    throw new Error(`Unsafe resolved path rejected: ${JSON.stringify(resolved)}`);
  }
  for (const arg of args) {
    if (CMD_UNSAFE_CHARS.test(arg)) {
      throw new Error(`Unsafe CMD argument rejected: ${JSON.stringify(arg)}`);
    }
  }
  const quotedArgs = args.map((a) => (a.includes(" ") ? `"${a}"` : a));
  const inner = quotedArgs.length > 0 ? `"${resolved}" ${quotedArgs.join(" ")}` : `"${resolved}"`;
  return `"${inner}"`;
}

/**
 * Resolve a command and capture its trimmed stdout, or null if the
 * command is absent or exits non-zero.
 *
 * This is the sync probe. `litt doctor` now uses the async sibling
 * (tryCommandOutputAsync) so four probes run concurrently.
 */
export function tryCommandOutput(command: string, args: string[], env: WhichEnv = {}): string | null {
  const platform = env.platform ?? process.platform;
  const timeoutMs = env.timeoutMs ?? 5000;
  const resolved = whichSync(command, env);
  if (!resolved) return null;

  try {
    const result = needsCmdShell(resolved, platform)
      ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/v:off", "/s", "/c", buildCmdCommandString(resolved, args)], {
          encoding: "utf8",
          timeout: timeoutMs,
          stdio: ["pipe", "pipe", "pipe"],
          windowsVerbatimArguments: true,
        })
      : spawnSync(resolved, args, {
          encoding: "utf8",
          timeout: timeoutMs,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        });

    if (result.error || result.status !== 0) return null;

    const output = (result.stdout ?? "").trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

/**
 * Async sibling of tryCommandOutput, for callers probing several tools
 * at once.
 *
 * The sync version blocks, so four probes cost the sum of their
 * runtimes; `npm --version` alone is close to a second. Running them
 * concurrently costs the slowest one instead. Resolution stays
 * synchronous filesystem work — only the spawn is async.
 */
export function tryCommandOutputAsync(command: string, args: string[], env: WhichEnv = {}): Promise<string | null> {
  const platform = env.platform ?? process.platform;
  const timeoutMs = env.timeoutMs ?? 5000;
  const resolved = whichSync(command, env);
  if (!resolved) return Promise.resolve(null);

  let cmdString: string;
  try {
    cmdString = buildCmdCommandString(resolved, args);
  } catch {
    return Promise.resolve(null);
  }

  const [file, spawnArgs, options] = needsCmdShell(resolved, platform)
    ? ([
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/v:off", "/s", "/c", cmdString],
        { windowsVerbatimArguments: true },
      ] as const)
    : ([resolved, args, { shell: false }] as const);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const child = spawn(file, [...spawnArgs], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
        ...options,
      });

      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.resume();

      const startTime = Date.now();
      const timer = setTimeout(() => {
        if (platform === "win32") {
          try {
            spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid ?? 0)], {
              stdio: "ignore",
            });
          } catch {
            // best-effort tree termination
          }
        }
        try {
          child.kill();
        } catch {
          // already dead
        }
      }, timeoutMs);

      child.on("error", () => {
        clearTimeout(timer);
        finish(null);
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        const output = stdout.trim();
        if (code !== 0 || output.length === 0) {
          finish(null);
        } else {
          finish(output);
        }
      });
    } catch {
      finish(null);
    }
  });
}
