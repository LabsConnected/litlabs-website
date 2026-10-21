/**
 * adb capability-classification regression tests.
 *
 * Proves raw `project.run adb …` cannot bypass the validated Android
 * operation allowlist: unrestricted shell / install / root / reboot
 * are destructive, read-only discovery stays read-only, and input
 * injection maps to the same elevated tier the android.* tools carry.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyCommand } from "../execution.js";

function cap(args: string[]) {
  return classifyCommand("adb", args).capability;
}

describe("adb — read-only discovery", () => {
  for (const sub of [["devices"], ["devices", "-l"], ["get-state"], ["get-serialno"], ["version"], ["logcat"]]) {
    it(`adb ${sub.join(" ")} → read_only`, () => {
      assert.equal(cap(sub), "read_only");
    });
  }
  it("adb -s SERIAL devices → read_only (flag+value skipped)", () => {
    assert.equal(cap(["-s", "LBMRAIFEVSNRMFRO", "devices", "-l"]), "read_only");
  });
});

describe("adb shell — on-device command granularity", () => {
  it("bare adb shell → destructive (interactive/unrestricted)", () => {
    assert.equal(cap(["shell"]), "destructive");
  });
  for (const cmd of ["rm", "su", "dd", "pm uninstall com.x", "settings put", "cmd anything", "unknown_binary"]) {
    it(`adb shell ${cmd} → destructive`, () => {
      assert.equal(cap(["shell", ...cmd.split(" ")]), "destructive");
    });
  }
  for (const cmd of ["getprop ro.product.model", "dumpsys battery", "ls /sdcard", "ps -A"]) {
    it(`adb shell ${cmd} → read_only`, () => {
      assert.equal(cap(["shell", ...cmd.split(" ")]), "read_only");
    });
  }
  it("adb shell pm list packages → read_only", () => {
    assert.equal(cap(["shell", "pm", "list", "packages"]), "read_only");
  });
  for (const cmd of ["input tap 100 200", "input keyevent KEYCODE_HOME", "input text 'hi'", "monkey -p com.x 1", "am start -n a/b", "screencap -p /sdcard/x.png", "wm size"]) {
    it(`adb shell ${cmd} → arbitrary_code (same tier as android.* tools)`, () => {
      assert.equal(cap(["shell", ...cmd.split(" ")]), "arbitrary_code");
    });
  }
  it("adb -s SERIAL shell getprop → read_only through flags", () => {
    assert.equal(cap(["-s", "SER123", "shell", "getprop", "x"]), "read_only");
  });
  it("adb -s SERIAL shell rm → destructive through flags", () => {
    assert.equal(cap(["-s", "SER123", "shell", "rm", "-rf", "/sdcard"]), "destructive");
  });
});

describe("adb — destructive/privilege ops", () => {
  for (const sub of ["install", "uninstall", "root", "unroot", "reboot", "reboot-bootloader", "reboot-recovery", "remount", "disable-verity", "usb", "tcpip", "emu", "sideload", "sync"]) {
    it(`adb ${sub} → destructive`, () => {
      assert.equal(cap([sub]), "destructive");
    });
  }
});

describe("adb — transfer + control subcommands", () => {
  it("push/pull → external_action", () => {
    assert.equal(cap(["push", "a", "b"]), "external_action");
    assert.equal(cap(["pull", "a", "b"]), "external_action");
  });
  it("forward/connect/wait-for-device → workspace_edit", () => {
    assert.equal(cap(["forward", "tcp:8022", "tcp:8022"]), "workspace_edit");
    assert.equal(cap(["connect", "x"]), "workspace_edit");
    assert.equal(cap(["wait-for-device"]), "workspace_edit");
  });
  it("unrecognized subcommand keeps the arbitrary_code floor", () => {
    assert.equal(cap(["frobnicate"]), "arbitrary_code");
    assert.equal(cap([]), "arbitrary_code");
  });
});
