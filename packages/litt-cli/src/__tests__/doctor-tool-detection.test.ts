/**
 * `litt doctor` executable detection — Windows regression.
 *
 * THE BUG
 *   doctor reported
 *
 *     pnpm: not installed
 *     npm: not installed
 *     yarn: not installed
 *
 *   on a machine where all three were installed, on PATH, and actively
 *   running the build — while correctly reporting git.
 *
 * THE CAUSE
 *   doctor probed with `execFileSync(cmd, args, { shell: false })`. On
 *   Windows that is a raw CreateProcess, which can only launch real PE
 *   executables. `git` resolves to `git.exe` and worked. `pnpm`, `npm`
 *   and `yarn` are `.CMD` batch shims, so every call threw ENOENT and was
 *   reported as absent.
 *
 * THE FIX
 *   doctor now probes through the canonical resolver (lib/which.ts),
 *   which walks PATH with PATHEXT applied and routes batch shims through
 *   cmd.exe. lib/which.ts already owns the resolution rules and their
 *   tests (which.test.ts); what THIS file pins down is that doctor
 *   actually goes through it — the regression was doctor bypassing a
 *   resolver that already existed.
 *
 * No machine paths are hardcoded: every case builds its own PATH.
 */

import { describe, it, expect } from "vitest";
import { probeToolVersions } from "../commands/doctor.js";
import { whichSync, needsCmdShell } from "../lib/which.js";

describe("doctor tool detection — routes through the canonical resolver", () => {
  it("consults the injected resolver environment rather than probing directly", async () => {
    // With a resolver environment in which NOTHING exists, every probe
    // must report absent. The old execFileSync implementation ignored
    // resolution entirely and would still have found the real git on
    // this machine's PATH — so this fails loudly on a regression.
    const versions = await probeToolVersions({
      platform: "win32",
      pathVar: "C:\\nowhere",
      pathExt: ".COM;.EXE;.BAT;.CMD",
      existsImpl: () => false,
    });

    expect(versions).toEqual({ git: null, pnpm: null, npm: null, yarn: null });
  });

  it("resolves the .CMD shims doctor used to miss", () => {
    // The exact shape of the bug: a Windows PATH whose only entries for
    // pnpm/npm/yarn are batch shims, alongside a real git.exe.
    const onDisk = new Set([
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\pnpm.CMD",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\npm.CMD",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\yarn.CMD",
      "C:\\Program Files\\Git\\cmd\\git.exe",
    ].map((p) => p.toLowerCase()));
    const env = {
      platform: "win32" as const,
      pathVar: "C:\\Users\\dev\\AppData\\Roaming\\npm;C:\\Program Files\\Git\\cmd",
      pathExt: ".COM;.EXE;.BAT;.CMD",
      // Windows filesystems are case-insensitive, so on-disk `git.exe`
      // matches the `.EXE` candidate PATHEXT produces.
      existsImpl: (p: string) => onDisk.has(p.toLowerCase()),
    };

    for (const tool of ["pnpm", "npm", "yarn"]) {
      const resolved = whichSync(tool, env);
      expect(resolved, `${tool} must resolve to its .CMD shim`).not.toBeNull();
      expect(needsCmdShell(resolved!, "win32")).toBe(true);
    }

    // git kept working before the fix because it is a real executable.
    const git = whichSync("git", env);
    expect(git?.toLowerCase()).toBe("c:\\program files\\git\\cmd\\git.exe");
    expect(needsCmdShell(git!, "win32")).toBe(false);
  });

  it("still reports a genuinely missing tool as absent on Windows", async () => {
    const versions = await probeToolVersions({
      platform: "win32",
      pathVar: "C:\\tools",
      pathExt: ".COM;.EXE;.BAT;.CMD",
      // Only pnpm exists — but as a shim path that cannot actually run,
      // so the probe reports null. Absent stays absent; nothing is faked.
      existsImpl: (p: string) => p === "C:\\tools\\pnpm.CMD",
    });

    expect(versions.npm).toBeNull();
    expect(versions.yarn).toBeNull();
    expect(versions.git).toBeNull();
  });
});
