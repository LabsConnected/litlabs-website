/**
 * Ctrl+D regression — the handler in app.tsx must read the composer draft
 * (store.state.composerValue), NOT the raw keystroke `input`.
 *
 * INPUT-READINESS BARRIER (deterministic — no arbitrary sleeps):
 *   Ink's App attaches `stdin.addListener('readable', handleReadable)`
 *   synchronously inside useInput→setRawMode(true) during the effect pass
 *   (App.js). The 'input' subscription on internal_eventEmitter lands in the
 *   same pass. Therefore `stdin.listenerCount('readable') > 0` is a GENUINE
 *   readiness condition: once attached, every written byte reaches
 *   handleReadable → keypress parser → all useInput subscribers.
 *   (kittyKeyboard is NOT enabled in this harness — no probe/buffering exists.)
 *
 * Before asserting Ctrl+D behavior we additionally prove bytes are PROCESSED
 * end-to-end by typing a marker and watching it echo in the composer output.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s: string) =>
  s.replace(/\x1B(?:\][^\x07]*\x07|\[[0-9;?]*[ -/]*[@-~])/g, "");
const CTRL_D = "\x04"; // EOT — what a real terminal sends for Ctrl+D
const MARKER = "qz9";
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

function mount(opts: { suppressReadable?: boolean } = {}) {
  const stdin = new PassThrough() as PassThrough & {
    isTTY?: boolean; setRawMode?: (v: boolean) => void; ref?: () => void; unref?: () => void;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};

  // Negative-control mechanism (test harness only): swallow 'readable'
  // listener registrations so Ink's handleReadable never attaches — this
  // simulates a broken input pipeline WITHOUT touching production code.
  if (opts.suppressReadable) {
    const origAdd = stdin.addListener.bind(stdin);
    (stdin as any).addListener = (ev: string, fn: unknown) =>
      ev === "readable" ? stdin : origAdd(ev as never, fn as never);
  }

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
    async send(data: string) { stdin.write(data); await sleep(50); },
    output: () => stripAnsi(out),
    /** Event-driven readiness: Ink's handleReadable is attached to stdin. */
    async waitInput(ms = 8000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (stdin.listenerCount("readable") > 0) return true;
        await sleep(25);
      }
      return false;
    },
    async waitFor(pred: (o: string) => boolean, ms = 5000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (pred(stripAnsi(out))) return true;
        await sleep(50);
      }
      return pred(stripAnsi(out));
    },
    exited: () => exited,
    exitedP,
    /** Clear captured output — lets a later waitFor assert post-close UI. */
    reset: () => { out = ""; },
    cleanup: () => { instance.unmount(); stdin.end(); },
  };
}

let ollama: Awaited<ReturnType<typeof fakeOllama>>;
let littHome: string;
const savedEnv: Record<string, string | undefined> = {};
const MANAGED_ENV = [
  "LITT_LOCAL_MODE", "LITT_LOCAL_ONLY", "LITT_OLLAMA_URL", "LITT_MODEL",
  "LITT_HOME", "LITT_STATE_HOME", "LITT_TARGET_OVERRIDE",
  "OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY",
];

beforeAll(async () => {
  for (const k of MANAGED_ENV) savedEnv[k] = process.env[k];
  ollama = await fakeOllama();
  littHome = fs.mkdtempSync(join(os.tmpdir(), "litt-ctrld-"));
  for (const k of MANAGED_ENV) delete process.env[k];
  // Dual isolation: the incoming LITT_STATE_HOME resolver honors only
  // LITT_STATE_HOME; the current resolver honors only LITT_HOME. Setting
  // both to the same temp dir keeps this suite isolated on either side
  // of the migration — it can never read or write real ~/.litt state.
  process.env.LITT_HOME = littHome;
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

beforeEach(() => resetLocalLaneCache());

describe("Ctrl+D — composer-aware exit", () => {
  it("exits when the composer draft is empty", async () => {
    const app = mount();
    try {
      expect(await app.waitInput(), "ink readable handler attached").toBe(true);
      // Prove input is processed end-to-end: marker echoes, then erase it
      // so the composer is empty again for the real assertion.
      await app.send(MARKER);
      expect(await app.waitFor((o) => o.includes(MARKER)), "typed marker echoed").toBe(true);
      await app.send("\x7f\x7f\x7f");
      await app.send(CTRL_D);
      const ok = await Promise.race([app.exitedP.then(() => true), sleep(5000).then(() => false)]);
      expect(ok, "Ctrl+D on empty composer must exit the cockpit").toBe(true);
    } finally { app.cleanup(); }
  }, 20_000);

  it("does NOT exit when the composer has text (opens diff viewer instead)", async () => {
    const app = mount();
    try {
      expect(await app.waitInput()).toBe(true);
      await app.send("abc");
      expect(await app.waitFor((o) => o.includes("abc")), "typed text echoed").toBe(true);
      await app.send(CTRL_D);
      await sleep(1500);
      expect(app.exited(), "Ctrl+D with a non-empty draft must not exit").toBe(false);
      // Draft preservation: Esc closes the diff viewer; the composer must
      // still render the draft (the store holds composerValue across
      // overlay open/close — it is never cleared by Ctrl+D).
      app.reset();
      await app.send("\x1b");
      expect(
        await app.waitFor((o) => o.includes("abc")),
        "composer draft preserved after Ctrl+D → diff viewer → Esc",
      ).toBe(true);
    } finally { app.cleanup(); }
  }, 15_000);

  it("negative control — suppressed 'readable' attach: input unprocessed, no exit", async () => {
    // Simulates the exact failure class of a broken input pipeline: with
    // addListener('readable') swallowed, waitInput correctly reports NOT
    // ready and Ctrl+D never reaches the handler → no exit. Asserting
    // `ok === true` here is what the positive test would fail on.
    const app = mount({ suppressReadable: true });
    try {
      expect(await app.waitInput(1500), "barrier must report NOT ready").toBe(false);
      await app.send(CTRL_D);
      await sleep(800);
      expect(app.exited(), "no input handler ⇒ no exit").toBe(false);
    } finally { app.cleanup(); }
  }, 15_000);

  it("Ctrl+D exit — 20 consecutive runs", async () => {
    const failures: number[] = [];
    for (let i = 0; i < 20; i++) {
      const app = mount();
      try {
        if (!(await app.waitInput(4000))) { failures.push(i); continue; }
        await app.send(CTRL_D);
        const ok = await Promise.race([app.exitedP.then(() => true), sleep(4000).then(() => false)]);
        if (!ok) failures.push(i);
      } finally { app.cleanup(); }
    }
    expect(failures, "all 20 Ctrl+D runs must exit").toEqual([]);
  }, 180_000);
});
