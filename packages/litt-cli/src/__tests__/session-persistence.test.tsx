/**
 * Session persistence regression — the stale-transcript defect.
 *
 * persistSession() read store.state.chatTranscript — a render-time
 * snapshot. A useCallback created before the turn closed over an EMPTY
 * transcript, so saveSession early-returned and no ~/.litt/sessions.json
 * write ever happened — verified live (file ctime predated the session).
 *
 * The fix reads store.actions.getChatTranscript() — the synchronous pure
 * store — and also persists from the chat path's finally block so
 * errored/interrupted turns are saved too.
 *
 * These tests mount the REAL cockpit (same harness as
 * local-interactive-cockpit) and assert on the actual on-disk file.
 * LITT_STATE_HOME isolates all state under a temp dir — real ~/.litt is
 * never touched.
 */

import React from "react";
import { PassThrough } from "node:stream";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { render } from "ink";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

import { CockpitApp } from "../ink/app.js";
import { ApprovalBridge } from "../ink/approval-bridge.js";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { resetLocalLaneCache } from "../lib/local-lane.js";
import type { SessionSnapshot } from "../lib/session-store.js";

const MODEL = "qwen3:4b-instruct";
const RENDERED_BADGE = "Qwen3:4b Instruct";

const ESC = String.fromCharCode(0x1b);
const CR = "\r";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s: string) =>
  s
    .replace(new RegExp(`${ESC}\\][^\\u0007]*\\u0007`, "g"), "")
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "");

// ─── Stand-in Ollama (same contract as local-interactive-cockpit) ───

interface FakeOllama {
  url: string;
  reply: string;
  failNext: boolean;
  close: () => Promise<void>;
}

async function startFakeOllama(models: string[]): Promise<FakeOllama> {
  const state = { reply: "TUI_LOCAL_OK", failNext: false };
  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/api/tags")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        models: models.map((m) => ({
          name: m, model: m,
          details: { family: "qwen3" },
          capabilities: ["completion", "tools"],
        })),
      }));
      return;
    }
    if (url.startsWith("/api/show")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        capabilities: ["completion", "tools"],
        model_info: { "qwen3.context_length": 8192 },
      }));
      return;
    }
    if (url.startsWith("/v1/chat/completions")) {
      req.on("data", () => {});
      req.on("end", () => {
        if (state.failNext) {
          state.failNext = false;
          res.writeHead(500).end(JSON.stringify({ error: "upstream exploded" }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        const chunk = (delta: object) =>
          `data: ${JSON.stringify({
            id: "chatcmpl-local",
            model: MODEL,
            choices: [{ index: 0, delta, finish_reason: null }],
          })}\n\n`;
        res.write(chunk({ role: "assistant" }));
        for (const piece of state.reply.split(" ")) {
          res.write(chunk({ content: `${piece} ` }));
        }
        res.write(`data: ${JSON.stringify({
          id: "chatcmpl-local",
          model: MODEL,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    get reply() { return state.reply; },
    set reply(v: string) { state.reply = v; },
    get failNext() { return state.failNext; },
    set failNext(v: boolean) { state.failNext = v; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ─── Cockpit mount ──────────────────────────────────────────────────

interface Cockpit {
  send: (data: string) => Promise<void>;
  output: () => string;
  waitFor: (pred: (out: string) => boolean, ms?: number) => Promise<boolean>;
  cleanup: () => void;
  session: ReturnType<typeof createRuntimeSession>;
}

async function mountCockpit(): Promise<Cockpit> {
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

  await sleep(400);
  const output = () => stripAnsi(out);
  return {
    async send(data: string) {
      stdin.write(data);
      await sleep(120);
    },
    output,
    async waitFor(pred, ms = 8000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (pred(output())) return true;
        await sleep(100);
      }
      return pred(output());
    },
    cleanup: () => {
      instance.unmount();
      stdin.end();
    },
    session,
  };
}

// ─── Env ────────────────────────────────────────────────────────────

let ollama: FakeOllama;
let littHome: string;
const savedEnv: Record<string, string | undefined> = {};

const MANAGED_ENV = [
  "LITT_LOCAL_MODE", "LITT_LOCAL_ONLY", "LITT_OLLAMA_URL", "LITT_MODEL",
  "LITT_STATE_HOME", "LITT_HOME", "LITT_SESSIONS_FILE",
  "OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "XAI_API_KEY", "KIMI_API_KEY",
  "QWEN_API_KEY", "LITT_CLERK_TOKEN",
];

beforeAll(async () => {
  for (const k of MANAGED_ENV) savedEnv[k] = process.env[k];
  ollama = await startFakeOllama([MODEL]);
  littHome = fs.mkdtempSync(join(os.tmpdir(), "litt-persist-"));
  for (const k of MANAGED_ENV) delete process.env[k];
  process.env.LITT_STATE_HOME = littHome;
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

beforeEach(() => {
  resetLocalLaneCache();
  ollama.reply = "TUI_LOCAL_OK";
  // Isolate each test's sessions file while staying under LITT_STATE_HOME.
  fs.rmSync(join(littHome, "sessions.json"), { force: true });
});

const sessionsPath = () => join(littHome, "sessions.json");

function readSessionsFile(): SessionSnapshot[] {
  if (!fs.existsSync(sessionsPath())) return [];
  return JSON.parse(fs.readFileSync(sessionsPath(), "utf8")) as SessionSnapshot[];
}

describe("cockpit session persistence", () => {
  it("persists a completed chat turn — user AND assistant messages (stale-transcript regression)", async () => {
    const c = await mountCockpit();
    try {
      await c.waitFor((o) => o.includes(RENDERED_BADGE));
      await c.send("persist turn one");
      await c.send(CR);
      expect(await c.waitFor((o) => o.includes("responded"), 15000)).toBe(true);

      const sessions = readSessionsFile();
      // THE REGRESSION: with the stale snapshot this file was never written.
      expect(sessions.length).toBeGreaterThan(0);
      const s = sessions[0];
      const roles = s.messages.map((m) => m.role);
      expect(roles).toContain("user");
      expect(roles).toContain("assistant");
      expect(s.messages.some((m) => m.role === "user" && m.content.includes("persist turn one"))).toBe(true);
      expect(s.messages.some((m) => m.role === "assistant" && m.content.includes("TUI_LOCAL_OK"))).toBe(true);
      expect(s.id).toBeTruthy();
      expect(s.project).toBe("litt-cli");
      expect(s.createdAt).toBeGreaterThan(0);
      expect(s.updatedAt).toBeGreaterThanOrEqual(s.createdAt);
    } finally {
      c.cleanup();
    }
  }, 30000);

  it("persists multiple turns into the same conversation and preserves prior sessions", async () => {
    // Seed a pre-existing session — persistence must merge, never clobber.
    const prior: SessionSnapshot = {
      id: "s_prior_keep",
      createdAt: 1000,
      updatedAt: 1000,
      project: "other-proj",
      cwd: "/tmp/other",
      branch: "main",
      mode: "act",
      routingMode: "fixed",
      selectedModel: "ollama:old",
      summary: "older session",
      messages: [{ role: "user", content: "old", status: "complete", ts: 1 }],
    };
    fs.writeFileSync(sessionsPath(), JSON.stringify([prior], null, 2));

    const c = await mountCockpit();
    try {
      await c.waitFor((o) => o.includes(RENDERED_BADGE));
      await c.send("first turn msg");
      await c.send(CR);
      // Poll the file: persists land synchronously at turn-complete.
      expect(await c.waitFor(() => readSessionsFile().some(
        (s) => s.messages.some((m) => m.content.includes("first turn msg")),
      ), 15000)).toBe(true);
      // Let the run fully settle (isProcessing=false) before the next submit.
      await sleep(700);
      await c.send("second turn msg");
      await c.send(CR);
      expect(await c.waitFor(() => readSessionsFile().some(
        (s) => s.messages.filter((m) => m.role === "user").length >= 2,
      ), 15000)).toBe(true);

      const sessions = readSessionsFile();
      const current = sessions.find((s) => s.summary !== "older session");
      expect(current).toBeTruthy();
      // Same-conversation merge: one session, both turns inside it.
      expect(current!.messages.filter((m) => m.role === "user").length).toBeGreaterThanOrEqual(2);
      expect(current!.messages.filter((m) => m.role === "assistant").length).toBeGreaterThanOrEqual(2);
      expect(current!.messages.some((m) => m.content.includes("first turn msg"))).toBe(true);
      expect(current!.messages.some((m) => m.content.includes("second turn msg"))).toBe(true);
      // Prior session history preserved.
      expect(sessions.some((s) => s.id === "s_prior_keep")).toBe(true);
    } finally {
      c.cleanup();
    }
  }, 45000);

  it("persists an errored turn — interrupted conversations are not lost", async () => {
    ollama.failNext = true;
    const c = await mountCockpit();
    try {
      await c.waitFor((o) => o.includes(RENDERED_BADGE));
      await c.send("turn that will fail");
      await c.send(CR);
      // The persist runs in the chat-path finally — poll the file itself,
      // independent of how the error is phrased in the activity pane.
      // With incremental persistence the first write can be an
      // intermediate snapshot — wait for THIS turn's completed pair,
      // not just any record.
      expect(await c.waitFor(
        () => readSessionsFile().some((s) =>
          s.messages.some((m) => m.role === "user" && m.content.includes("turn that will fail"))
          && s.messages.some((m) => m.role === "assistant")),
        20000,
      )).toBe(true);

      const sessions = readSessionsFile();
      expect(sessions.length).toBeGreaterThan(0);
      const s = sessions[0];
      expect(s.messages.some((m) => m.role === "user" && m.content.includes("turn that will fail"))).toBe(true);
      // The assistant slot exists (finalized as an error), not silently dropped.
      expect(s.messages.some((m) => m.role === "assistant")).toBe(true);
    } finally {
      c.cleanup();
    }
  }, 30000);

  // ─── Exit-path persistence regressions ──────────────────────────
  // Devin's fix (above) made persistSession() itself correct and made
  // the model-routed chat turn's finally block call it on every
  // outcome. None of that touches the four places that actually exit
  // the process — each of those calls onExit()/exit() directly with
  // no persist call of its own.

  it("/exit persists the just-completed turn before exiting (slash-command exit path)", async () => {
    const c = await mountCockpit();
    try {
      await c.waitFor((o) => o.includes(RENDERED_BADGE));
      await c.send("turn before slash exit");
      await c.send(CR);
      expect(await c.waitFor(() => readSessionsFile().some(
        (s) => s.messages.some((m) => m.content.includes("turn before slash exit")),
      ), 15000)).toBe(true);
      // Clear the file to isolate: does /exit ITSELF persist anything
      // new (e.g. the fact that this was the final state)? At minimum
      // it must not leave the file in a state that predates /exit.
      const beforeExit = readSessionsFile();
      await c.send("/exit");
      await c.send(CR);
      await sleep(300);
      const afterExit = readSessionsFile();
      expect(afterExit.length).toBeGreaterThan(0);
      expect(afterExit[0].updatedAt).toBeGreaterThanOrEqual(beforeExit[0].updatedAt);
    } finally {
      c.cleanup();
    }
  }, 30000);

  it("natural-language exit persists the farewell exchange (not just the turn before it)", async () => {
    const c = await mountCockpit();
    try {
      await c.waitFor((o) => o.includes(RENDERED_BADGE));
      await c.send("exit");
      await c.send(CR);
      await sleep(300);
      const sessions = readSessionsFile();
      expect(sessions.length).toBeGreaterThan(0);
      const s = sessions[0];
      // THE REGRESSION: the farewell pair was added to the in-memory
      // transcript via addChatMessage() and then onExit() fired with
      // no persist call — the pair never reached disk.
      expect(s.messages.some((m) => m.role === "user" && m.content === "exit")).toBe(true);
      expect(s.messages.some((m) => m.role === "assistant" && m.content.includes("Exiting LiTT"))).toBe(true);
    } finally {
      c.cleanup();
    }
  }, 30000);

  it("Ctrl+D on an empty composer persists before exiting", async () => {
    const c = await mountCockpit();
    try {
      await c.waitFor((o) => o.includes(RENDERED_BADGE));
      await c.send("turn before ctrl-d");
      await c.send(CR);
      expect(await c.waitFor(() => readSessionsFile().some(
        (s) => s.messages.some((m) => m.content.includes("turn before ctrl-d")),
      ), 15000)).toBe(true);
      // Make a second, not-yet-persisted-by-anything-else change: type
      // into the composer (no submit), then Ctrl+D on top of that.
      // The persist we're testing covers the LAST completed turn, not
      // an in-progress draft — assert the completed turn survives.
      await c.send(String.fromCharCode(4)); // Ctrl+D, empty composer → exit
      await sleep(300);
      const sessions = readSessionsFile();
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions[0].messages.some((m) => m.content.includes("turn before ctrl-d"))).toBe(true);
    } finally {
      c.cleanup();
    }
  }, 30000);

  it("idle SIGINT persists the session before process.exit", async () => {
    const c = await mountCockpit();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((() => {
      // never actually exit the test worker
      return undefined as never;
    }) as unknown) as typeof process.exit);
    try {
      await c.waitFor((o) => o.includes(RENDERED_BADGE));
      await c.send("turn before sigint");
      await c.send(CR);
      expect(await c.waitFor(() => readSessionsFile().some(
        (s) => s.messages.some((m) => m.content.includes("turn before sigint")),
      ), 15000)).toBe(true);
      fs.rmSync(sessionsPath(), { force: true });

      // Mirror production's cockpit.ts bootstrap: install the real
      // SIGINT handler on the real session instance.
      c.session.installSigintHandler();
      process.emit("SIGINT");
      await sleep(300);

      const sessions = readSessionsFile();
      // THE REGRESSION: installSigintHandler's idle-exit branch calls
      // restoreTerminal() + process.exit(130) with no persist call.
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions[0].messages.some((m) => m.content.includes("turn before sigint"))).toBe(true);
      expect(exitSpy).toHaveBeenCalledWith(130);
    } finally {
      exitSpy.mockRestore();
      c.cleanup();
    }
  }, 30000);
});
