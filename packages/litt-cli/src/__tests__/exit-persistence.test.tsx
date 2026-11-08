/**
 * Exit-persistence regression — Ctrl+C and /exit must persist a nonempty
 * transcript before the process exits. Both currently call `exit()` /
 * `onExit()` directly with no `persistSession()` call anywhere on the path,
 * so a session with real conversation content is lost on exit unless some
 * other in-session action (e.g. /plan, /ship) happened to persist it first.
 *
 * These tests drive the real <CockpitApp/> over simulated stdin — same
 * technique already used for Ctrl+D regression coverage — and use the
 * deterministic Local Fast Lane ("current branch", bare "exit") so no
 * model call or real Ollama response is required to populate the
 * transcript.
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
const CTRL_C = "\x03";
const CTRL_D = "\x04";
const ENTER = "\r";
const MODEL = "litt-fast:2k";

/** Minimal Ollama stand-in: the local-lane probe only needs /api/tags. */
async function fakeOllama() {
  const srv = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: MODEL }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((r) => srv.close(() => r())) };
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
  "LITT_HOME", "LITT_STATE_HOME", "LITT_SESSIONS_FILE", "LITT_TARGET_OVERRIDE",
  "OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY",
];

beforeAll(async () => {
  for (const k of MANAGED_ENV) savedEnv[k] = process.env[k];
  ollama = await fakeOllama();
  littHome = fs.mkdtempSync(join(os.tmpdir(), "litt-exit-persist-"));
  sessionsFile = join(littHome, "sessions.json");
  for (const k of MANAGED_ENV) delete process.env[k];
  process.env.LITT_HOME = littHome;
  // Dual isolation: the Android state-home resolver honors only
  // LITT_STATE_HOME (LITT_HOME means the repo root on Termux); set both
  // so state is contained regardless of resolver generation.
  process.env.LITT_STATE_HOME = littHome;
  process.env.LITT_SESSIONS_FILE = sessionsFile;
  process.env.LITT_LOCAL_MODE = "1";
  process.env.LITT_OLLAMA_URL = ollama.url;
  process.env.LITT_MODEL = MODEL;
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

describe("Exit paths persist a nonempty session before exiting", () => {
  it("Ctrl+C on an idle session with prior conversation persists before exit", async () => {
    const app = mount();
    try {
      await sleep(600); // kitty-probe settle
      await app.type("current branch");
      await app.send(ENTER);
      await sleep(300); // Local Fast Lane resolves synchronously; settle time for store update
      await app.send(CTRL_C);
      const ok = await Promise.race([app.exitedP.then(() => true), sleep(3000).then(() => false)]);
      expect(ok, "Ctrl+C on idle must exit").toBe(true);

      const sessions = listSessions();
      expect(sessions.length, "the conversation must be persisted before exit").toBeGreaterThan(0);
      const persisted = sessions[0].messages.some((m) => m.content.includes("current branch"));
      expect(persisted, "the pre-exit conversation content must be in the saved session").toBe(true);
    } finally { app.cleanup(); }
  }, 15_000);

  it("/exit with prior conversation persists before exit", async () => {
    const app = mount();
    try {
      await sleep(600);
      await app.type("current branch");
      await app.send(ENTER);
      await sleep(300);
      await app.type("/exit");
      await app.send(ENTER);
      const ok = await Promise.race([app.exitedP.then(() => true), sleep(3000).then(() => false)]);
      expect(ok, "/exit must exit").toBe(true);

      const sessions = listSessions();
      expect(sessions.length, "the conversation must be persisted before exit").toBeGreaterThan(0);
      const persisted = sessions[0].messages.some((m) => m.content.includes("current branch"));
      expect(persisted, "the pre-exit conversation content must be in the saved session").toBe(true);
    } finally { app.cleanup(); }
  }, 15_000);

  it("natural-language bare 'exit' chat text persists its own farewell exchange before exiting", async () => {
    const app = mount();
    try {
      await sleep(600);
      // No leading slash — this is the Local Fast Lane's kind:"exit" match
      // (controller.ts), a separate code path from the literal /exit
      // command above. It writes its own farewell exchange into the
      // transcript synchronously, in the SAME turn that calls onExit().
      await app.type("exit");
      await app.send(ENTER);
      const ok = await Promise.race([app.exitedP.then(() => true), sleep(3000).then(() => false)]);
      expect(ok, "bare 'exit' chat text must exit").toBe(true);

      const sessions = listSessions();
      expect(sessions.length, "the farewell exchange must be persisted before exit").toBeGreaterThan(0);
      const messages = sessions[0].messages;
      expect(messages.some((m) => m.content === "exit"), "the user's 'exit' message must be saved").toBe(true);
      expect(messages.some((m) => m.content === "Exiting LiTT."), "the farewell reply must be saved").toBe(true);
    } finally { app.cleanup(); }
  }, 15_000);

  it("Ctrl+D on an empty composer with prior conversation persists before exit", async () => {
    const app = mount();
    try {
      await sleep(600); // kitty-probe settle
      await app.type("current branch");
      await app.send(ENTER);
      await sleep(300); // Local Fast Lane resolves synchronously; settle time for store update
      // Composer is empty again after the submit above — Ctrl+D takes the
      // exit branch (not the diff viewer). The session must be saved
      // BEFORE exit() unmounts the app.
      await app.send(CTRL_D);
      const ok = await Promise.race([app.exitedP.then(() => true), sleep(3000).then(() => false)]);
      expect(ok, "Ctrl+D on an empty composer must exit").toBe(true);

      const sessions = listSessions();
      expect(sessions.length, "the conversation must be persisted before exit").toBeGreaterThan(0);
      const persisted = sessions[0].messages.some((m) => m.content.includes("current branch"));
      expect(persisted, "the pre-exit conversation content must be in the saved session").toBe(true);
    } finally { app.cleanup(); }
  }, 30_000);
});
