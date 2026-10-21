/**
 * Device-identity boundary tests — the shared runCommand() validator.
 *
 * Proves unauthorized, ambiguous, malformed, or disconnected adb
 * targets are rejected BEFORE the real command reaches the shell
 * executor, covering explicit -s, -t, ANDROID_SERIAL, and implicit
 * selection. Simulated: FakeShell only ever sees `devices -l`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { runCommand, setAdbTargetValidator, type ShellExecutor } from "@litt/agent-core";
import { validateAdbTarget } from "../lib/android/boundary.js";
import { setAdbTargetValidator as setValidator } from "@litt/agent-core";
import type { AndroidPolicy } from "../lib/android/device-registry.js";
import { FakeShell, shellOk, TEST_SERIAL, DEVICES_L } from "./fixtures/fake-shell.js";

const policy: AndroidPolicy = {
  allowedSerials: [TEST_SERIAL],
  allowedPackages: ["com.termux"],
  dex: { enabled: true, host: "h", port: 1, user: "u", keyPath: "k", knownHostsPath: "kh" },
};

const OTHER_L =
  "List of devices attached\nEVILSERIAL99       device product:X model:Y device:Z transport_id:9\n";

function shellWith(listing = DEVICES_L): FakeShell {
  return new FakeShell().onArgv(["devices", "-l"], shellOk(listing)).onArgv(["input"], shellOk());
}

/** Register the REAL boundary validator backed by the test policy. */
function registerReal(envSerial?: string): void {
  setValidator((args, shell) =>
    validateAdbTarget(args, shell, {
      policyProvider: () => policy,
      env: (k) => (k === "ANDROID_SERIAL" ? envSerial : undefined),
      adbPath: "adb.exe",
    }),
  );
}

afterEachClear();
function afterEachClear() {
  beforeEach(() => setValidator(null));
}

describe("runCommand adb boundary — fail closed", () => {
  it("device-targeting adb with NO validator is blocked before spawn", async () => {
    setValidator(null);
    const shell = shellWith();
    const r = await runCommand(shell as ShellExecutor, "adb", ["shell", "getprop", "x"], { mode: "auto" });
    expect(r.success).toBe(false);
    expect(shell.calls).toHaveLength(0);
  });
  it("host-level adb ops do not need a validator", async () => {
    setValidator(null);
    const shell = new FakeShell().onArgv(["devices"], shellOk(DEVICES_L));
    const r = await runCommand(shell as ShellExecutor, "adb", ["devices", "-l"], { mode: "auto" });
    expect(r.success).toBe(true);
  });
});

describe("validateAdbTarget — explicit selection", () => {
  it("allowlisted + connected -s target passes", async () => {
    registerReal();
    const shell = shellWith();
    const r = await runCommand(shell as ShellExecutor, "adb", ["-s", TEST_SERIAL, "shell", "input", "keyevent", "KEYCODE_HOME"], { mode: "auto", timeoutMs: 5000 });
    expect(r.success).toBe(true);
  });
  it("unauthorized -s serial is rejected before the command runs", async () => {
    registerReal();
    const shell = shellWith();
    const r = await runCommand(shell as ShellExecutor, "adb", ["-s", "EVILSERIAL99", "shell", "rm", "-rf", "/sdcard"], { mode: "auto" });
    expect(r.success).toBe(false);
    expect(r.message).toContain("not in the Android allowlist");
    // Only the enumeration call reached the shell — never the command.
    expect(shell.calls.every((c) => c.args?.includes("devices"))).toBe(true);
  });
  it("allowlisted but disconnected serial is rejected", async () => {
    registerReal();
    const shell = shellWith(OTHER_L); // TEST_SERIAL not attached
    const r = await runCommand(shell as ShellExecutor, "adb", ["-s", TEST_SERIAL, "shell", "getprop", "x"], { mode: "auto" });
    expect(r.success).toBe(false);
    expect(r.message).toContain("not attached");
  });
  it("offline device state is rejected as not-ready", async () => {
    registerReal();
    const shell = shellWith(`List\n${TEST_SERIAL} offline\n`);
    const r = await runCommand(shell as ShellExecutor, "adb", ["-s", TEST_SERIAL, "shell", "x"], { mode: "auto" });
    expect(r.success).toBe(false);
  });
  it("malformed serial is rejected", async () => {
    registerReal();
    const shell = shellWith();
    const r = await runCommand(shell as ShellExecutor, "adb", ["-s", "bad;serial", "shell", "x"], { mode: "auto" });
    expect(r.success).toBe(false);
  });
  it("-t transport targeting is rejected outright", async () => {
    registerReal();
    const shell = shellWith();
    const r = await runCommand(shell as ShellExecutor, "adb", ["-t", "2", "shell", "x"], { mode: "auto" });
    expect(r.success).toBe(false);
    expect(r.message).toContain("transport");
  });
  it("ANDROID_SERIAL env is enforced like an explicit -s", async () => {
    registerReal("EVILSERIAL99");
    const shell = shellWith();
    const r = await runCommand(shell as ShellExecutor, "adb", ["shell", "x"], { mode: "auto" });
    expect(r.success).toBe(false);
    expect(r.message).toContain("allowlist");
  });
});

describe("validateAdbTarget — implicit selection", () => {
  it("single allowlisted+usable device resolves implicitly", async () => {
    registerReal();
    const shell = shellWith();
    const r = await runCommand(shell as ShellExecutor, "adb", ["shell", "input", "tap", "1", "2"], { mode: "auto" });
    expect(r.success).toBe(true);
  });
  it("implicit targeting to a NON-allowlisted device is denied", async () => {
    registerReal();
    const shell = shellWith(OTHER_L);
    const r = await runCommand(shell as ShellExecutor, "adb", ["shell", "getprop", "x"], { mode: "auto" });
    expect(r.success).toBe(false);
    expect(r.message).toContain("allowlist");
  });
  it("ambiguous multi-device implicit targeting is denied", async () => {
    registerReal();
    const shell = shellWith(DEVICES_L + OTHER_L.split("\n")[1] + "\n");
    const r = await runCommand(shell as ShellExecutor, "adb", ["shell", "x"], { mode: "auto" });
    expect(r.success).toBe(false);
    expect(r.message).toContain("ambiguous");
  });
});
