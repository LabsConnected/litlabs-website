/**
 * P0 reproduction — approval card + android tool execution through the
 * REAL mounted cockpit. Asserts the approval controls are VISIBLE in
 * the rendered frame and that deny/approve drive the actual outcome.
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s: string) =>
  s.replace(new RegExp(`${ESC}\][^\u0007]*\u0007`, "g"), "")
   .replace(new RegExp(`${ESC}\[[0-9;?]*[ -/]*[@-~]`, "g"), "");

async function mount(rows = 40) {
  const stdin = new PassThrough() as PassThrough & { isTTY?: boolean; setRawMode?: (v: boolean) => void; ref?: () => void; unref?: () => void };
  stdin.isTTY = true; stdin.setRawMode = () => {}; stdin.ref = () => {}; stdin.unref = () => {};
  let out = "";
  const stdout = new PassThrough() as PassThrough & { columns?: number; rows?: number; isTTY?: boolean };
  stdout.columns = 120; stdout.rows = rows; stdout.isTTY = true;
  stdout.on("data", (c: Buffer) => { out += c.toString(); });

  const approvalBridge = new ApprovalBridge();
  const sessionBridge = new SessionEventBridge();
  const session = createRuntimeSession({
    cwd: process.cwd(), mode: "act",
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
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false, patchConsole: false, interactive: true },
  );
  await sleep(400);
  return {
    send: async (d: string) => { stdin.write(d); await sleep(150); },
    output: () => stripAnsi(out),
    lastFrame: () => stripAnsi(out.slice(-12000)),
    waitFor: async (pred: (s: string) => boolean, ms = 8000) => {
      const dl = Date.now() + ms;
      while (Date.now() < dl) { if (pred(stripAnsi(out))) return true; await sleep(100); }
      return pred(stripAnsi(out));
    },
    session, cleanup: () => { instance.unmount(); stdin.end(); },
  };
}

let littHome: string;
const savedEnv: Record<string, string | undefined> = {};
const KEYS = ["LITT_STATE_HOME", "LITT_HOME", "LITT_LOCAL_MODE", "LITT_LOCAL_ONLY", "LITT_TARGET_OVERRIDE"];
beforeAll(() => {
  for (const k of KEYS) savedEnv[k] = process.env[k];
  littHome = fs.mkdtempSync(join(os.tmpdir(), "litt-approve-tui-"));
  process.env.LITT_STATE_HOME = littHome;
  process.env.LITT_LOCAL_MODE = "1";
});
afterAll(() => {
  for (const k of KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  try { fs.rmSync(littHome, { recursive: true, force: true }); } catch { /* best-effort */ }
});
describe("android approval card — P0 reproduction", () => {
  it("approval card renders WITH controls when a mutating tool executes", async () => {
    const c = await mount();
    try {
      const id = { tenantId: "t", userId: "u", actorId: "u", trusted: false, interaction: "interactive" as const };
      const p = c.session.getGateway().execute({
        toolId: "android.key", inputs: { name: "home" }, cwd: process.cwd(), mode: "act", identity: id,
      });
      const shown = await c.waitFor((s) => /APPROVAL/.test(s), 8000);
      expect(shown).toBe(true);
      // The controls row must be visible — deny first (zero device contact).
      const controls = await c.waitFor((s) => /deny/.test(s), 4000);
      expect(controls).toBe(true);
      await c.send("d");
      const r = await p;
      expect(r.result.success).toBe(false);
      expect(String(r.result.message)).toContain("denied");
    } finally { c.cleanup(); }
  }, 30_000);

  it("approval card stays visible at SHORT terminal height", async () => {
    const c = await mount(18);
    try {
      const id = { tenantId: "t", userId: "u", actorId: "u", trusted: false, interaction: "interactive" as const };
      const p = c.session.getGateway().execute({
        toolId: "android.key", inputs: { name: "home" }, cwd: process.cwd(), mode: "act", identity: id,
      });
      const shown = await c.waitFor((s) => /APPROVAL/.test(s) && /deny/.test(s), 8000);
      await c.send("d");
      await p;
      expect(shown).toBe(true); // FAILS if clipped — the P0 symptom
    } finally { c.cleanup(); }
  }, 30_000);

  it("failed tool + pending approval — card still renders (user's exact combo)", async () => {
    const c = await mount();
    try {
      const id = { tenantId: "t", userId: "u", actorId: "u", trusted: false, interaction: "interactive" as const };
      // 1. A failing READ call first — resolves fast with no approval
      // (non-allowlisted serial is rejected before any spawn).
      const bad = await c.session.getGateway().execute({
        toolId: "android.device_state", inputs: { serial: "EVILSERIAL99" }, cwd: process.cwd(), mode: "act", identity: id,
      });
      expect(bad.result.success).toBe(false);
      // 2. Then a mutating call that pendss on approval
      const p = c.session.getGateway().execute({
        toolId: "android.key", inputs: { name: "home" }, cwd: process.cwd(), mode: "act", identity: id,
      });
      // Card MUST render with controls even with a prior failure on screen
      const ok = await c.waitFor((s) => /APPROVAL/.test(s) && /deny/.test(s), 8000);
      expect(ok).toBe(true);
      await c.send("d");
      const r = await p;
      expect(r.result.success).toBe(false);
    } finally { c.cleanup(); }
  }, 30_000);

  it("card names the actual operation AND device", async () => {
    const c = await mount();
    try {
      const id = { tenantId: "t", userId: "u", actorId: "u", trusted: false, interaction: "interactive" as const };
      const p = c.session.getGateway().execute({
        toolId: "android.key", inputs: { name: "home" }, cwd: process.cwd(), mode: "act", identity: id,
      });
      // The card must say WHICH operation on WHICH device — not a bare
      // "android.key". No serial supplied → honest "(default device)".
      const shown = await c.waitFor((s) => /android\.key/.test(s) && /device:/.test(s) && /name=home/.test(s), 8000);
      expect(shown).toBe(true);
      await c.send("d");
      await p;
    } finally { c.cleanup(); }
  }, 30_000);

  it("deny drains the queue — phantom 'Approval required above' clears", async () => {
    const c = await mount();
    try {
      const id = { tenantId: "t", userId: "u", actorId: "u", trusted: false, interaction: "interactive" as const };
      const p = c.session.getGateway().execute({
        toolId: "android.key", inputs: { name: "home" }, cwd: process.cwd(), mode: "act", identity: id,
      });
      const shown = await c.waitFor((s) => /deny/.test(s), 8000);
      expect(shown).toBe(true);
      await c.send("d");
      const r = await p;
      expect(r.result.success).toBe(false);
      // THE BUG: after the last decision, the bridge notified pending=null
      // but the subscriber ignored it — holoState stayed "APPROVAL" and the
      // composer kept saying "Approval required above" forever with no card.
      // The output is append-only, so the pending frame remains in
      // scrollback — the assertion is ORDERING: the restored normal
      // composer must be the LAST state rendered.
      await sleep(900);
      const out = c.output();
      const lastApprovalCopy = out.lastIndexOf("Approval required above");
      const lastComposer = out.lastIndexOf("Ask LiTT anything");
      expect(lastApprovalCopy).toBeGreaterThanOrEqual(0);  // it DID show while pending
      expect(lastComposer).toBeGreaterThan(lastApprovalCopy); // and recovered after
    } finally { c.cleanup(); }
  }, 30_000);

  it("Esc denies ALL pending approvals and cancels the run (fail closed)", async () => {
    const c = await mount();
    try {
      const id = { tenantId: "t", userId: "u", actorId: "u", trusted: false, interaction: "interactive" as const };
      const p = c.session.getGateway().execute({
        toolId: "android.key", inputs: { name: "home" }, cwd: process.cwd(), mode: "act", identity: id,
      });
      const shown = await c.waitFor((s) => /deny/.test(s), 8000);
      expect(shown).toBe(true);
      await c.send(ESC); // Escape — previously swallowed (unwired onCancelMission)
      const r = await p;
      expect(r.result.success).toBe(false);
      expect(String(r.result.message)).toContain("denied");
    } finally { c.cleanup(); }
  }, 30_000);

  it("decisions land on the correct tool-call IDs (queued order)", async () => {
    const c = await mount();
    try {
      const id = { tenantId: "t", userId: "u", actorId: "u", trusted: false, interaction: "interactive" as const };
      // Two concurrent approval-needing calls queue FIFO in the bridge.
      const p1 = c.session.getGateway().execute({
        toolId: "android.key", inputs: { name: "home" }, cwd: process.cwd(), mode: "act", identity: id, toolCallId: "tc_first",
      });
      const p2 = c.session.getGateway().execute({
        toolId: "android.key", inputs: { name: "back" }, cwd: process.cwd(), mode: "act", identity: id, toolCallId: "tc_second",
      });
      // First card shows the FIRST call's action (home); deciding denies it.
      const first = await c.waitFor((s) => /name=home/.test(s), 8000);
      expect(first).toBe(true);
      await c.send("d");
      const r1 = await p1;
      expect(r1.toolCallId).toBe("tc_first");
      expect(r1.result.success).toBe(false);
      // The queued second call now owns the card — deny it too.
      const second = await c.waitFor((s) => /name=back/.test(s), 8000);
      expect(second).toBe(true);
      await c.send("d");
      const r2 = await p2;
      expect(r2.toolCallId).toBe("tc_second");
      expect(r2.result.success).toBe(false);
    } finally { c.cleanup(); }
  }, 30_000);
});
