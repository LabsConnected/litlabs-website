/**
 * Ctrl+D — exit on an empty composer, open the diff viewer otherwise.
 *
 * Regression coverage for a bug where the branch checked the raw Ink
 * keystroke (`input`, which `isCtrl` already constrains to the literal
 * string `"d"`) instead of the composer's own draft text
 * (`store.state.composerValue`). That made the empty-composer exit path
 * unreachable — every Ctrl+D fell through to `controller.openDiffViewer()`
 * regardless of what was typed.
 */

import React from "react";
import { PassThrough } from "node:stream";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { render } from "ink";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CockpitApp } from "../ink/app.js";
import { ApprovalBridge } from "../ink/approval-bridge.js";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { resetLocalLaneCache } from "../lib/local-lane.js";

const INSTALLED = "qwen3:4b-instruct";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ESC = String.fromCharCode(0x1b);
const CTRL_D = String.fromCharCode(0x04);
const CTRL_C = String.fromCharCode(0x03);
const stripAnsi = (s: string) =>
  s
    .replace(new RegExp(`${ESC}\\][^\\u0007]*\\u0007`, "g"), "")
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "");

let server: http.Server;
let url: string;
let littHome: string;
const MANAGED = ["LITT_LOCAL_MODE", "LITT_OLLAMA_URL", "LITT_MODEL", "LITT_HOME", "LITT_TARGET_OVERRIDE", "LITT_REDUCED_MOTION"];
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of MANAGED) saved[k] = process.env[k];
  server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    if ((req.url ?? "").startsWith("/api/show")) {
      res.end(JSON.stringify({ capabilities: ["completion", "tools"], model_info: {} }));
    } else {
      res.end(JSON.stringify({
        models: [{ name: INSTALLED, model: INSTALLED, details: { family: "qwen3" }, capabilities: ["completion", "tools"] }],
      }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  littHome = fs.mkdtempSync(join(os.tmpdir(), "litt-ctrld-"));
  process.env.LITT_HOME = littHome;
  process.env.LITT_LOCAL_MODE = "1";
  process.env.LITT_MODEL = INSTALLED;
  process.env.LITT_OLLAMA_URL = url;
  delete process.env.LITT_TARGET_OVERRIDE;
  process.env.LITT_REDUCED_MOTION = "1";
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(littHome, { recursive: true, force: true });
  for (const k of MANAGED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

beforeEach(() => resetLocalLaneCache());

async function mount() {
  const stdin = new PassThrough() as PassThrough & {
    isTTY?: boolean; setRawMode?: (v: boolean) => void; ref?: () => void; unref?: () => void;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};

  let out = "";
  const stdout = new PassThrough() as PassThrough & { columns?: number; rows?: number; isTTY?: boolean };
  stdout.columns = 120;
  stdout.rows = 40;
  stdout.isTTY = true;
  stdout.on("data", (c: Buffer) => { out += c.toString(); });

  const approvalBridge = new ApprovalBridge();
  const sessionBridge = new SessionEventBridge();
  const session = createRuntimeSession({
    cwd: process.cwd(),
    mode: "act",
    onApprovalRequired: (request, risk) => approvalBridge.request(request, risk),
    onEvent: (event) => sessionBridge.onEvent(event),
    onStream: (chunk) => sessionBridge.onStream(chunk),
  });
  const instance = render(
    React.createElement(CockpitApp, {
      session, client: null, approvalBridge, sessionBridge,
      project: "litt-cli", branch: "main", model: INSTALLED, cwd: process.cwd(),
      mode: "act", gitModified: 0, gitUntracked: 0, authEmail: null, signedIn: false,
    }),
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false, patchConsole: false, interactive: true,
    },
  );
  await sleep(400);

  /** True once `waitUntilExit()` has resolved — i.e. something called exit()/unmount(). */
  let exited = false;
  instance.waitUntilExit().then(() => { exited = true; });

  return {
    output: () => stripAnsi(out),
    send: async (s: string) => { stdin.write(s); await sleep(200); },
    hasExited: () => exited,
    cleanup: () => { if (!exited) instance.unmount(); stdin.end(); },
  };
}

describe("Ctrl+D — exit vs. diff viewer", () => {
  it("empty composer: Ctrl+D exits LiTT", async () => {
    const c = await mount();
    try {
      expect(c.hasExited()).toBe(false);
      await c.send(CTRL_D);
      expect(c.hasExited()).toBe(true);
    } finally {
      c.cleanup();
    }
  }, 30000);

  it("whitespace-only composer: Ctrl+D exits LiTT", async () => {
    const c = await mount();
    try {
      await c.send("   "); // three spaces, no non-whitespace content
      await c.send(CTRL_D);
      expect(c.hasExited()).toBe(true);
    } finally {
      c.cleanup();
    }
  }, 30000);

  it("nonempty composer: Ctrl+D opens the diff viewer and does not exit", async () => {
    const c = await mount();
    try {
      await c.send("hello");
      expect(c.output()).toContain("hello");
      await c.send(CTRL_D);
      expect(c.hasExited()).toBe(false);
      expect(c.output()).toContain("DIFF");
    } finally {
      c.cleanup();
    }
  }, 30000);

  it("no unintended regression: Ctrl+C on an idle, non-approval session still exits", async () => {
    // Sibling shortcut sharing the same dispatch chain as the edited Ctrl+D
    // branch — proves the `else if` reordering didn't shadow or break it.
    const c = await mount();
    try {
      expect(c.hasExited()).toBe(false);
      await c.send(CTRL_C);
      expect(c.hasExited()).toBe(true);
    } finally {
      c.cleanup();
    }
  }, 30000);
});
