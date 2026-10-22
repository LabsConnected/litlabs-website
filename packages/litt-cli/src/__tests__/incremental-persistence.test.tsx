/**
 * Incremental persistence — a nonempty transcript must reach disk on its
 * own, without the user ever triggering an exit action. This is what
 * makes a forced kill / SIGTERM / closed terminal survivable: Windows
 * delivers no signal a handler can catch (confirmed empirically — see
 * crash-recovery-subprocess.test.ts), so persistence can only work if it
 * already happened before termination, not in response to it.
 *
 * LITT_PERSIST_THROTTLE_MS is set to a small value so the test doesn't
 * need to wait a full second.
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
const ENTER = "\r";
const MODEL = "litt-fast:2k";

const sseChunk = (text: string) =>
  `data: ${JSON.stringify({ model: MODEL, choices: [{ delta: { content: text } }] })}\n\n`;

/**
 * Serves /api/tags (local-lane probe) and a deliberately SLOW
 * /v1/chat/completions: it drip-feeds a few SSE deltas with real delays
 * between them and never sends [DONE] within the test's observation
 * window. This is what lets the test observe the transcript WHILE a
 * turn is still mid-stream — the only way to prove a checkpoint landed
 * before the turn's own completion-time persistSession() call, which
 * already exists and would otherwise mask whether the new throttle
 * effect did anything.
 */
async function fakeOllama() {
  const srv = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: MODEL }] }));
      return;
    }
    if (req.url === "/v1/chat/completions") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(sseChunk("checkpoint "));
      setTimeout(() => res.write(sseChunk("mid-stream ")), 150);
      setTimeout(() => res.write(sseChunk("content")), 300);
      // Deliberately never finishes (no [DONE], connection stays open)
      // within this test's lifetime — the test's own cleanup() closes
      // the app, which ends the request. This is what isolates "still
      // streaming, turn not yet finalized" from the turn-end path.
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return {
    url,
    // The chat-completions handler never calls res.end() — force-close
    // any still-open connection so server.close()'s callback actually fires.
    close: () => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }),
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

  const stdout = new PassThrough() as PassThrough & { columns?: number; rows?: number; isTTY?: boolean };
  stdout.columns = 120;
  stdout.rows = 40;
  stdout.isTTY = true;

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
      project: "litt-cli", branch: "main", model: MODEL, cwd: process.cwd(), mode: "act",
      gitModified: 0, gitUntracked: 0, authEmail: null, signedIn: false,
    }),
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    },
  );

  return {
    async send(data: string) { stdin.write(data); await sleep(50); },
    async type(text: string) { for (const ch of text) { stdin.write(ch); await sleep(10); } },
    cleanup: () => { instance.unmount(); stdin.end(); },
  };
}

let ollama: Awaited<ReturnType<typeof fakeOllama>>;
let littHome: string;
const savedEnv: Record<string, string | undefined> = {};
const MANAGED_ENV = [
  "LITT_LOCAL_MODE", "LITT_LOCAL_ONLY", "LITT_OLLAMA_URL", "LITT_MODEL",
  "LITT_HOME", "LITT_SESSIONS_FILE", "LITT_TARGET_OVERRIDE", "LITT_PERSIST_THROTTLE_MS",
  "OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY",
];

beforeAll(async () => {
  for (const k of MANAGED_ENV) savedEnv[k] = process.env[k];
  ollama = await fakeOllama();
  littHome = fs.mkdtempSync(join(os.tmpdir(), "litt-incremental-persist-"));
  for (const k of MANAGED_ENV) delete process.env[k];
  process.env.LITT_HOME = littHome;
  process.env.LITT_SESSIONS_FILE = join(littHome, "sessions.json");
  process.env.LITT_LOCAL_MODE = "1";
  process.env.LITT_OLLAMA_URL = ollama.url;
  process.env.LITT_MODEL = MODEL;
  process.env.LITT_PERSIST_THROTTLE_MS = "50";
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

describe("Incremental persistence — no exit action required", () => {
  it("a message is saved to disk shortly after being accepted, with the app still running (no exit sent)", async () => {
    const app = mount();
    try {
      await sleep(600); // kitty-probe settle
      // "explain the plan" matches none of the Local Fast Lane's exact
      // phrases (bare exit/quit, branch, project, clean/mode queries) —
      // it goes through the REAL model-dispatch path, whose own
      // completion-time persistSession() call has NOT run yet (the fake
      // server never finishes the stream). Only the new throttle effect
      // can have saved anything at the point this test checks.
      await app.type("explain the plan");
      await app.send(ENTER);
      // Checked while the fake server is still mid-stream (first delta
      // arrives immediately, the 150ms/300ms chunks are still pending,
      // [DONE] never arrives) — the turn's own finalize/persistSession
      // has NOT run. Only the throttle (50ms) could have saved anything.
      await sleep(250);

      const sessions = listSessions();
      expect(sessions.length, "the message must be persisted without exiting or the turn completing").toBeGreaterThan(0);
      const persisted = sessions[0].messages.some((m) => m.content.includes("explain the plan"));
      expect(persisted, "the live conversation content must be on disk while the turn is still streaming").toBe(true);
    } finally { app.cleanup(); }
  }, 15_000);
});
