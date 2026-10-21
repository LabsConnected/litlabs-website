/**
 * Device registry tests — allowlist loading and serial resolution.
 * All simulated: no filesystem beyond injected fixtures, no adb.
 */

import { describe, it, expect } from "vitest";
import {
  loadAndroidPolicy,
  resolveSerial,
  isSerialAllowed,
  isPackageAllowed,
  isSerialPlaceholder,
  type AndroidPolicy,
} from "../lib/android/device-registry.js";
import type { AdbDeviceInfo } from "../lib/android/adb-client.js";

const noEnv = () => undefined;
const dev = (serial: string, state = "device"): AdbDeviceInfo => ({ serial, state, usable: state === "device" });

const basePolicy: AndroidPolicy = {
  allowedSerials: ["LBMRAIFEVSNRMFRO"],
  allowedPackages: ["com.termux"],
  defaultSerial: undefined,
  dex: { enabled: true, host: "127.0.0.1", port: 8022, user: "u0_a235", keyPath: "k", knownHostsPath: "kh" },
};

describe("loadAndroidPolicy", () => {
  it("loads serials/packages from android.json", () => {
    const p = loadAndroidPolicy({
      env: noEnv, littHome: "H",
      exists: (f) => f.endsWith("android.json"),
      readFile: () => JSON.stringify({ serials: ["SER1", "bad serial!"], packages: ["com.termux", "notapkg"], defaultSerial: "SER1" }),
    });
    expect(p.allowedSerials).toEqual(["SER1"]);
    expect(p.allowedPackages).toEqual(["com.termux"]);
    expect(p.defaultSerial).toBe("SER1");
  });

  it("merges LITT_ANDROID_SERIALS + LITT_ANDROID_PACKAGES env vars", () => {
    const p = loadAndroidPolicy({
      env: (k) => k === "LITT_ANDROID_SERIALS" ? "ENV1, ENV2" : k === "LITT_ANDROID_PACKAGES" ? "com.a.b" : undefined,
      littHome: "H", exists: () => false,
    });
    expect(p.allowedSerials).toEqual(["ENV1", "ENV2"]);
    expect(p.allowedPackages).toEqual(["com.a.b"]);
  });

  it("corrupt config fails closed — empty allowlist, no throw", () => {
    const p = loadAndroidPolicy({ env: noEnv, littHome: "H", exists: () => true, readFile: () => "{not json" });
    expect(p.allowedSerials).toEqual([]);
    expect(p.allowedPackages).toEqual([]);
  });

  it("missing config yields empty allowlist", () => {
    const p = loadAndroidPolicy({ env: noEnv, littHome: "H", exists: () => false });
    expect(p.allowedSerials).toEqual([]);
  });
});

describe("resolveSerial", () => {
  const connected = [dev("LBMRAIFEVSNRMFRO")];

  it("accepts an explicit allowlisted serial that is connected", () => {
    expect(resolveSerial(basePolicy, "LBMRAIFEVSNRMFRO", connected)).toEqual({ ok: true, serial: "LBMRAIFEVSNRMFRO" });
  });
  it("rejects a non-allowlisted serial BEFORE checking connection", () => {
    const r = resolveSerial(basePolicy, "EVILSERIAL", connected);
    expect(r.ok).toBe(false);
    expect(r.failure?.kind).toBe("not_allowlisted");
  });
  it("rejects malformed serials", () => {
    expect(resolveSerial(basePolicy, "bad;rm -rf", connected).failure?.kind).toBe("invalid_serial");
  });
  it("reports allowlisted-but-unattached", () => {
    expect(resolveSerial(basePolicy, "LBMRAIFEVSNRMFRO", []).failure?.kind).toBe("device_not_found");
  });
  it("reports attached-but-not-ready", () => {
    expect(resolveSerial(basePolicy, "LBMRAIFEVSNRMFRO", [dev("LBMRAIFEVSNRMFRO", "offline")]).failure?.kind).toBe("device_not_ready");
  });
  it("auto-selects the single allowlisted+usable device", () => {
    const r = resolveSerial(basePolicy, undefined, [dev("OTHER1"), dev("LBMRAIFEVSNRMFRO")]);
    expect(r).toEqual({ ok: true, serial: "LBMRAIFEVSNRMFRO" });
  });
  it("prefers defaultSerial when connected", () => {
    const pol = { ...basePolicy, allowedSerials: ["A1", "B2"], defaultSerial: "B2" };
    expect(resolveSerial(pol, undefined, [dev("A1"), dev("B2")])).toEqual({ ok: true, serial: "B2" });
  });
  it("fails ambiguous when multiple allowlisted devices connected", () => {
    const pol = { ...basePolicy, allowedSerials: ["A1", "B2"] };
    const r = resolveSerial(pol, undefined, [dev("A1"), dev("B2")]);
    expect(r.failure?.kind).toBe("ambiguous");
  });
  it("fails honestly when connected devices are not allowlisted", () => {
    const r = resolveSerial(basePolicy, undefined, [dev("OTHER")]);
    expect(r.failure?.kind).toBe("no_device");
    expect(r.failure?.message).toContain("allowlisted");
  });
  it("attached-but-unusable devices report real state, not a bare 'no devices'", () => {
    // Captured failure: `× Android Key` traced to "No usable devices are
    // attached" while a phone WAS attached — the message must say why.
    const r = resolveSerial(basePolicy, undefined, [dev("LBMRAIFEVSNRMFRO", "unauthorized")]);
    expect(r.failure?.kind).toBe("device_not_ready");
    expect(r.failure?.message).toContain("unauthorized");
    expect(r.failure?.message).toContain("USB debugging");
  });
  it("an empty device list is a distinct honest failure", () => {
    const r = resolveSerial(basePolicy, undefined, []);
    expect(r.failure?.kind).toBe("no_device");
    expect(r.failure?.message).toContain("No devices are attached");
  });
});

describe("placeholder serials — never device identities", () => {
  const connected = [dev("LBMRAIFEVSNRMFRO")];

  it.each([
    "ANDROID_SERIAL",       // the exact captured live failure
    "DEVICE_SERIAL", "ADB_SERIAL", "PHONE_SERIAL", "EMULATOR_SERIAL",
    "SERIAL", "SERIAL_NUMBER", "DEVICE_ID", "YOUR_SERIAL",
    "android_serial",       // case-insensitive
    "<serial>", "<device serial>",
    "$ANDROID_SERIAL", "${ANDROID_SERIAL}", "%ANDROID_SERIAL%",
  ])("rejects placeholder %j as invalid_serial with a clear message", (ph) => {
    const r = resolveSerial(basePolicy, ph, connected);
    expect(r.ok).toBe(false);
    expect(r.failure?.kind).toBe("invalid_serial");
    expect(r.failure?.message).toContain("placeholder");
    // The fix path is named: omit serial to auto-select.
    expect(r.failure?.message).toContain("auto-select");
    // NEVER silently substituted with the real device.
    expect(r.serial).toBeUndefined();
  });

  it("does NOT misclassify real serials as placeholders", () => {
    for (const real of ["LBMRAIFEVSNRMFRO", "emulator-5554", "127.0.0.1:5555", "SER1", "ZY322JKQPR"]) {
      expect(isSerialPlaceholder(real)).toBe(false);
    }
  });

  it("a placeholder bypasses neither allowlist nor auto-selection", () => {
    // Placeholder ≠ "not supplied" — it fails closed, it does NOT
    // resolve to the single authorized device.
    const r = resolveSerial(basePolicy, "ANDROID_SERIAL", connected);
    expect(r.ok).toBe(false);
    // Allowlist is unchanged: ANDROID_SERIAL is not added, real serial stays.
    expect(isSerialAllowed(basePolicy, "ANDROID_SERIAL")).toBe(false);
    expect(isSerialAllowed(basePolicy, "LBMRAIFEVSNRMFRO")).toBe(true);
  });
});

describe("allowlist predicates", () => {
  it("isSerialAllowed / isPackageAllowed", () => {
    expect(isSerialAllowed(basePolicy, "LBMRAIFEVSNRMFRO")).toBe(true);
    expect(isSerialAllowed(basePolicy, "NOPE")).toBe(false);
    expect(isPackageAllowed(basePolicy, "com.termux")).toBe(true);
    expect(isPackageAllowed(basePolicy, "com.evil")).toBe(false);
  });
});
