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

/** Extensions Windows treats as executable when PATHEXT is unset. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WSF;.MSC";

/** Batch shims cannot be CreateProcess'd — they need cmd.exe. */
const CMD_SHIM_EXTENSIONS = [".cmd", ".bat"];

export interface WhichEnv {
  /** Defaults to process.platform. Injected in tests. */
  platform?: NodeJS.Platform;
  /** Defaults to process.env.PATH. */
  pathVar?: string;
  /** Windows only. Defaults to process.env.PATHEXT, then DEFAULT_PATHEXT. */
  pathExt?: string;
  /** Existence/executability check. Injected in tests. */
  existsImpl?: (path: string) => boolean;
}

/** Real filesystem probe: the path must exist, be a file, and on POSIX be executable. */
function realExists(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
  } catch {
    return false;
  }
  // Windows has no execute bit; presence with an executable extension is
  // the whole test. On POSIX (Termux included) the bit is meaningful.
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

  // A command that already carries a recognised extension is tried
  // as-is first, so `whichSync("pnpm.CMD")` resolves exactly.
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

  // Path helpers are chosen by TARGET platform. The bare node:path
  // exports follow the host, which would emit backslashes for Termux
  // paths whenever this ran (or was tested) from Windows.
  const pathApi = platform === "win32" ? winPath : posixPath;

  // An explicit path (absolute, or containing a separator) is never
  // looked up in PATH — but on Windows it still gets PATHEXT applied,
  // so `C:\tools\adb` finds `C:\tools\adb.exe`.
  if (pathApi.isAbsolute(command) || command.includes("/") || (platform === "win32" && command.includes("\\"))) {
    for (const name of names) {
      if (exists(name)) return name;
    }
    return null;
  }

  const rawPath = env.pathVar ?? process.env.PATH ?? "";
  // Derived from the TARGET platform, never from node:path's `delimiter`
  // — that reflects the host, so Termux resolution would silently break
  // whenever this ran (or was tested) from Windows.
  const separator = platform === "win32" ? ";" : ":";
  const directories = rawPath.split(separator).filter((d) => d.trim().length > 0);

  for (const directory of directories) {
    // Windows tolerates quoted PATH entries; join() would not.
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
 * Resolve a command and capture its trimmed stdout, or null if the
 * command is absent or exits non-zero.
 *
 * This is the probe `litt doctor` uses. Resolution is pure filesystem
 * work; only genuine Windows batch shims pay for a cmd.exe spawn, and
 * nothing here ever spawns PowerShell.
 */
export function tryCommandOutput(command: string, args: string[], env: WhichEnv = {}): string | null {
  const platform = env.platform ?? process.platform;
  const resolved = whichSync(command, env);
  if (!resolved) return null;

  try {
    const result = needsCmdShell(resolved, platform)
      ? // A .cmd/.bat shim cannot be CreateProcess'd, so it goes through
        // the command processor. `/d` skips AutoRun scripts, `/s` fixes
        // quote handling for the single quoted command string, and
        // windowsVerbatimArguments stops Node re-quoting what we built —
        // together these keep paths containing spaces intact.
        spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", [`"${resolved}"`, ...args].join(" ")], {
          encoding: "utf8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
          windowsVerbatimArguments: true,
        })
      : spawnSync(resolved, args, {
          encoding: "utf8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        });

    // A tool that exists but errors is not the same as a missing tool;
    // both report null here, but only because the caller asks a single
    // question — "what version, if any?".
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
  const resolved = whichSync(command, env);
  if (!resolved) return Promise.resolve(null);

  const [file, spawnArgs, options] = needsCmdShell(resolved, platform)
    ? ([
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", [`"${resolved}"`, ...args].join(" ")],
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
        timeout: 5000,
        ...options,
      });

      let stdout = "";
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      // Draining stderr prevents a chatty tool from blocking on a full pipe.
      child.stderr?.resume();

      child.on("error", () => finish(null));
      child.on("close", (code) => {
        const output = stdout.trim();
        finish(code === 0 && output.length > 0 ? output : null);
      });
    } catch {
      finish(null);
    }
  });
}
