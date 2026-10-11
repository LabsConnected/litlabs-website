/**
 * Milestone 1 regression tests — `litt ask` mode enforcement.
 *
 * Guards the fix for the "--mode plan" bypass (ask.ts hardcoded mode "act"
 * and auto-approved every approval):
 *
 *   1. PLAN mode denies mutating tools at the execution policy layer —
 *      the approval callback is never consulted.
 *   2. ACT + headless interaction denies approval-required actions
 *      (fail closed) — the callback is never consulted.
 *   3. ACT + interactive + human approval via ApprovalBridge → executes
 *      (genuine authorization, not auto-approve).
 *   4. ACT + interactive + human denial via ApprovalBridge → denied,
 *      zero mutations.
 *   5. RuntimeSession carries the --mode flag (the value ask.ts now
 *      threads into the agent loop instead of hardcoding "act").
 *
 * Uses the real ExecutionGateway + ApprovalBridge + ToolRegistry against a
 * scratch project dir. Marker files prove whether a mutation happened.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { PassThrough } from "node:stream";
import {
  ExecutionGateway,
  ToolRegistry,
  createShellExecutor,
  CommandExecutor,
  RuntimeStore,
  type ExecutionRequest,
  type RiskAssessment,
} from "@litt/agent-core";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { ApprovalBridge } from "../ink/approval-bridge.js";
import { driveApprovalBridgeFromTty } from "../commands/ask.js";

const SCRATCH = "/tmp/litt-m1-scratch";

interface Harness {
  gateway: ExecutionGateway;
  bridge: ApprovalBridge;
  approvalCallbacks: string[];
}

function makeHarness(): Harness {
  const store = new RuntimeStore();
  const shell = createShellExecutor(SCRATCH);
  const executor = new CommandExecutor(shell, store);
  const tools = new ToolRegistry();
  const bridge = new ApprovalBridge();
  const approvalCallbacks: string[] = [];
  const gateway = new ExecutionGateway({
    tools,
    shell,
    executor,
    store,
    projectId: SCRATCH,
    // Mirrors the patched ask.ts wiring: genuine human approval through
    // the existing ApprovalBridge — never an unconditional true.
    onApprovalRequired: (request: ExecutionRequest, risk: RiskAssessment | null) => {
      approvalCallbacks.push(request.toolId);
      return bridge.request(request, risk);
    },
  });
  return { gateway, bridge, approvalCallbacks };
}

function touchRequest(
  mode: "plan" | "act" | "auto",
  interaction: "interactive" | "headless",
  marker: string,
): ExecutionRequest {
  return {
    toolId: "project.run",
    inputs: { command: "touch", args: [marker] },
    cwd: SCRATCH,
    mode,
    identity: {
      tenantId: "test",
      userId: "test-user",
      actorId: "test-user",
      trusted: false,
      interaction,
    },
  };
}

/** Drive the bridge like a human answering the TTY prompt. */
function simulateHuman(bridge: ApprovalBridge, approve: boolean): void {
  bridge.subscribe((pending) => {
    if (pending) setImmediate(() => bridge.decide(approve));
  });
}

const markers: string[] = [];
function markerName(test: string): string {
  const name = `M1_TEST_${test}.txt`;
  markers.push(name);
  return name;
}

beforeEach(() => {
  mkdirSync(SCRATCH, { recursive: true });
});

afterEach(() => {
  for (const m of markers.splice(0)) {
    const p = `${SCRATCH}/${m}`;
    if (existsSync(p)) rmSync(p);
  }
});

describe("ask mode enforcement (milestone 1)", () => {
  it("PLAN mode denies a mutating tool at the policy layer; approval never consulted", async () => {
    const { gateway, approvalCallbacks } = makeHarness();
    const marker = markerName("plan");
    const res = await gateway.execute(touchRequest("plan", "headless", marker));

    expect(res.policyEffect).toBe("deny");
    expect(res.result.success).toBe(false);
    expect(res.denialReason ?? res.result.message).toMatch(/plan/i);
    expect(approvalCallbacks).toEqual([]);
    expect(existsSync(`${SCRATCH}/${marker}`)).toBe(false);
  });

  it("ACT + headless denies approval-required actions (fail closed); callback never consulted", async () => {
    const { gateway, approvalCallbacks } = makeHarness();
    const marker = markerName("act-headless");
    const res = await gateway.execute(touchRequest("act", "headless", marker));

    expect(res.result.success).toBe(false);
    expect(approvalCallbacks).toEqual([]);
    expect(existsSync(`${SCRATCH}/${marker}`)).toBe(false);
  });

  it("ACT + interactive + bridge approval executes (genuine authorization)", async () => {
    const { gateway, bridge, approvalCallbacks } = makeHarness();
    simulateHuman(bridge, true);
    const marker = markerName("act-approved");
    const res = await gateway.execute(touchRequest("act", "interactive", marker));

    expect(approvalCallbacks).toEqual(["project.run"]);
    expect(res.approved).toBe(true);
    expect(res.result.success).toBe(true);
    expect(existsSync(`${SCRATCH}/${marker}`)).toBe(true);
  });

  it("ACT + interactive + bridge denial blocks execution; zero mutations", async () => {
    const { gateway, bridge, approvalCallbacks } = makeHarness();
    simulateHuman(bridge, false);
    const marker = markerName("act-denied");
    const res = await gateway.execute(touchRequest("act", "interactive", marker));

    expect(approvalCallbacks).toEqual(["project.run"]);
    expect(res.result.success).toBe(false);
    expect(existsSync(`${SCRATCH}/${marker}`)).toBe(false);
  });

  it("RuntimeSession carries the --mode flag value (no hardcoded act)", () => {
    expect(createRuntimeSession({ cwd: SCRATCH, mode: "plan" }).getMode()).toBe("plan");
    expect(createRuntimeSession({ cwd: SCRATCH, mode: "auto" }).getMode()).toBe("auto");
    expect(createRuntimeSession({ cwd: SCRATCH }).getMode()).toBe("act");
  });

  it("read-only tools still work in PLAN mode", async () => {
    const { gateway } = makeHarness();
    const res = await gateway.execute({
      toolId: "project.list_files",
      inputs: { path: "." },
      cwd: SCRATCH,
      mode: "plan",
      identity: {
        tenantId: "test",
        userId: "test-user",
        actorId: "test-user",
        trusted: false,
        interaction: "headless",
      },
    });
    expect(res.result.success).toBe(true);
  });

  it("headless require_approval settles promptly (cannot hang waiting for approval)", async () => {
    const { gateway, approvalCallbacks } = makeHarness();
    const marker = markerName("no-hang");
    const hanging = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("HUNG: headless approval never settled")), 5000),
    );
    const res = await Promise.race([
      gateway.execute(touchRequest("act", "headless", marker)),
      hanging,
    ]);
    expect(res.result.success).toBe(false);
    expect(approvalCallbacks).toEqual([]);
    expect(existsSync(`${SCRATCH}/${marker}`)).toBe(false);
  });
});

describe("driveApprovalBridgeFromTty (milestone 1 review)", () => {
  function makeRequest(toolId = "project.run"): ExecutionRequest {
    return {
      toolId,
      inputs: { command: "touch", args: ["x"] },
      cwd: SCRATCH,
      mode: "act",
      identity: {
        tenantId: "test",
        userId: "test-user",
        actorId: "test-user",
        trusted: false,
        interaction: "interactive",
      },
    };
  }

  function makeDriver() {
    const bridge = new ApprovalBridge();
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume(); // drain prompt writes
    const close = driveApprovalBridgeFromTty(bridge, input, output);
    return { bridge, input, output, close };
  }

  it("prompts and resolves true on 'y'", async () => {
    const { bridge, input, close } = makeDriver();
    const pending = bridge.request(makeRequest(), null);
    await new Promise((r) => setImmediate(r)); // let the subscriber prompt
    expect(bridge.pending).not.toBeNull();
    input.write("y\n");
    await expect(pending).resolves.toBe(true);
    expect(bridge.pending).toBeNull();
    close();
  });

  it("resolves false on 'n' and on empty answer", async () => {
    for (const answer of ["n\n", "\n"]) {
      const { bridge, input, close } = makeDriver();
      const pending = bridge.request(makeRequest(), null);
      await new Promise((r) => setImmediate(r));
      input.write(answer);
      await expect(pending).resolves.toBe(false);
      close();
    }
  });

  it("serializes queued approvals: each asked once, none dropped", async () => {
    const { bridge, input, close } = makeDriver();
    const first = bridge.request(makeRequest("project.run"), null);
    const second = bridge.request(makeRequest("project.run"), null);
    await new Promise((r) => setImmediate(r));
    expect(bridge.depth).toBe(2);
    input.write("y\n"); // approve the head
    await expect(first).resolves.toBe(true);
    // the second prompt must now be active (asked exactly once, in order)
    await new Promise((r) => setImmediate(r));
    expect(bridge.pending).not.toBeNull();
    expect(bridge.depth).toBe(1);
    input.write("n\n"); // deny the second
    await expect(second).resolves.toBe(false);
    expect(bridge.pending).toBeNull();
    close();
  });

  it("cleanup cancels a pending approval and is idempotent", async () => {
    const { bridge, input, close } = makeDriver();
    const pending = bridge.request(makeRequest(), null);
    await new Promise((r) => setImmediate(r));
    expect(bridge.pending).not.toBeNull();
    close();
    await expect(pending).resolves.toBe(false);
    expect(bridge.pending).toBeNull();
    expect(() => close()).not.toThrow();
    input.write("y\n"); // late answer after close: must not revive anything
    await new Promise((r) => setImmediate(r));
    expect(bridge.pending).toBeNull();
  });
});
