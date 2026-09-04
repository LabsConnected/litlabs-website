/**
 * Interactive LOCAL mode — end-to-end through the REAL Ink cockpit.
 *
 * The unit tests next door prove the pure resolution rules. This suite
 * proves the thing the operator actually saw was wrong: the running TUI.
 *
 * It mounts the real <CockpitApp/> with:
 *   - LITT_LOCAL_MODE=1        → executionTarget LOCAL, localOnly
 *   - signedIn: false          → SIGNED OUT
 *   - a real HTTP server standing in for Ollama, serving /api/tags,
 *     /api/show and an OpenAI-compatible /v1/chat/completions stream
 *   - a model-prefs file that already pins the REMOTE MiniMax model,
 *     exactly like the operator's ~/.litt/model-prefs.json
 *
 * and asserts the four interactive requirements:
 *
 *   E1  inference is allowed (no capability gate)
 *   E2  the persisted remote selection is superseded by Ollama
 *   E3  the model badge shows Ollama / qwen3:4b-instruct
 *   E4  the cloud-auth capability-gate message is never emitted
 *
 * No provider credentials are set for the duration of the suite, so a
 * cloud lane could not serve even if the code tried to use one.
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

const MODEL = "qwen3:4b-instruct";
const OTHER_MODEL = "qwen3:4b-instruct-16k";
/** The persisted REMOTE selection that was staying authoritative. */
const PERSISTED_REMOTE = "minimax-m3-free";
/**
 * How the status bar renders MODEL. shortModelName() title-cases the tag
 * and drops the hyphen, so the badge reads "Qwen3:4b Instruct · Ollama".
 * Asserting on the RENDERED form is the point — this is the badge the
 * operator reported as showing MiniMax.
 */
const RENDERED_BADGE = "Qwen3:4b Instruct";
const RENDERED_PROVIDER = "Ollama";
/** The exact sentence the capability gate emits for the cloud-auth path. */
const CLOUD_GATE_PHRASE = "requires LiTT cloud/model access";

const ESC = String.fromCharCode(0x1b);
const CR = "\r";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s: string) =>
  s
    .replace(new RegExp(`${ESC}\\][^\\u0007]*\\u0007`, "g"), "")
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "");

// ─── A stand-in Ollama daemon ───────────────────────────────────────

interface FakeOllama {
  url: string;
  /** Every /v1/chat/completions body this server received. */
  chatRequests: Array<{ model: string; hasTools: boolean }>;
  /** What the next chat completion should stream back. */
  reply: string;
  close: () => Promise<void>;
}

async function startFakeOllama(models: string[]): Promise<FakeOllama> {
  const state: { reply: string } = { reply: "TUI_LOCAL_OK" };
  const chatRequests: FakeOllama["chatRequests"] = [];

  const server = http.createServer((req, res) => {
    const url = req.url ?? "";

    if (url.startsWith("/api/tags")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        models: models.map((m) => ({
          name: m,
          model: m,
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
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        let parsed: { model?: string; tools?: unknown[] } = {};
        try { parsed = JSON.parse(body); } catch { /* record it anyway */ }
        chatRequests.push({
          model: String(parsed.model ?? ""),
          hasTools: Array.isArray(parsed.tools) && parsed.tools.length > 0,
        });
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        const chunk = (delta: object) =>
          `data: ${JSON.stringify({
            id: "chatcmpl-local",
            model: parsed.model ?? MODEL,
            choices: [{ index: 0, delta, finish_reason: null }],
          })}\n\n`;
        res.write(chunk({ role: "assistant" }));
        for (const piece of state.reply.split(" ")) {
          res.write(chunk({ content: `${piece} ` }));
        }
        res.write(`data: ${JSON.stringify({
          id: "chatcmpl-local",
          model: parsed.model ?? MODEL,
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
    chatRequests,
    get reply() { return state.reply; },
    set reply(v: string) { state.reply = v; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ─── Mounting the real cockpit ──────────────────────────────────────

interface Cockpit {
  send: (data: string) => Promise<void>;
  /** Everything the cockpit has painted since mount, ANSI stripped. */
  output: () => string;
  /** Wait until `pred` holds over the accumulated output, or time out. */
  waitFor: (pred: (out: string) => boolean, ms?: number) => Promise<boolean>;
  cleanup: () => void;
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

  // Ink's kitty-keyboard probe buffers stdin for ~200ms after mount.
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
  };
}

// ─── Environment ────────────────────────────────────────────────────

let ollama: FakeOllama;
let littHome: string;
const savedEnv: Record<string, string | undefined> = {};

const MANAGED_ENV = [
  "LITT_LOCAL_MODE", "LITT_LOCAL_ONLY", "LITT_OLLAMA_URL", "LITT_MODEL",
  "LITT_HOME", "LITT_TARGET_OVERRIDE",
  "OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "XAI_API_KEY", "KIMI_API_KEY",
  "QWEN_API_KEY", "LITT_CLERK_TOKEN",
];

beforeAll(async () => {
  for (const k of MANAGED_ENV) savedEnv[k] = process.env[k];

  ollama = await startFakeOllama([MODEL, OTHER_MODEL]);

  littHome = fs.mkdtempSync(join(os.tmpdir(), "litt-local-tui-"));
  // The operator's real prefs: a REMOTE model pinned from a past session.
  fs.writeFileSync(
    join(littHome, "model-prefs.json"),
    JSON.stringify({ selectedModel: PERSISTED_REMOTE, routingMode: "fixed", lastUsedModel: PERSISTED_REMOTE }),
  );

  // No cloud credential of any kind can serve this session.
  for (const k of MANAGED_ENV) delete process.env[k];
  process.env.LITT_HOME = littHome;
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
  ollama.chatRequests.length = 0;
});

// ─── The requirements ───────────────────────────────────────────────

describe("interactive LOCAL cockpit — signed out, Ollama reachable", () => {
  it("REQUIREMENT E3: the model badge shows the local model, not MiniMax", async () => {
    const c = await mountCockpit();
    try {
      const shown = await c.waitFor((o) => o.includes(RENDERED_BADGE));
      expect(shown).toBe(true);

      const out = c.output();
      // "Qwen3:4b Instruct · Ollama" — the effective model AND provider.
      expect(out).toContain(RENDERED_BADGE);
      expect(out).toContain(RENDERED_PROVIDER);
      // The persisted remote selection must not be authoritative here.
      expect(out).not.toContain("MiniMax");
    } finally {
      c.cleanup();
    }
  }, 30000);

  it("REQUIREMENT E3: the header reports LOCAL and SIGNED OUT", async () => {
    const c = await mountCockpit();
    try {
      await c.waitFor((o) => o.includes("LOCAL"));
      const out = c.output();
      expect(out).toContain("LOCAL");
      expect(out.toUpperCase()).toContain("SIGNED OUT");
    } finally {
      c.cleanup();
    }
  }, 30000);

  it("REQUIREMENT E1 + E4: a chat turn runs locally and emits NO cloud-auth gate", async () => {
    const c = await mountCockpit();
    try {
      await c.waitFor((o) => o.includes(RENDERED_BADGE));

      await c.send("you good");
      await c.send(CR);

      const answered = await c.waitFor((o) => o.includes("TUI_LOCAL_OK"), 15000);

      const out = c.output();
      // E4 — the exact message the operator saw must never appear.
      expect(out).not.toContain(CLOUD_GATE_PHRASE);
      expect(out).not.toContain("Sign in (`litt login`)");
      // E1 — inference was allowed and actually reached the local daemon.
      expect(ollama.chatRequests.length).toBeGreaterThan(0);
      expect(answered).toBe(true);
    } finally {
      c.cleanup();
    }
  }, 30000);

  it("REQUIREMENT E2: the request goes to the Ollama daemon as qwen3:4b-instruct", async () => {
    const c = await mountCockpit();
    try {
      await c.waitFor((o) => o.includes(RENDERED_BADGE));
      await c.send("you good");
      await c.send(CR);
      await c.waitFor((o) => o.includes("TUI_LOCAL_OK"), 15000);

      expect(ollama.chatRequests.length).toBeGreaterThan(0);
      for (const req of ollama.chatRequests) {
        expect(req.model).toBe(MODEL);
      }
    } finally {
      c.cleanup();
    }
  }, 30000);

  it("local tool calling is offered to the local model", async () => {
    const c = await mountCockpit();
    try {
      await c.waitFor((o) => o.includes(RENDERED_BADGE));
      await c.send("you good");
      await c.send(CR);
      await c.waitFor((o) => o.includes("TUI_LOCAL_OK"), 15000);

      expect(ollama.chatRequests.length).toBeGreaterThan(0);
      // Tool schemas are declared on the transport — the local lane is a
      // full agent lane, not a bare completion endpoint.
      expect(ollama.chatRequests.some((r) => r.hasTools)).toBe(true);
    } finally {
      c.cleanup();
    }
  }, 30000);

  it("the composer accepts abcdef / Backspace x6 / xyz inside the real cockpit", async () => {
    // The composer suite proves this against the component in isolation.
    // This proves it inside the whole app, where the OverlayManager also
    // has a useInput registered on the same stdin.
    const c = await mountCockpit();
    try {
      await c.waitFor((o) => o.includes(RENDERED_BADGE));

      for (const ch of "abcdef") await c.send(ch);
      expect(await c.waitFor((o) => o.includes("abcdef"), 2000)).toBe(true);

      for (let i = 0; i < 6; i++) await c.send(String.fromCharCode(0x7f));
      for (const ch of "xyz") await c.send(ch);

      expect(await c.waitFor((o) => o.includes("xyz"), 3000)).toBe(true);
      // The frame after the deletions must not still be showing the old
      // draft: the last painted composer line is what matters.
      const tail = c.output().slice(-4000);
      expect(tail).toContain("xyz");
      expect(tail).not.toContain("abcdef");
    } finally {
      c.cleanup();
    }
  }, 30000);
});
