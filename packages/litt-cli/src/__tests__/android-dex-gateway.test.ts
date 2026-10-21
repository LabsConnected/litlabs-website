/**
 * Gateway enforcement for android.* tools + dex.status probe tests.
 * Proves the existing ExecutionGateway policy applies to the new tool
 * family: mutating ops require approval, read-only ops don't, PLAN
 * denies, AUTO-headless denies, and non-allowlisted devices are
 * rejected before any process spawns.
 */

import { describe, it, expect } from "vitest";
import {
  ExecutionGateway,
  ToolRegistry,
  CommandExecutor,
  RuntimeStore,
  setAdbTargetValidator,
} from "@litt/agent-core";
import { buildAndroidToolEntries } from "../lib/android/tools.js";
import { buildDexToolEntries } from "../lib/dex/tools.js";
import { probeDex } from "../lib/dex/dex-link.js";
import type { AndroidPolicy } from "../lib/android/device-registry.js";
import { FakeShell, shellOk, shellFail, withDevices, TEST_SERIAL, DEVICES_L } from "./fixtures/fake-shell.js";

const policy: AndroidPolicy = {
  allowedSerials: [TEST_SERIAL],
  allowedPackages: ["com.termux"],
  dex: { enabled: true, host: "127.0.0.1", port: 8022, user: "u0_a235", keyPath: "k", knownHostsPath: "kh" },
};

const ID = { tenantId: "t", userId: "u", actorId: "u", trusted: false, interaction: "interactive" as const };
const HEADLESS = { ...ID, interaction: "headless" as const };

function makeGateway(shell: FakeShell, onApproval?: () => Promise<boolean>) {
  const tools = new ToolRegistry(buildAndroidToolEntries({
    adbPath: "adb.exe", env: () => undefined, littHome: "LH",
    policyProvider: () => policy,
    opsDeps: { sleep: async () => {}, statFile: () => ({ size: 8, isFile: true }), readFileBytes: () => new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), mkdirp: () => {} },
  }));
  return new ExecutionGateway({
    tools, shell, executor: new CommandExecutor(shell, new RuntimeStore()),
    onApprovalRequired: onApproval ?? null,
  });
}

function exec(gw: ExecutionGateway, toolId: string, inputs: Record<string, unknown>, mode: "plan"|"act"|"auto", identity = ID) {
  return gw.execute({ toolId, inputs, cwd: "C:\proj", mode, identity });
}

describe("gateway policy on android.* tools", () => {
  it("android.devices is read-only: allowed in all modes without approval", async () => {
    const shell = withDevices(new FakeShell());
    for (const mode of ["plan", "act", "auto"] as const) {
      const r = await exec(makeGateway(shell), "android.devices", {}, mode);
      expect(r.result.success).toBe(true);
    }
  });
  it("android.tap is denied in PLAN before spawning", async () => {
    const shell = withDevices(new FakeShell());
    const r = await exec(makeGateway(shell), "android.tap", { x: 1, y: 2 }, "plan");
    expect(r.result.success).toBe(false);
    expect(shell.calls).toHaveLength(0);
  });
  it("android.tap requires approval in ACT and executes after VerifiedApproval", async () => {
    const shell = withDevices(new FakeShell());
    shell.onArgv(["wm size"], shellOk("Physical size: 1080x2460"));
    shell.onArgv(["input"], shellOk());
    let asked = 0;
    const gw = makeGateway(shell, async () => { asked++; return true; });
    const r = await exec(gw, "android.tap", { x: 1, y: 2 }, "act");
    expect(asked).toBe(1);
    expect(r.result.success).toBe(true);
    expect(r.approved).toBe(true);
  });
  it("android.tap denied in ACT when the human says no — zero adb calls", async () => {
    const shell = withDevices(new FakeShell());
    const gw = makeGateway(shell, async () => false);
    const r = await exec(gw, "android.tap", { x: 1, y: 2 }, "act");
    expect(r.result.success).toBe(false);
    expect(shell.calls).toHaveLength(0);
  });
  it("android.screenshot requires approval (mutating) in ACT", async () => {
    const shell = withDevices(new FakeShell());
    const gw = makeGateway(shell, async () => false);
    const r = await exec(gw, "android.screenshot", {}, "act");
    expect(r.result.success).toBe(false);
    expect(r.denialReason).toContain("Approval");
  });
  it("AUTO headless denies mutating ops — no manufactured approval", async () => {
    const shell = withDevices(new FakeShell());
    const gw = makeGateway(shell); // no approval callback
    const r = await exec(gw, "android.key", { name: "home" }, "auto", HEADLESS);
    expect(r.result.success).toBe(false);
    expect(shell.calls).toHaveLength(0);
  });
});

describe("probeDex", () => {
  const cfg = policy.dex;
  const keyFiles = (p: string) => p === "k" || p === "kh";

  it("reports blocker when the private key is missing", async () => {
    const r = await probeDex({ shell: new FakeShell(), adbPath: "adb.exe", exists: () => false }, cfg);
    expect(r.linkUp).toBe(false);
    expect(r.blocker).toContain("key");
  });
  it("attempts adb forward when a serial is provided", async () => {
    const shell = new FakeShell();
    shell.onArgv(["forward"], shellOk("8022"));
    const r = await probeDex({ shell, adbPath: "adb.exe", exists: keyFiles, adbSerial: TEST_SERIAL }, cfg);
    expect(r.forwardAttempted).toBe(true);
    expect(shell.calls.some((c) => c.args?.includes("forward"))).toBe(true);
  });
  it("reports unreachable when ssh handshake fails", async () => {
    const shell = new FakeShell();
    shell.onArgv(["echo"], shellFail("Connection refused", 255));
    const r = await probeDex({ shell, adbPath: "adb.exe", exists: keyFiles, sshPath: "ssh" }, cfg);
    expect(r.linkUp).toBe(false);
    expect(r.blocker).toBeTruthy();
  });
  it("reports link up + dex detection when ssh answers", async () => {
    const shell = new FakeShell();
    shell.onArgv(["echo"], shellOk("litt-dex-probe-ok"));
    shell.onArgv(["ps"], shellOk("node /data/.../dex-agent.js\nsshd\n"));
    const r = await probeDex({ shell, adbPath: "adb.exe", exists: keyFiles, sshPath: "ssh" }, cfg);
    expect(r.linkUp).toBe(true);
    expect(r.dexRunning).toBe(true);
    const sshCall = shell.calls.find((c) => c.command === "ssh");
    expect(sshCall?.args).toContain("BatchMode=yes");
    expect(sshCall?.args?.join(" ")).toContain("StrictHostKeyChecking=yes");
  });
});

describe("project.run adb — hardened classification (no bypass)", () => {
  // The shared boundary validator is registered globally by device-tools
  // at runtime; these tests register a permissive stand-in so the
  // classification tier (what this suite measures) is what decides.
  setAdbTargetValidator(async () => ({ ok: true }));
  function runAdbViaProjectRun(shell: FakeShell, args: string[], mode: "plan"|"act"|"auto", identity = ID, onApproval?: () => Promise<boolean>) {
    const gw = makeGateway(shell, onApproval);
    return gw.execute({ toolId: "project.run", inputs: { command: "adb", args }, cwd: "C:\proj", mode, identity });
  }

  it("adb devices stays read-only — allowed without approval", async () => {
    const shell = withDevices(new FakeShell());
    const r = await runAdbViaProjectRun(shell, ["devices", "-l"], "act");
    expect(r.result.success).toBe(true);
  });
  it("adb shell rm → destructive: denied in AUTO even headless", async () => {
    const shell = new FakeShell();
    const r = await runAdbViaProjectRun(shell, ["shell", "rm", "-rf", "/sdcard"], "auto", HEADLESS);
    expect(r.result.success).toBe(false);
    expect(shell.calls).toHaveLength(0);
  });
  it("adb install → destructive: requires approval in ACT", async () => {
    const shell = new FakeShell();
    let asked = 0;
    const r = await runAdbViaProjectRun(shell, ["install", "evil.apk"], "act", ID, async () => { asked++; return false; });
    expect(asked).toBe(1);
    expect(r.result.success).toBe(false);
    expect(shell.calls).toHaveLength(0);
  });
  it("adb reboot → destructive: denied in AUTO", async () => {
    const shell = new FakeShell();
    const r = await runAdbViaProjectRun(shell, ["reboot"], "auto", HEADLESS);
    expect(r.result.success).toBe(false);
  });
  it("adb root → destructive (privilege escalation): denied in AUTO", async () => {
    const shell = new FakeShell();
    const r = await runAdbViaProjectRun(shell, ["root"], "auto", HEADLESS);
    expect(r.result.success).toBe(false);
  });
  it("adb shell getprop → read_only through -s flags: no approval needed", async () => {
    const shell = new FakeShell().onArgv(["getprop"], shellOk("14"));
    const r = await runAdbViaProjectRun(shell, ["-s", "SER", "shell", "getprop", "ro.ver"], "act");
    expect(r.risk?.capability).toBe("read_only");
  });
  it("adb shell input tap → elevated: approval in ACT (same tier as android.tap)", async () => {
    const shell = new FakeShell().onArgv(["input"], shellOk());
    let asked = 0;
    const r = await runAdbViaProjectRun(shell, ["shell", "input", "tap", "1", "2"], "act", ID, async () => { asked++; return true; });
    expect(asked).toBe(1);
    expect(r.result.success).toBe(true);
  });
});

describe("placeholder serial through the gateway", () => {
  // The captured live failure: the model passed the literal string
  // "ANDROID_SERIAL" as serial. It must fail closed with a clear
  // placeholder error — never substituted, never allowlist-padded.
  it("approved android.screenshot with ANDROID_SERIAL fails closed — ZERO mutations", async () => {
    const shell = withDevices(new FakeShell());
    shell.onArgv(["mkdir"], shellOk());
    shell.onArgv(["screencap"], shellOk());
    let asked = 0;
    const gw = makeGateway(shell, async () => { asked++; return true; });
    const r = await exec(gw, "android.screenshot", { serial: "ANDROID_SERIAL" }, "act");
    expect(asked).toBe(1);               // mandatory approval still ran
    expect(r.result.success).toBe(false);
    expect(String(r.result.message)).toContain("placeholder");
    // Approval was granted but NO adb call ran — not even enumeration.
    expect(shell.calls).toHaveLength(0);
  });
  it("an approved mutation executes EXACTLY once — one mutating adb call", async () => {
    const shell = withDevices(new FakeShell());
    shell.onArgv(["input"], shellOk());
    const gw = makeGateway(shell, async () => true);
    const r = await exec(gw, "android.key", { name: "home" }, "act");
    expect(r.result.success).toBe(true);
    const mutations = shell.calls.filter((c) => c.args?.includes("keyevent"));
    expect(mutations).toHaveLength(1);
  });
});

describe("android.key arg-alias tolerance (model arg naming)", () => {
  // Models frequently emit key/keyName/keyCode instead of the declared
  // "name" field. The handler normalizes aliases so a valid keyevent
  // is not failed on a naming mismatch (observed: × Android Key while
  // the approval prompt was pending on a sibling call).
  it.each([{ name: "home" }, { key: "home" }, { keyName: "home" }, { keyCode: "home" }])(
    "accepts %j after approval",
    async (inputs) => {
      const shell = withDevices(new FakeShell());
      shell.onArgv(["input"], shellOk());
      const gw = makeGateway(shell, async () => true);
      const r = await exec(gw, "android.key", inputs as Record<string, unknown>, "act");
      expect(r.result.success).toBe(true);
    },
  );
});
