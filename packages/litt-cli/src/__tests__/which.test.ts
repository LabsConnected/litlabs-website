/**
 * Executable resolution regression tests.
 *
 * Fixes the `litt doctor` lie: it reported "pnpm: not installed" /
 * "npm: not installed" / "yarn: not installed" on machines where all
 * three were demonstrably installed, while correctly finding git.
 *
 * Root cause: doctor used execFileSync(..., { shell: false }). On
 * Windows that is a raw CreateProcess, which can ONLY launch real PE
 * executables. git resolves to git.exe and worked; pnpm/npm/yarn are
 * .CMD batch shims and always threw ENOENT — reported as "not
 * installed". The probe must resolve the command through PATH +
 * PATHEXT and route batch shims through cmd.exe.
 *
 * The fix must NOT reintroduce the per-call PowerShell spawn that the
 * doctor deliberately removed for performance, and must stay correct on
 * Termux, where there is no /bin/sh and binaries live in $PREFIX/bin.
 *
 * Windows paths are built with win() rather than written as literals —
 * backslash-escaped string literals are a needless hazard here.
 */

import { describe, it, expect } from "vitest";
import { whichSync, needsCmdShell, type WhichEnv } from "../lib/which.js";

const WIN_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WSF;.MSC";

/** Join segments into a Windows path without backslash literals. */
function win(...segments: string[]): string {
  return segments.join("\\");
}

/** Build a Windows env whose "filesystem" is exactly the given paths. */
function winEnv(files: string[], pathVar: string): WhichEnv {
  const present = new Set(files.map((f) => f.toLowerCase()));
  return {
    platform: "win32",
    pathVar,
    pathExt: WIN_PATHEXT,
    existsImpl: (p) => present.has(p.toLowerCase()),
  };
}

/** Build a POSIX/Termux env whose "filesystem" is exactly the given paths. */
function posixEnv(files: string[], pathVar: string): WhichEnv {
  const present = new Set(files);
  return {
    platform: "linux",
    pathVar,
    existsImpl: (p) => present.has(p),
  };
}

const GIT_DIR = win("C:", "Program Files", "Git", "cmd");
const PNPM_DIR = win("C:", "Users", "me", "AppData", "Local", "pnpm");
const BIN_DIR = win("C:", "bin");

// Windows assertions compare case-insensitively: resolution synthesises
// candidates from PATHEXT (conventionally uppercase), so a file stored as
// "git.exe" resolves as "git.EXE". The filesystem is case-insensitive, so
// the path is functionally identical and the casing carries no meaning.
describe("whichSync — Windows", () => {
  const PATH = `${GIT_DIR};${PNPM_DIR}`;

  it("resolves a .CMD shim (the pnpm/npm/yarn bug)", () => {
    const target = win(PNPM_DIR, "pnpm.CMD");
    expect(whichSync("pnpm", winEnv([target], PATH))).toBe(target);
  });

  it("resolves a real .exe (the git case that always worked)", () => {
    const target = win(GIT_DIR, "git.exe");
    expect(whichSync("git", winEnv([target], PATH))?.toLowerCase()).toBe(target.toLowerCase());
  });

  it("returns null when the command is genuinely absent", () => {
    const env = winEnv([win(GIT_DIR, "git.exe")], PATH);
    expect(whichSync("yarn", env)).toBeNull();
  });

  it("searches PATH directories outer, PATHEXT inner (real cmd.exe order)", () => {
    // cmd.exe walks PATH directory by directory, trying every PATHEXT
    // within each one. So a .cmd in an EARLIER directory beats a .exe in
    // a later one — the probe must report what would actually run.
    const earlierCmd = win(GIT_DIR, "tool.cmd");
    const laterExe = win(PNPM_DIR, "tool.exe");
    expect(whichSync("tool", winEnv([earlierCmd, laterExe], PATH))?.toLowerCase()).toBe(earlierCmd.toLowerCase());
  });

  it("applies PATHEXT order within a single directory", () => {
    // Both candidates share a directory, so PATHEXT decides: .EXE first.
    const env = winEnv([win(BIN_DIR, "tool.cmd"), win(BIN_DIR, "tool.exe")], BIN_DIR);
    expect(whichSync("tool", env)?.toLowerCase()).toBe(win(BIN_DIR, "tool.exe").toLowerCase());
  });

  it("accepts a command that already carries its extension", () => {
    const target = win(PNPM_DIR, "pnpm.CMD");
    expect(whichSync("pnpm.CMD", winEnv([target], PATH))).toBe(target);
  });

  it("matches a lowercase on-disk shim against uppercase PATHEXT", () => {
    // PATHEXT is conventionally uppercase (".CMD") while the file on disk
    // is "npm.cmd". Windows' filesystem is case-insensitive, so resolution
    // must succeed; the casing of the returned string is not significant.
    const target = win(PNPM_DIR, "npm.cmd");
    const resolved = whichSync("npm", winEnv([target], PATH));
    expect(resolved).not.toBeNull();
    expect(resolved?.toLowerCase()).toBe(target.toLowerCase());
  });

  it("falls back to a default PATHEXT when the variable is unset", () => {
    const target = win(BIN_DIR, "pnpm.cmd");
    const env: WhichEnv = {
      platform: "win32",
      pathVar: BIN_DIR,
      pathExt: undefined,
      existsImpl: (p) => p.toLowerCase() === target.toLowerCase(),
    };
    expect(whichSync("pnpm", env)?.toLowerCase()).toBe(target.toLowerCase());
  });

  it("ignores empty PATH segments instead of probing the drive root", () => {
    const target = win(BIN_DIR, "git.exe");
    expect(whichSync("git", winEnv([target], `;;${BIN_DIR};;`))?.toLowerCase()).toBe(target.toLowerCase());
  });

  it("tolerates quoted PATH entries", () => {
    const target = win(BIN_DIR, "git.exe");
    expect(whichSync("git", winEnv([target], `"${BIN_DIR}"`))?.toLowerCase()).toBe(target.toLowerCase());
  });
});

describe("whichSync — POSIX / Termux", () => {
  const PREFIX = "/data/data/com.termux/files/usr";
  const PATH = `${PREFIX}/bin:/system/bin`;

  it("resolves a Termux binary in $PREFIX/bin", () => {
    const env = posixEnv([`${PREFIX}/bin/node`], PATH);
    expect(whichSync("node", env)).toBe(`${PREFIX}/bin/node`);
  });

  it("resolves a Termux shell-script shim (npm) with no extension", () => {
    const env = posixEnv([`${PREFIX}/bin/npm`], PATH);
    expect(whichSync("npm", env)).toBe(`${PREFIX}/bin/npm`);
  });

  it("never appends Windows extensions on POSIX", () => {
    const env = posixEnv([`${PREFIX}/bin/pnpm.cmd`], PATH);
    expect(whichSync("pnpm", env)).toBeNull();
  });

  it("respects PATH order — Termux $PREFIX/bin shadows /system/bin", () => {
    const env = posixEnv([`${PREFIX}/bin/sh`, "/system/bin/sh"], PATH);
    expect(whichSync("sh", env)).toBe(`${PREFIX}/bin/sh`);
  });

  it("returns null when the command is absent", () => {
    const env = posixEnv([`${PREFIX}/bin/node`], PATH);
    expect(whichSync("yarn", env)).toBeNull();
  });

  it("returns null for an empty PATH", () => {
    const env = posixEnv([`${PREFIX}/bin/node`], "");
    expect(whichSync("node", env)).toBeNull();
  });
});

describe("whichSync — explicit paths", () => {
  it("resolves an absolute path directly without scanning PATH", () => {
    const env = posixEnv(["/opt/tools/adb"], "");
    expect(whichSync("/opt/tools/adb", env)).toBe("/opt/tools/adb");
  });

  it("returns null for an absolute path that does not exist", () => {
    const env = posixEnv([], "/usr/bin");
    expect(whichSync("/opt/tools/adb", env)).toBeNull();
  });

  it("applies PATHEXT to an explicit Windows path", () => {
    const target = win("C:", "tools", "adb.exe");
    const env = winEnv([target], "");
    expect(whichSync(win("C:", "tools", "adb"), env)?.toLowerCase()).toBe(target.toLowerCase());
  });
});

describe("needsCmdShell", () => {
  it("flags .cmd shims on Windows — these cannot be CreateProcess'd", () => {
    expect(needsCmdShell(win(BIN_DIR, "pnpm.CMD"), "win32")).toBe(true);
    expect(needsCmdShell(win(BIN_DIR, "npm.cmd"), "win32")).toBe(true);
  });

  it("flags .bat shims on Windows", () => {
    expect(needsCmdShell(win(BIN_DIR, "yarn.bat"), "win32")).toBe(true);
  });

  it("does not flag real executables", () => {
    expect(needsCmdShell(win(BIN_DIR, "git.exe"), "win32")).toBe(false);
  });

  it("never flags anything on POSIX — Termux has no cmd.exe", () => {
    expect(needsCmdShell("/usr/bin/npm.cmd", "linux")).toBe(false);
    expect(needsCmdShell("/data/data/com.termux/files/usr/bin/npm", "linux")).toBe(false);
  });
});
