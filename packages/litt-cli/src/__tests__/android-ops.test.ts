/**
 * Android ops tests — validation, allowlist enforcement, verified
 * vs unverified outcomes, timeouts, and disconnect handling.
 * Fully simulated: FakeShell scripts the adb transcripts.
 */

import { describe, it, expect } from "vitest";
import { createAndroidOps, type AndroidOpsDeps, REMOTE_LITT_DIR } from "../lib/android/ops.js";
import type { AndroidPolicy } from "../lib/android/device-registry.js";
import { FakeShell, shellOk, shellFail, withDevices, TEST_SERIAL, DEVICES_L } from "./fixtures/fake-shell.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const policy: AndroidPolicy = {
  allowedSerials: [TEST_SERIAL],
  allowedPackages: ["com.termux", "com.android.settings"],
  dex: { enabled: true, host: "127.0.0.1", port: 8022, user: "u0_a235", keyPath: "k", knownHostsPath: "kh" },
};

function makeDeps(shell: FakeShell, extra: Partial<AndroidOpsDeps> = {}): AndroidOpsDeps {
  return {
    shell,
    adbPath: "adb.exe",
    env: () => undefined,
    littHome: "LITT_HOME",
    policyProvider: () => policy,
    sleep: async () => {},
    exists: () => true,
    statFile: () => ({ size: PNG.length, isFile: true }),
    readFileBytes: () => PNG,
    mkdirp: () => {},
    ...extra,
  };
}

function opsFor(shell: FakeShell, extra: Partial<AndroidOpsDeps> = {}) {
  return createAndroidOps(makeDeps(shell, extra));
}

describe("listDevices", () => {
  it("lists devices with allowlist flags", async () => {
    const shell = withDevices(new FakeShell());
    const r = await opsFor(shell).listDevices();
    expect(r.ok).toBe(true);
    const devices = r.data.devices as Array<{ serial: string; allowlisted: boolean }>;
    expect(devices[0].serial).toBe(TEST_SERIAL);
    expect(devices[0].allowlisted).toBe(true);
  });
  it("reports adb failure honestly", async () => {
    const shell = new FakeShell().onArgv(["devices"], shellFail("adb not found"));
    const r = await opsFor(shell).listDevices();
    expect(r.ok).toBe(false);
  });
});

describe("deviceState", () => {
  function stateShell(): FakeShell {
    const s = withDevices(new FakeShell());
    s.onArgv(["getprop ro.product.model"], shellOk("Celero3 5G+\n"));
    s.onArgv(["getprop ro.build.version.release"], shellOk("14\n"));
    s.onArgv(["dumpsys power"], shellOk("mWakefulness=Awake\n"));
    s.onArgv(["dumpsys window"], shellOk("mCurrentFocus=Window{a1b2 u0 com.termux/.app.TermuxActivity}\n"));
    s.onArgv(["dumpsys battery"], shellOk("  level: 83\n"));
    return s;
  }
  it("reports parsed device state", async () => {
    const r = await opsFor(stateShell()).deviceState();
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.data.model).toBe("Celero3 5G+");
    expect(r.data.androidVersion).toBe("14");
    expect(r.data.screen).toBe("awake");
    expect(r.data.foregroundPackage).toBe("com.termux");
    expect(r.data.batteryPercent).toBe(83);
  });
  it("rejects a non-allowlisted serial without spawning more adb calls", async () => {
    const shell = stateShell();
    const r = await opsFor(shell).deviceState("EVILSERIAL");
    expect(r.ok).toBe(false);
    expect((r.data.failure as string)).toBe("not_allowlisted");
    // Only the initial devices -l call may have run.
    expect(shell.calls.length).toBeLessThanOrEqual(1);
  });
  it("reports a missing device honestly", async () => {
    const shell = new FakeShell().onArgv(["devices"], shellOk("List of devices attached\n\n"));
    const r = await opsFor(shell).deviceState(TEST_SERIAL);
    expect(r.ok).toBe(false);
    expect(r.data.failure).toBe("device_not_found");
  });
});

describe("placeholder serial — fail closed before any adb spawn", () => {
  // The exact live failure: the model passed the literal string
  // "ANDROID_SERIAL" (copied from the adb env-var convention) as the
  // serial argument. A placeholder must fail closed with a clear error
  // and must NEVER spawn an adb process or substitute another device.
  it.each(["ANDROID_SERIAL", "$ANDROID_SERIAL", "<serial>", "DEVICE_SERIAL"])(
    "rejects placeholder %j with ZERO adb calls and no substitution",
    async (ph) => {
      const shell = inputShell();
      const r = await opsFor(shell).screenshot(ph);
      expect(r.ok).toBe(false);
      expect(r.data.failure).toBe("invalid_serial");
      expect(r.message).toContain("placeholder");
      expect(r.message).toContain("auto-select");
      // Zero adb invocations — not even `devices -l` enumeration.
      expect(shell.calls.length).toBe(0);
    },
  );

  it("an omitted serial auto-selects the single allowlisted device", async () => {
    const shell = withDevices(new FakeShell());
    shell.onArgv(["getprop ro.product.model"], shellOk("Celero3 5G+\n"));
    shell.onArgv(["getprop ro.build.version.release"], shellOk("14\n"));
    shell.onArgv(["dumpsys power"], shellOk("mWakefulness=Awake\n"));
    shell.onArgv(["dumpsys window"], shellOk("mCurrentFocus=Window{a1b2 u0 com.termux/.app.TermuxActivity}\n"));
    shell.onArgv(["dumpsys battery"], shellOk("  level: 83\n"));
    const r = await opsFor(shell).deviceState(undefined);
    expect(r.ok).toBe(true);
    expect(r.data.serial).toBe(TEST_SERIAL);
  });
});

function inputShell(): FakeShell {
  const s = withDevices(new FakeShell());
  s.onArgv(["wm size"], shellOk("Physical size: 1080x2460\n"));
  s.onArgv(["input"], shellOk());
  return s;
}

describe("input ops", () => {
  it("tap sends validated coordinates", async () => {
    const shell = inputShell();
    const r = await opsFor(shell).tap(540, 1200);
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(false); // no on-screen confirmation channel
    const tapCall = shell.calls.find((c) => c.args?.includes("tap"));
    expect(tapCall?.args).toContain("540");
    expect(tapCall?.args).toContain("1200");
  });
  it("tap rejects out-of-bounds coordinates without spawning input", async () => {
    const shell = inputShell();
    const r = await opsFor(shell).tap(9999, 1200);
    expect(r.ok).toBe(false);
    expect(r.data.failure).toBe("invalid_arg");
    expect(shell.calls.some((c) => c.args?.includes("input"))).toBe(false);
  });
  it("tap rejects non-integer input", async () => {
    const r = await opsFor(inputShell()).tap("abc", 10);
    expect(r.ok).toBe(false);
  });
  it("swipe sends all five args with bounded duration", async () => {
    const shell = inputShell();
    const r = await opsFor(shell).swipe(540, 2000, 540, 400, 300);
    expect(r.ok).toBe(true);
    const c = shell.calls.find((x) => x.args?.includes("swipe"));
    expect(c?.args).toEqual(expect.arrayContaining(["swipe", "540", "2000", "540", "400", "300"]));
  });
  it("swipe rejects duration outside 50–5000ms", async () => {
    const r = await opsFor(inputShell()).swipe(1, 1, 2, 2, 99999);
    expect(r.ok).toBe(false);
    expect(r.data.failure).toBe("invalid_arg");
  });
  it("key sends allowlisted keyevents only", async () => {
    const shell = inputShell();
    const r = await opsFor(shell).key("home");
    expect(r.ok).toBe(true);
    expect(shell.calls.some((c) => c.args?.includes("KEYCODE_HOME"))).toBe(true);
  });
  it("key rejects non-allowlisted names without spawning", async () => {
    const shell = inputShell();
    const r = await opsFor(shell).key("power_long_press_factory_wipe");
    expect(r.ok).toBe(false);
    expect(shell.calls.some((c) => c.args?.includes("keyevent"))).toBe(false);
  });
  it("typeText sends quoted escaped text", async () => {
    const shell = inputShell();
    const r = await opsFor(shell).typeText("hello world");
    expect(r.ok).toBe(true);
    const c = shell.calls.find((x) => x.args?.includes("text"));
    expect(c?.args?.at(-1)).toBe("'hello%sworld'");
  });
  it.each(["has'quote", "has\"dquote", "has$dollar", "has|pipe", "has&amp", "has%percent", "has(back", "has`tick", "has{brace", "newline" + String.fromCharCode(10) + "x", "y".repeat(300)])(
    "typeText rejects dangerous input: %j",
    async (bad) => {
      const shell = inputShell();
      const r = await opsFor(shell).typeText(bad);
      expect(r.ok).toBe(false);
      expect(r.data.failure).toBe("invalid_arg");
      expect(shell.calls.some((c) => c.args?.includes("text"))).toBe(false);
    },
  );
});

describe("openApp", () => {
  function appShell(fg: string): FakeShell {
    const s = inputShell();
    s.onArgv(["monkey"], shellOk("  Events injected: 1\n"));
    s.onArgv(["dumpsys window"], shellOk(`mCurrentFocus=Window{aa u0 ${fg}}\n`));
    return s;
  }
  it("launches an allowlisted package and verifies foreground", async () => {
    const r = await opsFor(appShell("com.termux/")).openApp("com.termux");
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(true);
  });
  it("reports unverified when foreground shows a different app", async () => {
    const r = await opsFor(appShell("com.android.settings/")).openApp("com.termux");
    expect(r.ok).toBe(false);
    expect(r.verified).toBe(false);
  });
  it("rejects non-allowlisted packages without spawning", async () => {
    const shell = appShell("x/");
    const r = await opsFor(shell).openApp("com.evil.app");
    expect(r.ok).toBe(false);
    expect(r.data.failure).toBe("not_allowlisted");
    expect(shell.calls.some((c) => c.args?.includes("monkey"))).toBe(false);
  });
});

describe("screenshot", () => {
  function shotShell(): FakeShell {
    const s = withDevices(new FakeShell());
    s.onArgv(["mkdir"], shellOk());
    s.onArgv(["screencap"], shellOk());
    s.onArgv(["pull"], shellOk("1 file pulled"));
    s.onArgv(["rm"], shellOk());
    return s;
  }
  it("captures, pulls, cleans up remote, verifies PNG", async () => {
    const shell = shotShell();
    const r = await opsFor(shell).screenshot();
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(true);
    const remote = `${REMOTE_LITT_DIR}/`;
    expect(shell.calls.some((c) => c.args?.includes("screencap"))).toBe(true);
    expect(shell.calls.some((c) => c.args?.join(" ").includes(remote))).toBe(true);
    // remote cleanup ran
    expect(shell.calls.some((c) => c.args?.includes("rm") && c.args?.includes("-f"))).toBe(true);
    const path = r.data.path as string;
    expect(path).toContain("captures");
  });
  it("reports unverified when pulled file is not a PNG", async () => {
    const shell = shotShell();
    const r = await opsFor(shell, { readFileBytes: () => new Uint8Array([1, 2, 3]) }).screenshot();
    expect(r.ok).toBe(false);
    expect(r.verified).toBe(false);
    expect(r.message).toContain("not a valid PNG");
  });
});

describe("file transfer", () => {
  function pushShell(): FakeShell {
    const s = withDevices(new FakeShell());
    s.onArgv(["mkdir"], shellOk());
    s.onArgv(["push"], shellOk("1 file pushed"));
    s.onArgv(["stat", "-c", "%s"], shellOk(`${PNG.length}\n`));
    s.onArgv(["pull"], shellOk("1 file pulled"));
    return s;
  }
  it("push confines remote name to basename and verifies size", async () => {
    const shell = pushShell();
    const r = await opsFor(shell).pushFile("C:/tmp/note.txt");
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(true);
    const push = shell.calls.find((c) => c.args?.includes("push"));
    expect(push?.args?.at(-1)).toBe(`${REMOTE_LITT_DIR}/note.txt`);
  });
  it("push rejects traversal in remote name", async () => {
    const r = await opsFor(pushShell()).pushFile("C:/tmp/a.txt", "../../system/x");
    expect(r.ok).toBe(false);
    expect(r.data.failure).toBe("invalid_arg");
  });
  it("push rejects missing local file", async () => {
    const r = await opsFor(pushShell(), { statFile: () => null }).pushFile("C:/nope.txt");
    expect(r.ok).toBe(false);
    expect(r.data.failure).toBe("invalid_arg");
  });
  it("pull rejects non-basename remote names", async () => {
    const r = await opsFor(pushShell()).pullFile("/data/data/secret.db");
    expect(r.ok).toBe(false);
    expect(r.data.failure).toBe("invalid_arg");
  });
  it("pull confines dest dir to allowed roots", async () => {
    const r = await opsFor(pushShell()).pullFile("shot.png", "C:/Windows/System32");
    expect(r.ok).toBe(false);
    expect(r.data.failure).toBe("invalid_arg");
  });
  it("pull rejects a missing remote file before starting transfer", async () => {
    const shell = withDevices(new FakeShell());
    shell.onArgv(["stat", "-c", "%s"], shellFail("stat: No such file or directory"));
    shell.onArgv(["pull"], shellOk("1 file pulled"));
    const r = await opsFor(shell).pullFile("screenshot.png");
    expect(r.ok).toBe(false);
    expect(r.data.failure).toBe("remote_not_found");
    expect(r.message).toContain("already exist");
    expect(r.message).toContain("android.screenshot");
    expect(shell.calls.some((c) => c.args?.includes("pull"))).toBe(false);
  });
  it("pull still transfers an explicitly named existing remote file", async () => {
    const shell = pushShell();
    const r = await opsFor(shell, { statFile: () => ({ isFile: true, size: PNG.length }) }).pullFile("existing.png");
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(true);
    expect(shell.calls.some((c) => c.args?.includes("pull"))).toBe(true);
  });
});

describe("disconnect + timeout honesty", () => {
  it("device_not_found mid-op produces typed failure", async () => {
    const shell = withDevices(new FakeShell());
    shell.onArgv(["wm size"], shellOk("Physical size: 1080x2460"));
    shell.onArgv(["input"], shellFail("adb: error: device 'LBMRAIFEVSNRMFRO' not found"));
    const r = await opsFor(shell).tap(1, 1);
    expect(r.ok).toBe(false);
    expect(r.data.failure).toBe("device_not_found");
  });
  it("timeout propagates as timeout status, not success", async () => {
    const shell = withDevices(new FakeShell());
    shell.onArgv(["wm size"], shellOk("Physical size: 1080x2460"));
    shell.onArgv(["input"], { ok: false, status: "timeout", exitCode: null, stderr: "" });
    const r = await opsFor(shell).tap(1, 1);
    expect(r.status).toBe("timeout");
    expect(r.data.failure).toBe("timeout");
  });
  it("device gone at discovery returns honest failure", async () => {
    const shell = new FakeShell().onArgv(["devices"], shellOk("List of devices attached\n\n"));
    const r = await opsFor(shell).tap(1, 1);
    expect(r.ok).toBe(false);
    expect(r.data.failure).toBe("no_device");
  });
  it("a transiently empty device list is re-queried once before failing", async () => {
    // adb server restarts (two adb binaries on PATH can flap port 5037)
    // can answer `devices -l` empty while the phone is still attached —
    // the exact captured `× Android Key` / "No usable devices" failure.
    // One bounded re-query must recover it.
    let calls = 0;
    const shell = new FakeShell().onArgv(["devices", "-l"], () => {
      calls++;
      return calls === 1
        ? shellOk("List of devices attached\n\n")
        : shellOk(DEVICES_L);
    });
    shell.onArgv(["input"], shellOk(""));
    const r = await opsFor(shell).key("home");
    expect(calls).toBe(2);
    expect(r.ok).toBe(true);
  });
  it("a persistently empty list still fails honestly after one re-query", async () => {
    let calls = 0;
    const shell = new FakeShell().onArgv(["devices", "-l"], () => {
      calls++;
      return shellOk("List of devices attached\n\n");
    });
    const r = await opsFor(shell).key("home");
    expect(calls).toBe(2);
    expect(r.ok).toBe(false);
    expect(r.data.failure).toBe("no_device");
    expect(r.message).toContain("No devices are attached");
  });
});
