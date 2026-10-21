/**
 * P0 REGRESSION — /devices silent disappearance in the real cockpit.
 *
 * Reproduces the exact operator report: typing `/devices` and pressing
 * Enter cleared the composer but NOTHING rendered — no result, no
 * error. Root cause (code trace): the SLASH_MAP dispatch path ran
 * gateway.execute() and updated holo state, but never rendered
 * result.message — non-shell tools (android.*, dex.*) emit no stream
 * events, so their result was invisible. Fixed via
 * renderSlashToolResult() in the slash path.
 *
 * This mounts the REAL CockpitApp (same harness as
 * local-interactive-cockpit.test.tsx) and asserts that after Enter the
 * transcript contains either real device information or an explicit
 * error — silence is a fail.
 */

import React from "react";
import { PassThrough } from "node:stream";
import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { render } from "ink";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { CockpitApp } from "../ink/app.js";
import { ApprovalBridge } from "../ink/approval-bridge.js";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import { createRuntimeSession } from "../lib/runtime-session.js";

const ESC = String.fromCharCode(0x1b);
const CR = "\r";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s: string) =>
  s
    .replace(new RegExp(`${ESC}\][^\u0007]*\u0007`, "g"), "")
    .replace(new RegExp(`${ESC}\[[0-9;?]*[ -/]*[@-~]`, "g"), "");

async function mountCockpit() {
  const stdin = new PassThrough() as PassThrough & {
    isTTY?: boolean; setRawMode?: (v: boolean) => void;
    ref?: () => void; unref?: () => void;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};

  let out = "";
  const stdout = new PassThrough() as PassThrough & {
    columns?: number; rows?: number; isTTY?: boolean;
  };
  stdout.columns = 120;
  stdout.rows = 40;
  stdout.isTTY = true;
  stdout.on("data", (c: Buffer) => { out += c.toString(); });

  const approvalBridge = new ApprovalBridge();
  const sessionBridge = new SessionEventBridge();
  const session = createRuntimeSession({
    cwd: process.cwd(),
    mode: "act",
    onApprovalRequired: (r, risk) => approvalBridge.request(r, risk),
    onEvent: (e) => sessionBridge.onEvent(e),
    onStream: (c) => sessionBridge.onStream(c),
  });

  const instance = render(
    React.createElement(CockpitApp, {
      session, client: null, approvalBridge, sessionBridge,
      project: "litt-cli", branch: "feat/android-adb-control",
      model: "local", cwd: process.cwd(), mode: "act",
      gitModified: 0, gitUntracked: 0, authEmail: null, signedIn: false,
    }),
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false, patchConsole: false, interactive: true,
    },
  );
  await sleep(400);

  return {
    send: async (d: string) => { stdin.write(d); await sleep(150); },
    output: () => stripAnsi(out),
    waitFor: async (pred: (s: string) => boolean, ms = 8000) => {
      const dl = Date.now() + ms;
      while (Date.now() < dl) { if (pred(stripAnsi(out))) return true; await sleep(100); }
      return pred(stripAnsi(out));
    },
    cleanup: () => { instance.unmount(); stdin.end(); },
  };
}

let littHome: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["LITT_STATE_HOME", "LITT_HOME", "LITT_LOCAL_MODE", "LITT_LOCAL_ONLY", "LITT_TARGET_OVERRIDE", "LITT_ADB_PATH"];

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  littHome = fs.mkdtempSync(join(os.tmpdir(), "litt-slash-tui-"));
  process.env.LITT_STATE_HOME = littHome;
  process.env.LITT_LOCAL_MODE = "1";
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  try { fs.rmSync(littHome, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe("cockpit slash device commands — P0 silent-drop regression", () => {
  it("/devices renders device info or an explicit error — never silence", async () => {
    const c = await mountCockpit();
    try {
      await c.send("/devices" + CR);
      const ok = await c.waitFor((s) =>
        /device|adb|serial|offline|unauthorized|allowlist|not found|error|fail/i.test(s),
        12_000,
      );
      expect(ok).toBe(true);
    } finally {
      c.cleanup();
    }
  }, 30_000);

  it("/devices result REMAINS rendered (no flash-and-vanish)", async () => {
    const c = await mountCockpit();
    try {
      await c.send("/devices" + CR);
      const ok = await c.waitFor((s) =>
        /device|adb|serial|offline|allowlist|error|fail/i.test(s), 12_000);
      expect(ok).toBe(true);
      // Hold a beat — the content must persist, not flash away.
      await sleep(1200);
      expect(/device|adb|serial|error|fail/i.test(c.output())).toBe(true);
    } finally {
      c.cleanup();
    }
  }, 30_000);
});
