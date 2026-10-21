/**
 * adb-client unit tests — binary resolution, failure typing,
 * argv construction, and devices -l parsing. Fully simulated —
 * no real adb process is spawned anywhere in this suite.
 */

import { describe, it, expect } from "vitest";
import {
  resolveAdb,
  classifyAdbFailure,
  runAdb,
  parseAdbDevices,
  type AdbDeps,
} from "../lib/android/adb-client.js";
import type { ShellResult } from "@litt/agent-core";
import { FakeShell, shellOk, shellFail } from "./fixtures/fake-shell.js";

const noEnv = () => undefined;
const noFile = () => false;

function makeResult(partial: Partial<ShellResult>): ShellResult {
  return {
    ok: partial.ok ?? false,
    status: partial.status ?? "failed",
    stdout: partial.stdout ?? "",
    stderr: partial.stderr ?? "",
    exitCode: partial.exitCode ?? 1,
    durationMs: 1,
    command: "adb",
    args: [],
    truncated: false,
    pid: null,
    ...partial,
  };
}

describe("resolveAdb", () => {
  it("prefers LITT_ADB_PATH when the file exists", () => {
    const r = resolveAdb({
      env: (k) => (k === "LITT_ADB_PATH" ? "C:\tools\adb.exe" : undefined),
      exists: (p) => p === "C:\tools\adb.exe",
      which: () => "C:\other\adb.exe",
    });
    expect(r).toEqual({ ok: true, path: "C:\tools\adb.exe" });
  });

  it("fails when LITT_ADB_PATH points at a missing file", () => {
    const r = resolveAdb({ env: (k) => (k === "LITT_ADB_PATH" ? "C:/nope\adb.exe" : undefined), exists: noFile, which: () => "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe("adb_missing");
  });

  it("falls back to injected adbPath", () => {
    const r = resolveAdb({ env: noEnv, adbPath: "adb.exe" });
    expect(r).toEqual({ ok: true, path: "adb.exe" });
  });

  it("falls back to PATH lookup", () => {
    const r = resolveAdb({ env: noEnv, which: () => "C:\sdk\adb.exe" });
    expect(r).toEqual({ ok: true, path: "C:\sdk\adb.exe" });
  });

  it("reports adb_missing when nothing resolves", () => {
    const r = resolveAdb({ env: noEnv, which: () => null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe("adb_missing");
      expect(r.failure.message).toContain("LITT_ADB_PATH");
    }
  });
});

describe("classifyAdbFailure", () => {
  it("maps timeout status", () => {
    expect(classifyAdbFailure(makeResult({ status: "timeout" })).kind).toBe("timeout");
  });
  it("maps cancelled status", () => {
    expect(classifyAdbFailure(makeResult({ status: "cancelled" })).kind).toBe("cancelled");
  });
  it("maps 'device not found'", () => {
    expect(classifyAdbFailure(makeResult({ stderr: "adb: error: device 'ABC123' not found" })).kind).toBe("device_not_found");
  });
  it("maps 'device offline'", () => {
    expect(classifyAdbFailure(makeResult({ stderr: "error: device offline" })).kind).toBe("device_offline");
  });
  it("maps unauthorized", () => {
    expect(classifyAdbFailure(makeResult({ stderr: "error: device unauthorized. Please check the confirmation dialog" })).kind).toBe("device_unauthorized");
  });
  it("maps no devices", () => {
    expect(classifyAdbFailure(makeResult({ stderr: "error: no devices/emulators found" })).kind).toBe("no_devices");
  });
  it("maps unknown failures to exec_failed with stderr preserved", () => {
    const f = classifyAdbFailure(makeResult({ stderr: "adb: something weird happened", exitCode: 7 }));
    expect(f.kind).toBe("exec_failed");
    expect(f.message).toContain("something weird");
  });
});

describe("runAdb", () => {
  const deps = (shell: FakeShell): AdbDeps => ({ shell, adbPath: "adb.exe", env: noEnv });

  it("injects -s serial before args", async () => {
    const shell = new FakeShell().onArgv(["-s", "SER123", "shell", "wm size"], shellOk("1080x2460"));
    const r = await runAdb(deps(shell), { serial: "SER123", args: ["shell", "wm size"] });
    expect(r.ok).toBe(true);
    expect(shell.calls[0].command).toBe("adb.exe");
    expect(shell.calls[0].args).toEqual(["-s", "SER123", "shell", "wm size"]);
  });

  it("omits -s for host-level commands", async () => {
    const shell = new FakeShell().onArgv(["devices", "-l"], shellOk("ok"));
    await runAdb(deps(shell), { args: ["devices", "-l"] });
    expect(shell.calls[0].args).toEqual(["devices", "-l"]);
  });

  it("always passes a bounded timeout", async () => {
    const shell = new FakeShell().onArgv(["devices"], shellOk());
    await runAdb(deps(shell), { args: ["devices"], timeoutMs: 10_000 });
    expect(shell.calls[0].timeoutMs).toBe(10_000);
    await runAdb(deps(shell), { args: ["devices"] });
    expect(shell.calls[1].timeoutMs).toBeGreaterThan(0);
  });

  it("returns typed failure on device_not_found", async () => {
    const shell = new FakeShell().onArgv(["-s"], shellFail("adb: error: device 'XYZ' not found"));
    const r = await runAdb(deps(shell), { serial: "XYZ", args: ["shell", "wm size"] });
    expect(r.ok).toBe(false);
    expect(r.failure?.kind).toBe("device_not_found");
  });

  it("never calls the shell when adb is unresolvable", async () => {
    const shell = new FakeShell();
    const r = await runAdb({ shell, env: noEnv, which: () => null }, { args: ["devices"] });
    expect(r.failure?.kind).toBe("adb_missing");
    expect(shell.calls).toHaveLength(0);
  });

  it("propagates timeout status", async () => {
    const shell = new FakeShell().onArgv(["-s"], shellFail("", 0, { status: "timeout", ok: false }));
    const r = await runAdb(deps(shell), { serial: "S", args: ["shell", "x"] });
    expect(r.status).toBe("timeout");
    expect(r.failure?.kind).toBe("timeout");
  });
});

describe("parseAdbDevices", () => {
  it("parses a real devices -l listing", () => {
    const out = "List of devices attached\nLBMRAIFEVSNRMFRO       device product:McCarty model:Celero3_5G_ device:U695DS transport_id:2\n\n";
    const d = parseAdbDevices(out);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ serial: "LBMRAIFEVSNRMFRO", state: "device", usable: true, model: "Celero3_5G_", transportId: "2" });
  });
  it("marks offline/unauthorized devices not usable", () => {
    const d = parseAdbDevices("List of devices attached\nAAA offline\nBBB unauthorized\nCCC device\n");
    expect(d.map((x) => x.usable)).toEqual([false, false, true]);
  });
  it("returns [] for empty output", () => {
    expect(parseAdbDevices("List of devices attached\n\n")).toEqual([]);
  });
});
