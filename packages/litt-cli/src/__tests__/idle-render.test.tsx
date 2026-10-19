/**
 * Idle render storm — the cockpit must be quiet when nothing is happening.
 *
 * Root cause (measured): reconcileLocalModel closes over `store`, which
 * useCockpitStore() rebuilds every render. The startup effect keyed on
 * the callback's identity therefore re-fired on every render; when the
 * requested local model was not installed it logged an error activity
 * each time, which re-rendered, which re-fired the effect. Result:
 * ~25 identical full-frame stdout writes per second while idle, which
 * also cancels Android text selection in Termux.
 *
 * These tests mount the real <CockpitApp/> against a stand-in Ollama and
 * count what reaches stdout in an idle window.
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
const stripAnsi = (s: string) =>
  s
    .replace(new RegExp(`${ESC}\\][^\\u0007]*\\u0007`, "g"), "")
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "");

let server: http.Server;
let url: string;
let littHome: string;
const MANAGED = ["LITT_LOCAL_MODE", "LITT_OLLAMA_URL", "LITT_MODEL", "LITT_HOME", "LITT_TARGET_OVERRIDE"];
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
  littHome = fs.mkdtempSync(join(os.tmpdir(), "litt-idle-"));
  process.env.LITT_HOME = littHome;
  process.env.LITT_LOCAL_MODE = "1";
  process.env.LITT_OLLAMA_URL = url;
  delete process.env.LITT_TARGET_OVERRIDE;
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
  let writes = 0;
  const stdout = new PassThrough() as PassThrough & { columns?: number; rows?: number; isTTY?: boolean };
  stdout.columns = 120;
  stdout.rows = 40;
  stdout.isTTY = true;
  stdout.on("data", (c: Buffer) => { writes++; out += c.toString(); });

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
  return {
    writes: () => writes,
    output: () => stripAnsi(out),
    type: async (s: string) => { stdin.write(s); await sleep(250); },
    cleanup: () => { instance.unmount(); stdin.end(); },
  };
}

/** Writes that reach stdout during `ms` of idleness after startup settles. */
async function idleWrites(ms: number, modelEnv: string): Promise<number> {
  process.env.LITT_MODEL = modelEnv;
  const c = await mount();
  try {
    await sleep(1500); // startup probes + reconcile settle
    const before = c.writes();
    await sleep(ms);
    return c.writes() - before;
  } finally {
    c.cleanup();
  }
}

describe("idle cockpit does not repaint", () => {
  it("requested model NOT installed: no render loop (was ~25 writes/s)", async () => {
    const n = await idleWrites(3000, "ollama:litt-coder:latest");
    expect(n).toBeLessThanOrEqual(3);
  }, 30000);

  it("requested model installed: stays quiet", async () => {
    const n = await idleWrites(3000, INSTALLED);
    expect(n).toBeLessThanOrEqual(3);
  }, 30000);

  it("keyboard input still repaints while the model is missing", async () => {
    process.env.LITT_MODEL = "ollama:litt-coder:latest";
    const c = await mount();
    try {
      await sleep(1500);
      const before = c.writes();
      await c.type("hello");
      expect(c.writes()).toBeGreaterThan(before);
      expect(c.output()).toContain("hello");
    } finally {
      c.cleanup();
    }
  }, 30000);
});
