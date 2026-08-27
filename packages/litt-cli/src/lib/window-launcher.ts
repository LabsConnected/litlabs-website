/**
 * WindowLauncher — `litt shell --window`: open LiTT in a dedicated
 * terminal window.
 *
 * ARCHITECTURE (2026-08-19): the new window re-launches THIS LiTT build
 * — the exact node.exe + CLI entry already running — instead of a
 * globally resolvable `litt` command. No old-global-install drift, no
 * PATH differences, no "litt not found", no testing one checkout but
 * launching another installation.
 *
 *   Windows Terminal (preferred)
 *       ↓  wt -w new [--size c,r] nt --title "LiTT"
 *          --suppressApplicationTitle --startingDirectory <cwd>
 *          <node.exe> <cli-entry> shell
 *   PowerShell window (fallback, only when wt.exe is unavailable)
 *       ↓  powershell -NoLogo -NoExit -Command "& '<node.exe>' '<cli-entry>' 'shell'"
 *
 * WT argument rules (Windows Terminal command-line grammar):
 *   - `--size c,r` is a WT GLOBAL option (since 1.17) — it MUST appear
 *     BEFORE the `nt` / `new-tab` command, right after `-w new`.
 *     (Historical bug: `--size` after `nt` was parsed with `118,36` as
 *     the command to execute → 0x80070002 "file not found".)
 *   - `--title`, `--suppressApplicationTitle`, `--startingDirectory`
 *     are `new-tab` parameters and follow `nt`.
 *   - `--startingDirectory` is set EXPLICITLY — terminal profiles can
 *     configure their own starting directory that would otherwise win.
 *   - `--suppressApplicationTitle` keeps the title "LiTT" instead of
 *     letting PowerShell/the app overwrite it.
 *
 * NO WT PROBING (dogfood): Windows Terminal is a GUI application — its
 * `--help` / `--version` paths can display modal MessageBoxes and are
 * unsuitable for silent capability detection. The launcher NEVER
 * invokes wt.exe except for the real launch. Sizing is best-effort:
 * the PRIMARY vector uses the documented `--size`; if that spawn fails,
 * the COMPATIBILITY vector (no `--size`) is used — decided by the spawn
 * result, never by probing the binary.
 *
 * Every path:
 *   - resolves PowerShell EXPLICITLY (pwsh.exe preferred, else
 *     powershell.exe) — never the bare string "powershell"
 *   - spawns with an ARGUMENT ARRAY (no joined command string, so
 *     quoting and argument positions survive)
 *   - launches the CURRENT CLI build with `shell` — never
 *     `shell --window` (no recursion)
 *   - WT spawn uses windowsHide:true (the new tab is its own window);
 *     the plain PowerShell fallback uses windowsHide:false — hiding
 *     the fallback window would defeat the entire purpose
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LITT_WINDOW_TITLE = "LiTT";
export const LITT_WINDOW_SIZE = "118,36";

// ─── The command to re-launch (the CURRENT LiTT CLI build) ─────────

export interface LaunchCommand {
  /** Executable to run in the new window (e.g. process.execPath). */
  exe: string;
  /** Arguments for that executable (entry script, subcommand, ...). */
  args: string[];
}

/**
 * Build the command that re-launches THIS LiTT build: the node.exe that
 * is already running plus the CLI entry script that is already running.
 * A new window therefore always gets the exact same build the user is
 * in — never an older global `litt` install.
 */
export function currentCliCommand(extraArgs: string[] = []): LaunchCommand {
  return { exe: process.execPath, args: [cliEntryPath(), ...extraArgs] };
}

/** The entry script actually running (dist/index.js) — or, as a
 *  fallback, the built entry next to this module (dist/lib → ../index.js). */
function cliEntryPath(): string {
  const argv1 = process.argv[1];
  if (argv1) {
    const p = resolve(argv1);
    if (existsSync(p)) return p;
  }
  return fileURLToPath(new URL("../index.js", import.meta.url));
}

// ─── Dependency injection (for exact-vector unit tests) ────────────

export interface LauncherEnv {
  pathEnv?: string;
  systemRoot?: string;
  programFiles?: string;
  programFilesX86?: string;
  localAppData?: string;
  /** Spawn implementation (real spawn; tests inject a recorder). */
  spawnImpl?: (cmd: string, args: string[], opts: { cwd: string; detached: boolean; stdio: "ignore"; shell: false; windowsHide: boolean }) => { unref(): void };
  /** Sync spawn — ONLY for `where.exe` PATH resolution (never WT). */
  spawnSyncImpl?: (cmd: string, args: string[]) => { stdout: string; error?: Error } | null;
  /** Filesystem existence check (tests inject a fake). */
  existsImpl?: (p: string) => boolean;
}

function realSpawnSync(cmd: string, args: string[]): { stdout: string; error?: Error } | null {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
    return { stdout: r.stdout ?? "" };
  } catch (err) {
    return { stdout: "", error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ─── Executable resolution ─────────────────────────────────────────

/**
 * Real process-environment defaults for the well-known Windows
 * directories, layered under injected test values. Never returns empty
 * strings — an unset/blank base means "no candidate".
 */
function resolveEnvDirs(env: LauncherEnv): {
  systemRoot: string | undefined;
  programFiles: string | undefined;
  programFilesX86: string | undefined;
} {
  const systemRoot = env.systemRoot ?? process.env.SystemRoot ?? process.env.SYSTEMROOT ?? undefined;
  const programFiles = env.programFiles ?? process.env.ProgramFiles ?? process.env.PROGRAMFILES ?? undefined;
  const programFilesX86 = env.programFilesX86 ?? process.env["ProgramFiles(x86)"] ?? undefined;
  return {
    systemRoot: systemRoot || undefined,
    programFiles: programFiles || undefined,
    programFilesX86: programFilesX86 || undefined,
  };
}

/** Standard install locations + PATH lookup for an executable. */
function candidatePaths(name: string, env: LauncherEnv): string[] {
  const out: string[] = [];
  const add = (p: string | undefined): void => { if (p) out.push(p); };
  const { systemRoot, programFiles, programFilesX86 } = resolveEnvDirs(env);
  // Only build candidates when the base directory exists — a blank base
  // would otherwise produce a relative "PowerShell\7\pwsh.exe" path.
  if (programFiles) add(join(programFiles, "PowerShell", "7", name));       // pwsh 7
  if (programFilesX86) add(join(programFilesX86, "PowerShell", "7", name)); // pwsh 7 (x86)
  if (systemRoot) add(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", name)); // powershell 5.1
  const pathEnv = env.pathEnv ?? process.env.PATH ?? "";
  for (const dir of pathEnv.split(";")) {
    if (dir.trim()) add(join(dir.trim(), name));
  }
  return out;
}

/** Resolve an executable by name, preferring the earliest candidate
 *  that exists. Returns the absolute path, or null when nothing
 *  exists. Never returns a bare name. */
function resolveExecutable(name: string, env: LauncherEnv): string | null {
  const exists = env.existsImpl ?? existsSync;
  for (const p of candidatePaths(name, env)) {
    if (exists(p)) return p;
  }
  return null;
}

/**
 * Resolve PowerShell explicitly — prefer PowerShell 7 (pwsh.exe),
 * otherwise Windows PowerShell (powershell.exe). NEVER the bare
 * string "powershell" when launching through WT.
 */
export function resolvePowerShell(env: LauncherEnv = {}): string | null {
  return resolveExecutable("pwsh.exe", env) ?? resolveExecutable("powershell.exe", env);
}

/**
 * Resolve wt.exe — the WindowsApps store alias first, then PATH.
 * Always returns the actual resolved executable path (never a bare
 * "wt" command), so the spawn uses a concrete file.
 *
 * Node's existsSync CANNOT see the WindowsApps app-execution alias (a
 * special reparse point), so `where.exe wt.exe` is used to resolve it —
 * `where.exe` is a PATH lookup tool and NEVER launches Windows Terminal,
 * so this is not a WT probe.
 */
export function resolveWindowsTerminal(env: LauncherEnv = {}): string | null {
  const exists = env.existsImpl ?? existsSync;
  // `where.exe wt.exe` — resolves the store alias that existsSync
  // reports as missing. Runs where.exe, NOT wt.exe.
  const syncImpl = env.spawnSyncImpl ?? realSpawnSync;
  const where = syncImpl("where.exe", ["wt.exe"]);
  if (where && !where.error && where.stdout) {
    const first = where.stdout.split(/\r?\n/)[0]?.trim();
    if (first) return first;
  }
  // Known install locations (non-alias installs).
  const localAppData = env.localAppData ?? process.env.LOCALAPPDATA ?? undefined;
  const { programFiles } = resolveEnvDirs(env);
  const candidates: string[] = [];
  if (localAppData) candidates.push(join(localAppData, "Microsoft", "WindowsApps", "wt.exe"));
  if (programFiles) candidates.push(join(programFiles, "WindowsApps", "wt.exe"));
  for (const p of candidates) {
    if (exists(p)) return p;
  }
  // PATH fallback (a real wt.exe installed manually).
  return resolveExecutable("wt.exe", env);
}

// ─── Exact argument vectors ────────────────────────────────────────

/**
 * The wt.exe argument vector.
 *
 *   wt -w new [--size c,r] nt --title "LiTT"
 *      --suppressApplicationTitle --startingDirectory <cwd>
 *      <node.exe> <entry> shell
 *
 * `--size c,r` is a WT GLOBAL option — it MUST appear BEFORE the `nt`
 * command. The FIRST executable argument (node.exe) comes after all WT
 * options and can never be a size string.
 *
 * Two modes:
 *   PRIMARY (useSizing: true)  — the documented `--size` vector.
 *   COMPATIBILITY (false)      — no `--size` (any WT version).
 * The mode is chosen by the spawn result, never by probing WT.
 */
export function buildWtArgs(
  launch: LaunchCommand,
  cwd: string,
  options: { title?: string; size?: string; useSizing: boolean },
): string[] {
  const args = ["-w", "new"];

  // WT GLOBAL option — MUST be before `nt`.
  if (options.useSizing && options.size) {
    args.push("--size", options.size);
  }

  args.push(
    "nt",
    "--title",
    options.title ?? LITT_WINDOW_TITLE,
    "--suppressApplicationTitle",
    "--startingDirectory",
    cwd,
    launch.exe,
    ...launch.args,
  );

  return args;
}

/** Single-quote a string for embedding inside a PowerShell -Command string. */
export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * `& 'C:\Program Files\nodejs\node.exe' 'C:\...\dist\index.js' 'shell'`
 * — the PowerShell -Command that launches THIS build (never a global
 * `litt` that could point at an older installation).
 */
export function buildPowerShellCommand(launch: LaunchCommand): string {
  return `& ${psQuote(launch.exe)} ${launch.args.map(psQuote).join(" ")}`;
}

/**
 * Plain PowerShell window fallback (no Windows Terminal). The resolved
 * PowerShell binary is passed to spawn() as the command — the args
 * start at -NoLogo (no duplicated executable as argv[0]).
 */
export function buildFallbackArgs(launch: LaunchCommand): string[] {
  return ["-NoLogo", "-NoExit", "-Command", buildPowerShellCommand(launch)];
}

// ─── Orchestrator ──────────────────────────────────────────────────

export interface LaunchResult {
  ok: boolean;
  /** Which ladder path was used. */
  path: "wt-sized" | "wt-unsized" | "powershell" | "failed";
  wt: string | null;
  ps: string | null;
}

/**
 * Launch the dedicated LiTT shell window.
 *
 * Ladder (decided by spawn results — NO WT probing):
 *   DEFAULT:        WT WITHOUT `--size` — maximum compatibility with
 *                   any Windows Terminal version. Sizing is a nice
 *                   acceptance size, never a launch requirement.
 *   OPT-IN SIZED:   WT with the documented `--size` vector (pass
 *                   useSizing: true) — works on WT >= 1.17.
 *   FALLBACK:       plain PowerShell window (windowsHide:false).
 *
 * `launch` is the command the new window executes — for the CLI this is
 * `currentCliCommand(["shell"])` (this build's node.exe + entry).
 */
export function launchShellWindow(
  cwd: string,
  launch: LaunchCommand,
  env: LauncherEnv = {},
  useSizing = false,
): LaunchResult {
  const spawnImpl = env.spawnImpl
    ?? ((cmd: string, args: string[], opts: { cwd: string; detached: boolean; stdio: "ignore"; shell: false; windowsHide: boolean }) => {
      const child = spawn(cmd, args, opts);
      child.unref();
      return child;
    });

  const wt = resolveWindowsTerminal(env);
  const ps = resolvePowerShell(env);

  if (!ps) {
    return { ok: false, path: "failed", wt, ps: null };
  }

  // Ladder 1: PRIMARY — WT with the documented --size vector.
  if (wt && useSizing) {
    const wtArgs = buildWtArgs(launch, cwd, { useSizing: true, size: LITT_WINDOW_SIZE });
    try {
      spawnImpl(wt, wtArgs, { cwd, detached: true, stdio: "ignore", shell: false, windowsHide: true });
      return { ok: true, path: "wt-sized", wt, ps };
    } catch {
      // fall through to COMPATIBILITY (no --size)
    }
  }

  // Ladder 2: COMPATIBILITY — WT without --size (any WT version).
  if (wt) {
    const wtArgs = buildWtArgs(launch, cwd, { useSizing: false });
    try {
      spawnImpl(wt, wtArgs, { cwd, detached: true, stdio: "ignore", shell: false, windowsHide: true });
      return { ok: true, path: "wt-unsized", wt, ps };
    } catch {
      // fall through to the plain PowerShell window
    }
  }

  // Ladder 3: plain PowerShell window — must be VISIBLE (windowsHide:false).
  try {
    spawnImpl(ps, buildFallbackArgs(launch), { cwd, detached: true, stdio: "ignore", shell: false, windowsHide: false });
    return { ok: true, path: "powershell", wt, ps };
  } catch {
    return { ok: false, path: "failed", wt, ps };
  }
}
