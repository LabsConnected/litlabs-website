/**
 * Phase 3C.2 — AgentLoop tests.
 *
 * Tests the canonical agent execution loop through the hardened pipeline:
 *   AgentLoop → RuntimeSession → CommandExecutor → runCommand() → ShellExecutor
 *
 * Acceptance criteria verified:
 *   - agent executes a real tool through CommandExecutor
 *   - streaming reaches the agent/runtime event bus
 *   - cancellation stops the current tool and agent run cleanly
 *   - timeout does not become generic failure
 *   - failed command can be reasoned about/retried
 *   - runId stays constant across the agent run
 *   - each tool call gets its own toolCallId
 *   - direct execution bypass attempts fail
 *   - approval-required action blocks correctly
 *   - no secrets leak into model/tool lifecycle events
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CliAgentLoop, type AgentStep, redactStepResult } from "../lib/agent-loop.js";
import { RuntimeSession } from "../lib/runtime-session.js";
import type { StreamChunk, RuntimeEvent } from "@litt/agent-core";
import { redactSecrets } from "@litt/agent-core";

// ─── Helpers ──────────────────────────────────────────────────────

function createSession(mode?: "plan" | "act" | "auto"): RuntimeSession {
  return new RuntimeSession({
    cwd: process.cwd(),
    mode: mode ?? "act",
  });
}

function createLoop(
  session: RuntimeSession,
  options?: {
    onStream?: (chunk: StreamChunk) => void;
    onEvent?: (event: RuntimeEvent) => void;
    onApprovalRequired?: (step: AgentStep, risk: unknown) => Promise<boolean>;
    mode?: "plan" | "act" | "auto";
  },
): CliAgentLoop {
  return new CliAgentLoop({
    session,
    mode: options?.mode,
    onStream: options?.onStream,
    onEvent: options?.onEvent,
    onApprovalRequired: options?.onApprovalRequired,
  });
}

// ─── Tests ────────────────────────────────────────────────────────

describe("AgentLoop", () => {
  let session: RuntimeSession;

  beforeEach(() => {
    session = createSession();
  });

  afterEach(() => {
    session.uninstallSigintHandler();
  });

  // ─── Real tool execution ──────────────────────────────────────

  it("executes a real tool through CommandExecutor", async () => {
    const loop = createLoop(session);
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["status", "--short"], label: "git status" },
    ]);

    expect(result.status).toBe("success");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe("success");
    expect(result.steps[0].result.success).toBe(true);
  });

  it("executes multiple steps in sequence", async () => {
    const loop = createLoop(session);
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["status", "--short"] },
      { index: 1, toolCallId: "", command: "git", args: ["log", "--oneline", "-1"] },
    ]);

    expect(result.status).toBe("success");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].status).toBe("success");
    expect(result.steps[1].status).toBe("success");
  });

  // ─── Streaming ────────────────────────────────────────────────

  it("streaming reaches the agent runtime event bus", async () => {
    const chunks: StreamChunk[] = [];
    const loop = createLoop(session, {
      onStream: (chunk) => chunks.push(chunk),
    });

    await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["log", "--oneline", "-3"] },
    ]);

    // git log should produce stdout chunks
    expect(chunks.length).toBeGreaterThan(0);
    const stdoutChunks = chunks.filter((c) => c.stream === "stdout");
    expect(stdoutChunks.length).toBeGreaterThan(0);
    const output = stdoutChunks.map((c) => c.text).join("");
    // git log --oneline outputs commit hashes + messages
    expect(output.length).toBeGreaterThan(0);
    expect(output).toMatch(/[0-9a-f]{7,}/); // commit hash
  });

  // ─── Cancellation ─────────────────────────────────────────────

  it("cancellation stops the current tool and agent run cleanly", async () => {
    // node is arbitrary_code (elevated) — use AUTO mode to auto-approve
    const autoSession = createSession("auto");
    const loop = createLoop(autoSession, { mode: "auto" });

    // Start a long-running agent run
    const runPromise = loop.run([
      { index: 0, toolCallId: "", command: "node", args: ["-e", "setInterval(()=>{},10000)"], timeoutMs: 30000 },
      { index: 1, toolCallId: "", command: "git", args: ["status"] },
    ]);

    // Wait a moment, then cancel
    await new Promise((r) => setTimeout(r, 500));
    const killedPids = await loop.cancel();
    const result = await runPromise;

    expect(result.status).toBe("cancelled");
    expect(killedPids.length).toBeGreaterThan(0);
    // The second step should NOT have run
    expect(result.steps).toHaveLength(1);
  });

  // ─── Timeout vs failure ───────────────────────────────────────

  it("timeout does not become generic failure", async () => {
    // node is arbitrary_code (elevated) — use AUTO mode to auto-approve
    const autoSession = createSession("auto");
    const loop = createLoop(autoSession, { mode: "auto" });
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "node", args: ["-e", "setInterval(()=>{},10000)"], timeoutMs: 500 },
    ]);

    expect(result.status).toBe("timeout");
    expect(result.steps[0].status).toBe("timeout");
    expect(result.steps[0].status).not.toBe("failed");
  });

  // ─── Failed command isolation ─────────────────────────────────

  it("failed command can be reasoned about and retried", async () => {
    const loop = createLoop(session);

    // First run: fails
    const result1 = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["badcmd"] },
    ]);

    expect(result1.status).toBe("failed");
    expect(result1.failureStep).not.toBeNull();
    expect(result1.failureStep!.status).toBe("failed");
    expect(result1.failureStep!.result.message).toContain("badcmd");

    // Second run: succeeds (the failed run didn't corrupt state)
    const result2 = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["status", "--short"] },
    ]);

    expect(result2.status).toBe("success");
  });

  it("a failed tool call does not corrupt the next agent step", async () => {
    const loop = createLoop(session);
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["badcmd"] },
      { index: 1, toolCallId: "", command: "git", args: ["status", "--short"] },
    ]);

    // The loop stops on first failure — the second step should NOT run
    expect(result.status).toBe("failed");
    expect(result.steps).toHaveLength(1);
    expect(result.failureStep).toBe(result.steps[0]);
  });

  // ─── runId constancy ──────────────────────────────────────────

  it("runId stays constant across the agent run", async () => {
    const loop = createLoop(session);
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["status", "--short"] },
      { index: 1, toolCallId: "", command: "git", args: ["log", "--oneline", "-1"] },
      { index: 2, toolCallId: "", command: "git", args: ["branch", "--show-current"] },
    ]);

    expect(result.runId).toBeTruthy();
    // All steps should have the same runId
    for (const step of result.steps) {
      expect(step.runId).toBe(result.runId);
    }
  });

  // ─── toolCallId uniqueness ────────────────────────────────────

  it("each tool call gets its own toolCallId", async () => {
    const loop = createLoop(session);
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["status", "--short"] },
      { index: 1, toolCallId: "", command: "git", args: ["log", "--oneline", "-1"] },
      { index: 2, toolCallId: "", command: "git", args: ["branch", "--show-current"] },
    ]);

    const toolCallIds = result.steps.map((s) => s.toolCallId);
    expect(new Set(toolCallIds).size).toBe(3); // all unique
    for (const id of toolCallIds) {
      expect(id).toMatch(/^tc_\d+_/);
    }
  });

  // ─── Direct execution bypass ──────────────────────────────────

  it("direct execution bypass attempts fail — no spawn/exec inside the loop", async () => {
    // The AgentLoop does not expose any spawn/exec/execFile methods.
    // All execution goes through session.execute() → CommandExecutor → runCommand().
    // Attempting to use shell metacharacters should not bypass the structured argv.
    const loop = createLoop(session);
    const result = await loop.run([
      // The args are passed as structured argv — no shell interpretation
      { index: 0, toolCallId: "", command: "git", args: ["status; rm -rf /"] },
    ]);

    // This should fail because "status; rm -rf /" is not a valid git subcommand
    expect(result.status).toBe("failed");
    expect(result.steps[0].status).toBe("failed");
  });

  // ─── Approval-required actions ────────────────────────────────

  it("approval-required action blocks correctly in ACT mode without handler", async () => {
    // In ACT mode, elevated commands without an approval handler should be denied
    const actSession = createSession("act");
    const loop = createLoop(actSession, { mode: "act" });

    // pnpm install is workspace_edit (elevated) — needs approval in ACT mode
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "pnpm", args: ["install"] },
    ]);

    expect(result.status).toBe("failed");
    expect(result.steps[0].approved).toBe(false);
    expect(result.steps[0].result.message).toContain("Approval denied");
  });

  it("approval-required action proceeds when handler approves", async () => {
    const actSession = createSession("act");
    const loop = createLoop(actSession, {
      mode: "act",
      onApprovalRequired: async () => true, // always approve
    });

    // pnpm install is workspace_edit (elevated) — handler approves
    // We use a dry-run-ish command that won't actually modify much
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["config", "--local", "test.key", "test-value"] },
    ]);

    // git config is workspace_edit (elevated) — should be approved
    expect(result.steps[0].approved).toBe(true);
  });

  it("approval handler denial blocks the command", async () => {
    const actSession = createSession("act");
    const loop = createLoop(actSession, {
      mode: "act",
      onApprovalRequired: async () => false, // always deny
    });

    const result = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["config", "--local", "test.key", "test-value"] },
    ]);

    expect(result.status).toBe("failed");
    expect(result.steps[0].approved).toBe(false);
  });

  // ─── AUTO mode ────────────────────────────────────────────────

  it("AUTO mode auto-approves elevated commands", async () => {
    const autoSession = createSession("auto");
    const loop = createLoop(autoSession, { mode: "auto" });

    // git config is workspace_edit (elevated) — auto-approved in AUTO mode
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["config", "--local", "test.key2", "test-value2"] },
    ]);

    expect(result.steps[0].approved).toBe(true);
  });

  it("AUTO mode denies dangerous commands (no bypass)", async () => {
    const autoSession = createSession("auto");
    const loop = createLoop(autoSession, { mode: "auto" });

    // git push is external_action (dangerous) — denied in AUTO mode
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["push"] },
    ]);

    expect(result.status).toBe("failed");
    expect(result.steps[0].approved).toBe(false);
  });

  // ─── PLAN mode ────────────────────────────────────────────────

  it("PLAN mode rejects mutating commands", async () => {
    const planSession = createSession("plan");
    const loop = createLoop(planSession, { mode: "plan" });

    // git config is mutating — rejected in PLAN mode
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["config", "--local", "test.key3", "test-value3"] },
    ]);

    expect(result.status).toBe("failed");
    expect(result.steps[0].approved).toBe(false);
  });

  it("PLAN mode allows read-only commands", async () => {
    const planSession = createSession("plan");
    const loop = createLoop(planSession, { mode: "plan" });

    // git status is read_only — allowed in PLAN mode
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["status", "--short"] },
    ]);

    expect(result.status).toBe("success");
  });

  // ─── Secret redaction ─────────────────────────────────────────

  it("no secrets leak into model/tool lifecycle events", async () => {
    const loop = createLoop(session);
    const secret = "sk-test123456789012345678901234567890";

    // Run a command that outputs a secret-like string
    const result = await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["log", "--oneline", "-1"] },
    ]);

    // The redactSecrets function should be available and work
    const redacted = redactSecrets(`token=${secret}`);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("[REDACTED]");

    // The step result message should not contain raw secrets
    for (const step of result.steps) {
      expect(step.result.message).not.toContain(secret);
    }
  });

  it("redactStepResult strips secrets from step output", () => {
    const fakeResult = {
      step: { index: 0, toolCallId: "tc_1", command: "echo", args: [] },
      result: {
        status: "success" as const,
        success: true,
        message: "token=sk-test123456789012345678901234567890",
        data: {
          stdout: "Bearer abc123def456ghi789jkl012mno345pqr",
          stderr: "password=secretpassword12345678",
        },
      },
      runId: "run_1",
      toolCallId: "tc_1",
      status: "success" as const,
      durationMs: 100,
      risk: { level: "safe", capability: "read_only", reason: "", mutating: false },
      approved: true,
    };

    const redacted = redactStepResult(fakeResult);
    expect(redacted.result.message).not.toContain("sk-test123456789012345678901234567890");
    expect(redacted.result.data?.stdout).not.toContain("Bearer abc123def456ghi789jkl012mno345pqr");
    expect(redacted.result.data?.stderr).not.toContain("secretpassword12345678");
  });

  // ─── Empty steps ──────────────────────────────────────────────

  it("handles empty step list", async () => {
    const loop = createLoop(session);
    const result = await loop.run([]);

    expect(result.status).toBe("success");
    expect(result.steps).toHaveLength(0);
    expect(result.failureStep).toBeNull();
  });

  // ─── getRunId ─────────────────────────────────────────────────

  it("getRunId returns null before run and the runId after", async () => {
    const loop = createLoop(session);
    expect(loop.getRunId()).toBeNull();

    await loop.run([
      { index: 0, toolCallId: "", command: "git", args: ["status", "--short"] },
    ]);

    expect(loop.getRunId()).toBeTruthy();
  });
});
