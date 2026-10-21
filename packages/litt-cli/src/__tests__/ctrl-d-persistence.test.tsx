/**
 * Ctrl+D exit-persistence — the reconciled Ctrl+D handler (empty-composer
 * exit) must persistSession() BEFORE calling exit(), mirroring the idle
 * Ctrl+C path. Without it, a Ctrl+D exit drops any conversation that was
 * never persisted by an earlier in-session action.
 *
 * Scratch closeout test — lives only in the pc-closeout-ctrld worktree.
 * Same harness as exit-persistence.test.tsx.
 */

import React from "react";
import { PassThrough } from "node:stream";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { render } from "ink";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

import { CockpitApp } from "../ink/app.js";
import { ApprovalBridge } from "../ink/approval-bridge.js";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { resetLocalLaneCache } from "../lib/local-lane.js";
import { listSessions } from "../lib/session-store.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s: string) =>
  s.replace(/\x1B(?:\][^\x07]*\x07|\[[0-9;?]*[ -/]*[@-~])/g, "");
const CTRL_D = "\x04";
const ENTER = "\r";
const MODEL = "litt-fast:2k";

async function fakeOllama() {
  const sockets = new Set<import("node:net").Socket>();
  const srv = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: MODEL }] }));
      return;
    }
    // Every other endpoint HANGS — the model turn can never resolve, so
    // neither the turn's completion persist nor a throttle tick can save
    // it before Ctrl+D exits.
  });
  srv.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return {
    url,
    close: () => new Promise<void>((r) => {
      for (const s of sockets) s.destroy();
      srv.close(() => r());
    }),
  };
}

function mount() {
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
      session,
      client: null,
      approvalBridge,
      sessionBridge,
      project: "litt-cli",
      branch: "main",
      model: MODEL,
      cwd: process.cwd(),
      mode: "act",
      gitModified: 0,
      gitUntracked: 0,
      authEmail: null,
      signedIn: false,
    }),
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    },
  );

  let exited = false;
  const exitedP = instance.waitUntilExit().then(() => { exited = true; });

  return {
    async send(data: string) { stdin.write(data); await sleep(150); },
    async type(text: string) { for (const ch of text) { stdin.write(ch); await sleep(10); } },
    output: () => stripAnsi(out),
    exited: () => exited,
    exitedP,
    cleanup: () => { instance.unmount(); stdin.end(); },
  };
}

let ollama: Awaited<ReturnType<typeof fakeOllama>>;
let littHome: string;
let sessionsFile: string;
const savedEnv: Record<string, string | undefined> = {};
const MANAGED_ENV = [
  "LITT_LOCAL_MODE", "LITT_LOCAL_ONLY", "LITT_OLLAMA_URL", "LITT_MODEL",
  "LITT_HOME", "LITT_SESSIONS_FILE", "LITT_TARGET_OVERRIDE",
  "LITT_PERSIST_THROTTLE_MS",
  "OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY",
];

beforeAll(async () => {
  for (const k of MANAGED_ENV) savedEnv[k] = process.env[k];
  ollama = await fakeOllama();
  littHome = fs.mkdtempSync(join(os.tmpdir(), "litt-ctrld-persist-"));
  sessionsFile = join(littHome, "sessions.json");
  for (const k of MANAGED_ENV) delete process.env[k];
  process.env.LITT_HOME = littHome;
  process.env.LITT_SESSIONS_FILE = sessionsFile;
  process.env.LITT_LOCAL_MODE = "1";
  process.env.LITT_OLLAMA_URL = ollama.url;
  process.env.LITT_MODEL = MODEL;
  // Widen the incremental-persist throttle so turn 2's deferred save is
  // scheduled ~5s out — far past the Ctrl+D we send ~300ms later. This
  // makes the test deterministic: without the handler's own
  // persistSession(), turn 2 can never reach disk before exit.
  process.env.LITT_PERSIST_THROTTLE_MS = "5000";
});

afterAll(async () => {
  await ollama.close();
  fs.rmSync(littHome, { recursive: true, force: true });
  for (const k of MANAGED_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => resetLocalLaneCache());

describe("Ctrl+D exit persists a nonempty session before exiting", () => {
  it("empty-composer Ctrl+D persists transcript state newer than the last incremental save", async () => {
    // Discriminating setup: completed turns persist themselves — the
    // turn's own completion-time persistSession() and the incremental
    // effect both cover finished turns. The only uncovered window is a
    // message accepted but NOT yet completed: user msg sits pending in
    // the throttle window, no completion persist can fire because the
    // turn never finishes. Turn 2 is therefore a model-path prompt — the
    // fake hangs on every non-tags endpoint so the turn can never
    // resolve — and Ctrl+D lands while it is still in flight.
    const app = mount();
    try {
      await sleep(600); // kitty-probe settle
      await app.type("current branch");
      await app.send(ENTER);
      await sleep(800); // turn 1 saves; throttle window still open

      await app.type("explain how request routing works in this repo");
      await app.send(ENTER);
      await sleep(150); // user msg accepted, model turn still pending
      await app.send(CTRL_D);
      const ok = await Promise.race([app.exitedP.then(() => true), sleep(3000).then(() => false)]);
      expect(ok, "Ctrl+D on empty composer must exit").toBe(true);

      const sessions = listSessions();
      expect(sessions.length, "a session must be persisted before Ctrl+D exit").toBeGreaterThan(0);
      const messages = sessions[0].messages;
      expect(
        messages.some((m) => m.content.includes("current branch")),
        "turn 1 must be in the saved session",
      ).toBe(true);
      expect(
        messages.some((m) => m.content.includes("explain how request routing works in this repo")),
        "the in-flight turn-2 message must be captured by the exit-path persist",
      ).toBe(true);
    } finally { app.cleanup(); }
  }, 20_000);
});
