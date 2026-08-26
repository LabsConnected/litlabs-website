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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { whichSync, needsCmdShell, tryCommandOutputAsync, buildCmdCommandString, type WhichEnv } from "../lib/which.js";

const WIN_PATHEXT = ".COM;.EXE;.BAT;.CMD";

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

describe("buildCmdCommandString — CMD command construction", () => {
  it("quotes the resolved path and joins safe args", () => {
    // Outer wrapper: /s strips first and last quote, leaving inner quotes.
    expect(buildCmdCommandString("C:\\tools\\pnpm.cmd", ["--version"])).toBe(
      '""C:\\tools\\pnpm.cmd" --version"',
    );
  });

  it("double-quotes args containing spaces", () => {
    expect(buildCmdCommandString("C:\\tools\\app.cmd", ["--flag", "value with spaces"])).toBe(
      '""C:\\tools\\app.cmd" --flag "value with spaces""',
    );
  });

  it("handles no args", () => {
    expect(buildCmdCommandString("C:\\tools\\app.cmd", [])).toBe('""C:\\tools\\app.cmd""');
  });

  it("rejects args containing & (command chaining)", () => {
    expect(() => buildCmdCommandString("C:\\app.cmd", ["--version&echo HACKED"])).toThrow();
  });

  it("rejects args containing | (pipe)", () => {
    expect(() => buildCmdCommandString("C:\\app.cmd", ["--version|whoami"])).toThrow();
  });

  it("rejects args containing > (redirect)", () => {
    expect(() => buildCmdCommandString("C:\\app.cmd", [">C:\\evil.txt"])).toThrow();
  });

  it("rejects args containing % (variable expansion)", () => {
    expect(() => buildCmdCommandString("C:\\app.cmd", ["%PATH%"])).toThrow();
  });

  it("rejects args containing ^ (escape char)", () => {
    expect(() => buildCmdCommandString("C:\\app.cmd", ["^&whoami"])).toThrow();
  });

  it("rejects args containing double-quotes", () => {
    expect(() => buildCmdCommandString("C:\\app.cmd", ['"injected"'])).toThrow();
  });

  it("rejects args containing parentheses", () => {
    expect(() => buildCmdCommandString("C:\\app.cmd", ["(whoami)"])).toThrow();
  });

  it("rejects a resolved path containing a double-quote", () => {
    expect(() => buildCmdCommandString('C:\\ev"il.cmd', ["--version"])).toThrow();
  });

  it("rejects a resolved path containing %", () => {
    expect(() => buildCmdCommandString("C:\\%bad%.cmd", ["--version"])).toThrow();
  });

  it("rejects a resolved path containing CR", () => {
    expect(() => buildCmdCommandString("C:\\bad\r.cmd", ["--version"])).toThrow();
  });

  it("rejects a resolved path containing LF", () => {
    expect(() => buildCmdCommandString("C:\\bad\n.cmd", ["--version"])).toThrow();
  });
});

// ─── Native Windows runtime tests — real .cmd shim execution ───────
//
// These tests create REAL temporary .cmd files in a directory whose
// path contains spaces, then execute them through tryCommandOutputAsync.
// They exercise the actual cmd.exe spawn path — no mocks, no spawnImpl.
// Skipped on non-Windows platforms (Termux/POSIX/WSL-Linux have no
// cmd.exe).

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const isWindows = process.platform === "win32";
const describeWin = isWindows ? describe : describe.skip;

describeWin("tryCommandOutputAsync — Windows runtime (.cmd shim execution)", () => {
  let baseTmpDir: string;
  let tmpDir: string;

  beforeEach(() => {
    baseTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "which-rt-"));
    // Directory name contains a space — exercises path quoting through
    // the real cmd.exe /s /c path.
    tmpDir = path.join(baseTmpDir, "tools with spaces");
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(baseTmpDir, { recursive: true, force: true });
  });

  /** Write a .cmd shim that echoes a fixed version string. */
  function writeVersionShim(name: string, version: string): string {
    const p = path.join(tmpDir, `${name}.cmd`);
    fs.writeFileSync(p, `@echo off\r\necho ${version}\r\nexit /b 0\r\n`, "utf8");
    return p;
  }

  /** Write a .cmd shim that echoes its first argument verbatim. */
  function writeEchoArgShim(name: string): string {
    const p = path.join(tmpDir, `${name}.cmd`);
    // %~1 is %1 with surrounding quotes stripped — the standard CMD
    // idiom. By echoing it back, we verify that spaces in the argument
    // survive the CMD quoting and arrive as a single argument.
    fs.writeFileSync(p, `@echo off\r\necho %~1\r\nexit /b 0\r\n`, "utf8");
    return p;
  }

  /** Write a .cmd shim that creates a marker file — proves it executed. */
  function writeMarkerShim(name: string, markerPath: string): string {
    const p = path.join(tmpDir, `${name}.cmd`);
    // If this shim executes, it creates a file at markerPath.
    fs.writeFileSync(p, `@echo off\r\necho. > "${markerPath}"\r\necho ran\r\nexit /b 0\r\n`, "utf8");
    return p;
  }

  /** Write a .cmd shim that exits with a nonzero code. */
  function writeFailingShim(name: string): string {
    const p = path.join(tmpDir, `${name}.cmd`);
    fs.writeFileSync(p, `@echo off\r\necho oops\r\nexit /b 1\r\n`, "utf8");
    return p;
  }

  /** Write a .cmd shim that sleeps for several seconds. */
  function writeSlowShim(name: string): string {
    const p = path.join(tmpDir, `${name}.cmd`);
    // ping -n 4 takes ~3 seconds on Windows.
    fs.writeFileSync(p, `@echo off\r\nping -n 4 127.0.0.1 >nul\r\necho late\r\nexit /b 0\r\n`, "utf8");
    return p;
  }

  it("executes a .cmd shim in a path containing spaces (ordinary --version arg)", async () => {
    writeVersionShim("mytool", "1.2.3");
    const result = await tryCommandOutputAsync("mytool", ["--version"], {
      platform: "win32",
      pathVar: tmpDir,
      pathExt: WIN_PATHEXT,
    });
    expect(result).toBe("1.2.3");
  });

  it("preserves an argument containing spaces as a single argument", async () => {
    // The shim echoes %~1 back. If the argument "hello world" arrives
    // intact as one argument, the output is "hello world". If CMD
    // split it on the space, the output would be "hello".
    writeEchoArgShim("echotool");
    const result = await tryCommandOutputAsync("echotool", ["hello world"], {
      platform: "win32",
      pathVar: tmpDir,
      pathExt: WIN_PATHEXT,
    });
    expect(result).toBe("hello world");
  });

  it("returns null for a nonzero exit code", async () => {
    writeFailingShim("failtool");
    const result = await tryCommandOutputAsync("failtool", ["--version"], {
      platform: "win32",
      pathVar: tmpDir,
      pathExt: WIN_PATHEXT,
    });
    expect(result).toBeNull();
  });

  it("returns null on a genuine timeout (configurable short timeout)", async () => {
    // Use a 500ms timeout — the shim sleeps ~3s, so it will time out.
    writeSlowShim("slowtool");
    const start = Date.now();
    const result = await tryCommandOutputAsync("slowtool", ["--version"], {
      platform: "win32",
      pathVar: tmpDir,
      pathExt: WIN_PATHEXT,
      timeoutMs: 500,
    });
    const durationMs = Date.now() - start;
    expect(result).toBeNull();
    // Should return well under the shim's sleep time, with headroom
    // for taskkill/cleanup latency on loaded machines.
    expect(durationMs).toBeLessThan(4000);
  }, 10000);

  it("rejects an argument containing %", async () => {
    writeVersionShim("pctool", "1.0.0");
    const result = await tryCommandOutputAsync("pctool", ["%PATH%"], {
      platform: "win32",
      pathVar: tmpDir,
      pathExt: WIN_PATHEXT,
    });
    expect(result).toBeNull();
  });

  it("rejects a metacharacter injection attempt (&) and prevents execution", async () => {
    // The shim creates a marker file if it runs. The injection arg
    // contains & — buildCmdCommandString rejects it, so the shim must
    // NOT execute and the marker file must NOT exist.
    const markerPath = path.join(baseTmpDir, "injected.marker");
    writeMarkerShim("safetool", markerPath);
    const result = await tryCommandOutputAsync("safetool", ["--version&echo HACKED"], {
      platform: "win32",
      pathVar: tmpDir,
      pathExt: WIN_PATHEXT,
    });
    expect(result).toBeNull();
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it("rejects a redirect injection attempt (>) and prevents execution", async () => {
    const markerPath = path.join(baseTmpDir, "redirect.marker");
    writeMarkerShim("safetool2", markerPath);
    const result = await tryCommandOutputAsync("safetool2", [">C:\\evil.txt"], {
      platform: "win32",
      pathVar: tmpDir,
      pathExt: WIN_PATHEXT,
    });
    expect(result).toBeNull();
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it("returns null when the command is not found", async () => {
    const result = await tryCommandOutputAsync("nonexistent-tool-xyz", ["--version"], {
      platform: "win32",
      pathVar: tmpDir,
      pathExt: WIN_PATHEXT,
    });
    expect(result).toBeNull();
  });
});
