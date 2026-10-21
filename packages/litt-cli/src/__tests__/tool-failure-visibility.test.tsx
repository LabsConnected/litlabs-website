/**
 * P0 regression — `× Android Key` with no readable error.
 *
 * Captured live trace (Windows, real adb): the model's android.key call
 * reached the gateway, approval was granted, the handler ran, and
 * resolveTarget reported `no_device` — "No usable devices are attached".
 * The agent_tool_result event carries the reason in `data.message`
 * (NEVER `data.error`), but event-bridge read `data.error` → the feed
 * showed a bare "error" and the WorkstreamDock dropped `reason`
 * entirely — the operator saw only `× Android Key`.
 *
 * These tests pin the projection contract:
 *   - the real reason renders beneath/beside the failed row
 *   - "not executed" vs "attempted" is honest (denied/validation/guard
 *     vs a dispatch that ran and failed)
 *   - a failed operation can never render as success
 *   - the failure renders exactly once
 */

import React from "react";
import { PassThrough } from "node:stream";
import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { render } from "ink";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { toolFailureInfo } from "../ink/event-bridge.js";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import { groupConsecutive } from "../ink/workstream-normalizer.js";
import { WorkstreamDock } from "../ink/workstream-dock.js";
import { WorkstreamStore } from "../ink/workstream-store.js";
import { CockpitApp } from "../ink/app.js";
import { ApprovalBridge } from "../ink/approval-bridge.js";
import { createRuntimeSession } from "../lib/runtime-session.js";
import type { RuntimeEvent } from "@litt/agent-core";

// ─── Pure projection tests ─────────────────────────────────────────

describe("toolFailureInfo — reason + execution truth", () => {
  it("schema rejection is not-executed with the real message", () => {
    const info = toolFailureInfo({
      tool: "android_key",
      status: "failed",
      success: false,
      failure: "invalid_arg",
      message: "Tool argument validation failed: Missing required argument: name",
    });
    expect(info.reason).toContain("Missing required argument");
    expect(info.executed).toBe(false);
    expect(info.detail).toContain("not executed");
  });

  it("gateway denial is not-executed", () => {
    const info = toolFailureInfo({
      tool: "android_key",
      success: false,
      denied: true,
      message: "Approval denied or not available",
    });
    expect(info.reason).toBe("Approval denied or not available");
    expect(info.executed).toBe(false);
  });

  it("device-resolution guard failure is not-executed with the real reason", () => {
    const info = toolFailureInfo({
      tool: "android_key",
      success: false,
      failure: "no_device",
      message: "No usable devices are attached",
    });
    expect(info.reason).toBe("No usable devices are attached");
    expect(info.executed).toBe(false);
  });

  it("a real adb execution failure is marked attempted", () => {
    const info = toolFailureInfo({
      tool: "android_key",
      success: false,
      failure: "exec_failed",
      message: "key home failed: adb exited with code 1",
    });
    expect(info.executed).toBe(true);
    expect(info.detail).toContain("attempted");
  });

  it("reads data.error first for remote-path events", () => {
    const info = toolFailureInfo({ error: "socket closed", message: "fallback" });
    expect(info.reason).toBe("socket closed");
  });

  it("collapses multi-line messages to the first line", () => {
    const info = toolFailureInfo({ message: "first line\nsecond line" });
    expect(info.reason).toBe("first line");
  });
});

// ─── WorkstreamDock reason propagation ─────────────────────────────

describe("workstream failure reason — projection through groupConsecutive", () => {
  it("failed groups carry the reason", () => {
    const groups = groupConsecutive([
      { id: "1", kind: "tool" as const, label: "Android Key", status: "failed" as const, reason: "No usable devices are attached · not executed" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toContain("No usable devices");
  });

  it("consecutive identical failures keep the latest reason, once", () => {
    const groups = groupConsecutive([
      { id: "1", kind: "tool" as const, label: "Android Key", status: "failed" as const, reason: "r1" },
      { id: "2", kind: "tool" as const, label: "Android Key", status: "failed" as const, reason: "r2" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("r2");
  });
});

describe("WorkstreamDock rendering", () => {
  function renderDock(store: WorkstreamStore): string {
    const out = new PassThrough() as PassThrough & { columns?: number; isTTY?: boolean };
    out.columns = 100;
    let text = "";
    out.on("data", (c: Buffer) => { text += c.toString(); });
    const inst = render(
      React.createElement(WorkstreamDock, { snapshot: store.snapshot(), width: 90 }),
      { stdout: out as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
    );
    inst.unmount();
    return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  }

  it("a failed android.key row renders the real reason beneath × label", () => {
    const store = new WorkstreamStore();
    store.setObjective("press home");
    const id = store.begin("tool", "RUNNING", "Android Key", "Android Key");
    store.fail(id, "No usable devices are attached · not executed");
    const frame = renderDock(store);
    expect(frame).toContain("Android Key");
    expect(frame).toContain("No usable devices are attached");
    expect(frame).toContain("not executed");
    // Exactly once — no duplicate reason rows.
    expect(frame.split("No usable devices are attached").length - 1).toBe(1);
  });

  it("a failed row can never render as success (no ✓ for failures)", () => {
    const store = new WorkstreamStore();
    store.setObjective("press home");
    const id = store.begin("tool", "RUNNING", "Android Key", "Android Key");
    store.fail(id, "denied");
    const frame = renderDock(store);
    expect(frame).not.toContain("✓ Android Key");
    expect(frame).toContain("×");
  });
});

// ─── Full cockpit projection — REAL mounted app ────────────────────

const ESC = String.fromCharCode(0x1b);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s: string) =>
  s.replace(new RegExp(`${ESC}\][^]*`, "g"), "")
   .replace(new RegExp(`${ESC}\[[0-9;?]*[ -/]*[@-~]`, "g"), "");

let littHome: string;
const savedEnv: Record<string, string | undefined> = {};
const KEYS = ["LITT_STATE_HOME", "LITT_HOME", "LITT_LOCAL_MODE", "LITT_LOCAL_ONLY"];
beforeAll(() => {
  for (const k of KEYS) savedEnv[k] = process.env[k];
  littHome = fs.mkdtempSync(join(os.tmpdir(), "litt-failvis-"));
  process.env.LITT_STATE_HOME = littHome;
  process.env.LITT_LOCAL_MODE = "1";
});
afterAll(() => {
  for (const k of KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  try { fs.rmSync(littHome, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe("failed tool → visible transcript (mounted cockpit)", () => {
  it("tool.failed renders the REAL reason under the failed row — once", async () => {
    const stdin = new PassThrough() as PassThrough & { isTTY?: boolean; setRawMode?: (v: boolean) => void; ref?: () => void; unref?: () => void };
    stdin.isTTY = true; stdin.setRawMode = () => {}; stdin.ref = () => {}; stdin.unref = () => {};
    let out = "";
    const stdout = new PassThrough() as PassThrough & { columns?: number; rows?: number; isTTY?: boolean };
    stdout.columns = 120; stdout.rows = 40; stdout.isTTY = true;
    stdout.on("data", (c: Buffer) => { out += c.toString(); });

    const approvalBridge = new ApprovalBridge();
    const sessionBridge = new SessionEventBridge();
    const session = createRuntimeSession({
      cwd: process.cwd(), mode: "act",
      onApprovalRequired: (r, risk) => approvalBridge.request(r, risk),
      onEvent: (e) => sessionBridge.onEvent(e),
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
    try {
      await sleep(400);
      // The exact captured event sequence: tool.started then tool.failed
      // with the reason in data.message (the canonical agent payload).
      const call: RuntimeEvent = {
        type: "litt_event", subtype: "agent_tool_call", ts: Date.now(),
        toolCallId: "tc_fail_1",
        data: { tool: "android_key", toolId: "android.key", inputs: { name: "home" } },
      };
      const result: RuntimeEvent = {
        type: "litt_event", subtype: "agent_tool_result", ts: Date.now(),
        toolCallId: "tc_fail_1",
        data: {
          tool: "android_key", toolId: "android.key", status: "failed",
          success: false, message: "No usable devices are attached",
          failure: "no_device", durationMs: 200,
        },
      };
      session.emitAgentEvent(call);
      session.emitAgentEvent(result);
      // Duplicate delivery must not duplicate the visible failure.
      session.emitAgentEvent(result);

      const deadline = Date.now() + 8000;
      let frame = "";
      while (Date.now() < deadline) {
        frame = stripAnsi(out);
        if (/No usable devices are attached/.test(frame)) break;
        await sleep(100);
      }
      frame = stripAnsi(out);
      expect(frame).toContain("Android Key");
      expect(frame).toContain("No usable devices are attached");
      expect(frame).toContain("not executed");
      expect(frame.split("No usable devices are attached").length - 1).toBeLessThanOrEqual(2);
      // Never a success glyph for the failed op.
      expect(frame).not.toContain("✓ Android Key");
    } finally {
      instance.unmount();
      stdin.end();
    }
  }, 30_000);
});
