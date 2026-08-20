/**
 * Window launcher — dogfood regression.
 *
 * The previous launcher passed a NON-EXISTENT `--windowSize` option to
 * wt.exe; WT parsed `118,36` as the command to launch and failed with
 * 0x80070002. A later pass put `--size` AFTER `nt` — but `--size c,r`
 * is a WT GLOBAL option and must appear BEFORE the `nt`/`new-tab`
 * command.
 *
 * Design (no WT probing): Windows Terminal is a GUI app — the launcher
 * NEVER invokes wt.exe except for the real launch. Sizing is OPT-IN and
 * decided by the spawn result: try the sized vector, retry without
 * `--size` if the spawn throws. wt.exe is resolved via `where.exe`
 * FIRST, because the WindowsApps app-execution alias is ACL-hidden from
 * `fs.existsSync` (EACCES) even though it is installed and on PATH.
 *
 * These tests assert the EXACT argument VECTOR (never a joined command
 * string), the global-before-command placement of `--size`, the
 * explicit `--startingDirectory` / `--suppressApplicationTitle`, and
 * that the new window re-launches THIS build (node.exe + running CLI
 * entry) — never a global `litt` that could point at an older install.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  LITT_WINDOW_TITLE,
  LITT_WINDOW_SIZE,
  buildWtArgs,
  buildFallbackArgs,
  buildPowerShellCommand,
  resolvePowerShell,
  resolveWindowsTerminal,
  launchShellWindow,
  type LaunchCommand,
  type LauncherEnv,
  type LaunchResult,
} from "../lib/window-launcher.js";

// The current-build launch command every new window executes.
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const ENTRY = "C:\\litt\\dist\\index.js";
const LAUNCH: LaunchCommand = { exe: NODE, args: [ENTRY, "shell"] };
const CWD = "C:\\Users\\test\\project";

// ─── Exact argument vectors ────────────────────────────────────────

/** wt command keywords (new-tab etc.) that precede the actual executable. */
const WT_COMMANDS = new Set(["nt", "new-tab", "sp", "split-pane", "wt"]);

/** wt option/value pairs (their value is NOT an executable). */
const VALUE_OPTIONS = new Set([
  "--title", "--size", "--pos", "-w", "--window", "-d", "--directory",
  "--startingDirectory", "--tabColor", "--profile",
]);

/** Consume wt option/value pairs + wt commands; return the FIRST
 *  executable argument (node.exe of the relaunched build). */
function firstExecutableArg(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("-")) {
      if (VALUE_OPTIONS.has(a)) i++; // skip its value
      continue;
    }
    if (WT_COMMANDS.has(a)) continue; // wt command keyword, not an executable
    return a;
  }
  return null;
}

describe("buildWtArgs — exact vector", () => {
  it("produces the exact sized vector (global --size BEFORE nt)", () => {
    const args = buildWtArgs(LAUNCH, CWD, { useSizing: true, size: LITT_WINDOW_SIZE });
    expect(args).toEqual([
      "-w", "new",
      "--size", LITT_WINDOW_SIZE,
      "nt",
      "--title", LITT_WINDOW_TITLE,
      "--suppressApplicationTitle",
      "--startingDirectory", CWD,
      NODE, ENTRY, "shell",
    ]);
  });

  it("P0 REGRESSION: --size is a WT GLOBAL option — it appears before nt", () => {
    const args = buildWtArgs(LAUNCH, CWD, { useSizing: true, size: LITT_WINDOW_SIZE });
    const sizeIdx = args.indexOf("--size");
    expect(sizeIdx).toBeGreaterThan(-1);
    expect(sizeIdx).toBeLessThan(args.indexOf("nt"));
    expect(args[sizeIdx + 1]).toBe(LITT_WINDOW_SIZE);
  });

  it("P0 REGRESSION: the first executable argument is never a size string", () => {
    for (const useSizing of [true, false]) {
      const args = buildWtArgs(LAUNCH, CWD, { useSizing, size: LITT_WINDOW_SIZE });
      const exec = firstExecutableArg(args);
      expect(exec).toBe(NODE);
      expect(exec).not.toBe("118,36");
    }
  });

  it("P0 REGRESSION: no bare 118,36 — it only ever appears as the --size value", () => {
    const args = buildWtArgs(LAUNCH, CWD, { useSizing: true, size: LITT_WINDOW_SIZE });
    const occurrences = args.map((a, i) => (a === "118,36" ? i : -1)).filter((i) => i !== -1);
    expect(occurrences.length).toBe(1);
    expect(args[occurrences[0] - 1]).toBe("--size");
  });

  it("P0: --startingDirectory is set EXPLICITLY (profiles can override)", () => {
    const args = buildWtArgs(LAUNCH, CWD, { useSizing: false });
    const idx = args.indexOf("--startingDirectory");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe(CWD);
    expect(idx).toBeGreaterThan(args.indexOf("nt"));
  });

  it("P1: --suppressApplicationTitle follows --title (title stays '⚡ LiTT')", () => {
    const args = buildWtArgs(LAUNCH, CWD, { useSizing: false });
    const titleIdx = args.indexOf("--title");
    expect(args[titleIdx + 1]).toBe(LITT_WINDOW_TITLE);
    expect(args[titleIdx + 2]).toBe("--suppressApplicationTitle");
  });

  it("REGRESSION: re-launches THIS build (node.exe + entry + shell) — never --window (no recursion)", () => {
    const args = buildWtArgs(LAUNCH, CWD, { useSizing: true });
    expect(args).toContain(NODE);
    expect(args).toContain(ENTRY);
    expect(args).toContain("shell");
    expect(args).not.toContain("--window");
    expect(args.join(" ")).not.toContain("litt shell");
  });

  it("without sizing there is no 118,36 and no --size", () => {
    const args = buildWtArgs(LAUNCH, CWD, { useSizing: false });
    expect(args).not.toContain("118,36");
    expect(args).not.toContain("--size");
    expect(firstExecutableArg(args)).toBe(NODE);
  });
});

describe("buildFallbackArgs — plain PowerShell window", () => {
  it("P0: exact vector — NO duplicated executable (psExe goes to spawn(), not argv)", () => {
    const args = buildFallbackArgs(LAUNCH);
    expect(args).toEqual([
      "-NoLogo",
      "-NoExit",
      "-Command",
      buildPowerShellCommand(LAUNCH),
    ]);
    // The PowerShell binary is the spawn() command — args start at -NoLogo.
    expect(args[0]).toBe("-NoLogo");
    expect(args).not.toContain("powershell.exe");
    expect(args).not.toContain("pwsh.exe");
  });

  it("re-launches THIS build inside PowerShell, not a global litt", () => {
    expect(buildPowerShellCommand(LAUNCH)).toBe(`& '${NODE}' '${ENTRY}' 'shell'`);
  });

  it("single-quotes paths with embedded single quotes safely", () => {
    const cmd = buildPowerShellCommand({ exe: "C:\\it's\\node.exe", args: ["a'b", "shell"] });
    expect(cmd).toBe("& 'C:\\it''s\\node.exe' 'a''b' 'shell'");
  });
});

// ─── Executable resolution ─────────────────────────────────────────

describe("resolvePowerShell", () => {
  const base: LauncherEnv = {
    pathEnv: "C:\\bin",
    systemRoot: "C:\\Windows",
    programFiles: "C:\\Program Files",
    programFilesX86: "C:\\Program Files (x86)",
    existsImpl: () => true, // everything exists
  };

  it("prefers pwsh.exe (PowerShell 7) over powershell.exe", () => {
    const ps = resolvePowerShell(base);
    expect(ps).toContain("pwsh.exe");
  });

  it("falls back to powershell.exe when pwsh is absent", () => {
    const env: LauncherEnv = {
      ...base,
      existsImpl: (p) => p.includes("powershell.exe") && !p.includes("pwsh.exe"),
    };
    const ps = resolvePowerShell(env);
    expect(ps).not.toBeNull();
    expect(ps).toContain("powershell.exe");
    expect(ps).not.toContain("pwsh.exe");
  });

  it("returns null when neither exists", () => {
    const env: LauncherEnv = { ...base, existsImpl: () => false };
    expect(resolvePowerShell(env)).toBeNull();
  });

  it("P1: uses real process env defaults when injected dirs are missing", () => {
    const sysRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    const ps = resolvePowerShell({
      pathEnv: "",
      existsImpl: (p) =>
        p === `${sysRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    });
    if (sysRoot) {
      expect(ps).not.toBeNull();
      expect(ps).toContain("WindowsPowerShell");
    } else {
      expect(ps).toBeNull();
    }
  });
});

describe("resolvePowerShell — no relative candidates", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("P1: never probes relative paths when base dirs are unavailable", () => {
    for (const k of ["SystemRoot", "SYSTEMROOT", "ProgramFiles", "PROGRAMFILES", "ProgramFiles(x86)"]) {
      vi.stubEnv(k, "");
    }
    const probed: string[] = [];
    const ps = resolvePowerShell({
      pathEnv: "C:\\tools",
      existsImpl: (p) => {
        probed.push(p);
        return p === "C:\\tools\\pwsh.exe";
      },
    });
    expect(ps).toBe("C:\\tools\\pwsh.exe");
    const relative = probed.filter((p) => p.startsWith("PowerShell\\") || p.startsWith("System32\\"));
    expect(relative).toEqual([]);
  });
});

describe("resolveWindowsTerminal", () => {
  const base: LauncherEnv = {
    localAppData: "C:\\Users\\test\\AppData\\Local",
    programFiles: "C:\\Program Files",
    pathEnv: "C:\\bin",
  };

  it("P1: returns the RESOLVED wt.exe path, never the bare 'wt' command", () => {
    const wt = resolveWindowsTerminal({
      ...base,
      spawnSyncImpl: () => null, // skip where.exe → existsSync candidates
      existsImpl: (p) => p.includes("wt.exe"),
    });
    expect(wt).toBe("C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe");
    expect(wt).not.toBe("wt");
  });

  it("resolves the ACL-hidden WindowsApps alias via where.exe FIRST", () => {
    const wherePath = "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe";
    const wt = resolveWindowsTerminal({
      ...base,
      // existsSync says NOTHING exists (EACCES on the app-execution alias)…
      existsImpl: () => false,
      // …but where.exe still resolves it.
      spawnSyncImpl: () => ({ stdout: wherePath + "\r\n" }),
    });
    expect(wt).toBe(wherePath);
  });

  it("falls back to PATH when where.exe and the store alias are absent", () => {
    const wt = resolveWindowsTerminal({
      ...base,
      spawnSyncImpl: () => null,
      existsImpl: (p) => p === "C:\\bin\\wt.exe",
    });
    expect(wt).toBe("C:\\bin\\wt.exe");
  });

  it("returns null when no wt.exe can be found", () => {
    const wt = resolveWindowsTerminal({
      ...base,
      spawnSyncImpl: () => null,
      existsImpl: () => false,
    });
    expect(wt).toBeNull();
  });
});

// ─── Launch ladder (decided by spawn results — NO WT probing) ──────

function recorder() {
  const calls: Array<{ cmd: string; args: string[]; opts: { windowsHide: boolean } }> = [];
  const spawnImpl = (cmd: string, args: string[], opts: { windowsHide: boolean }) => {
    calls.push({ cmd, args, opts });
    return { unref() {} };
  };
  return { calls, spawnImpl };
}

function envFor(overrides: {
  wt?: string | null;
  ps?: string | null;
  spawnThrows?: boolean;
}): { env: LauncherEnv; calls: Array<{ cmd: string; args: string[]; opts: { windowsHide: boolean } }> } {
  const rec = recorder();
  const wherePath = "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe";
  const env: LauncherEnv = {
    pathEnv: "C:\\bin",
    systemRoot: "C:\\Windows",
    programFiles: "C:\\Program Files",
    programFilesX86: "C:\\Program Files (x86)",
    localAppData: "C:\\Users\\test\\AppData\\Local",
    // where.exe resolves the ACL-hidden WindowsApps alias (when WT exists).
    spawnSyncImpl: () => (overrides.wt !== null ? { stdout: wherePath } : null),
    existsImpl: (p) => {
      if (p.includes("wt.exe")) return overrides.wt !== null;
      if (p.includes("pwsh.exe")) return overrides.ps === "pwsh";
      if (p.includes("powershell.exe")) return overrides.ps === "powershell";
      return false;
    },
    spawnImpl: (cmd: string, args: string[], opts: { windowsHide: boolean }) => {
      if (overrides.spawnThrows) throw new Error("spawn failed");
      rec.calls.push({ cmd, args, opts });
      return { unref() {} };
    },
  };
  return { env, calls: rec.calls };
}

describe("launchShellWindow ladder", () => {
  it("DEFAULT (no sizing opt-in) → WT compat vector without --size", () => {
    const { env, calls } = envFor({ wt: "wt", ps: "pwsh" });
    const r = launchShellWindow(CWD, LAUNCH, env);
    expect(r.ok).toBe(true);
    expect(r.path).toBe("wt-unsized");
    expect(calls.length).toBe(1);
    const [call] = calls;
    // wt is the RESOLVED path — never a bare "wt", "118,36" or "powershell".
    expect(call.cmd).toBe("C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe");
    expect(call.cmd).not.toBe("wt");
    expect(call.opts.windowsHide).toBe(true);
    expect(call.args).not.toContain("--size");
    expect(call.args).not.toContain("118,36");
    // Explicit starting dir + title lock, then THIS build as the executable.
    expect(call.args).toContain("--startingDirectory");
    expect(call.args).toContain("--suppressApplicationTitle");
    expect(firstExecutableArg(call.args)).toBe(NODE);
  });

  it("OPT-IN sizing → WT sized vector (global --size BEFORE nt)", () => {
    const { env, calls } = envFor({ wt: "wt", ps: "pwsh" });
    const r = launchShellWindow(CWD, LAUNCH, env, true);
    expect(r.ok).toBe(true);
    expect(r.path).toBe("wt-sized");
    expect(calls.length).toBe(1);
    const [call] = calls;
    expect(call.args.indexOf("--size")).toBeLessThan(call.args.indexOf("nt"));
    expect(call.args).toContain("118,36");
    expect(firstExecutableArg(call.args)).toBe(NODE);
  });

  it("sized spawn throws → retry WITHOUT sizing (compat vector)", () => {
    const rec = recorder();
    let throwFirst = true;
    const env: LauncherEnv = {
      pathEnv: "C:\\bin", systemRoot: "C:\\Windows",
      programFiles: "C:\\Program Files", programFilesX86: "C:\\Program Files (x86)",
      localAppData: "C:\\Users\\test\\AppData\\Local",
      spawnSyncImpl: () => ({ stdout: "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe" }),
      existsImpl: (p) => p.includes("wt.exe") || p.includes("pwsh.exe"),
      spawnImpl: (cmd: string, args: string[], opts: { windowsHide: boolean }) => {
        if (throwFirst) { throwFirst = false; throw new Error("sized spawn failed"); }
        rec.calls.push({ cmd, args, opts });
        return { unref() {} };
      },
    };
    const r = launchShellWindow(CWD, LAUNCH, env, true);
    expect(r.ok).toBe(true);
    expect(r.path).toBe("wt-unsized");
    expect(rec.calls.length).toBe(1);
    expect(rec.calls[0].args).not.toContain("--size");
    expect(rec.calls[0].args).not.toContain("118,36");
  });

  it("P0: no Windows Terminal → plain PowerShell window, VISIBLE (windowsHide:false)", () => {
    const { env, calls } = envFor({ wt: null, ps: "powershell" });
    const r = launchShellWindow(CWD, LAUNCH, env, true);
    expect(r.ok).toBe(true);
    expect(r.path).toBe("powershell");
    expect(calls.length).toBe(1);
    const [call] = calls;
    // The PowerShell binary is the spawn() command; args start at -NoLogo.
    expect(call.cmd).toContain("powershell.exe");
    expect(call.opts.windowsHide).toBe(false);
    expect(call.args[0]).toBe("-NoLogo");
    expect(call.args).toContain(buildPowerShellCommand(LAUNCH));
    // The fallback still re-launches THIS build inside the window.
    expect(call.args.join(" ")).toContain(ENTRY);
    expect(call.args.join(" ")).not.toContain("litt shell");
  });

  it("no PowerShell anywhere → honest failure", () => {
    const { env } = envFor({ wt: "wt", ps: null });
    const r: LaunchResult = launchShellWindow(CWD, LAUNCH, env, true);
    expect(r.ok).toBe(false);
    expect(r.path).toBe("failed");
  });

  it("all spawns fail → honest failure (no silent fallthrough)", () => {
    const { env } = envFor({ wt: "wt", ps: "pwsh", spawnThrows: true });
    const r = launchShellWindow(CWD, LAUNCH, env, true);
    expect(r.ok).toBe(false);
    expect(r.path).toBe("failed");
  });
});
