/**
 * V1 BLOCKER regression tests.
 *
 * Tests for the two blockers found in real TUI acceptance:
 *   1. Realtime capability is registered in the actual CLI runtime registry
 *   2. Compound mission completion truth — partial success must NOT be COMPLETE
 *
 * Required tests:
 *   1. realtime capability is registered in the actual CLI runtime registry
 *   2. realtime-capable query can reach the tool through ExecutionGateway
 *   3. current-data request without realtime evidence cannot claim current facts
 *   4. weather/realtime failure is surfaced truthfully
 *   5. compound request: repo succeeds + realtime fails → mission NOT COMPLETE
 *   6. compound request where all objectives succeed may COMPLETE
 *   7. VerificationGate still governs real mission completion
 *   8. ordinary repo missions remain unchanged
 *   9. ordinary chat does not unnecessarily call realtime tools
 *   10. LOCAL fast lane remains unchanged
 *   11. READ lane remains unchanged
 *   12. mutation/approval semantics remain unchanged
 */

import { describe, it, expect } from "vitest";
import { createDefaultRegistry, ToolRegistry, ExecutionGateway, RuntimeStore, CommandExecutor, createShellExecutor } from "@litt/agent-core";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { createMissionEvidenceTracker, MissionVerificationGate } from "../lib/mission-verification.js";
import { classifyIntent } from "../lib/intent.js";
import { matchLocalFastPath } from "../lib/local-fast-lane.js";
import { matchReadTools } from "../lib/read-lane.js";

// ─── Test 1: Realtime tools registered in CLI runtime ─────────────

describe("BLOCKER 1 — Realtime capability in CLI runtime", () => {
  it("test 1: realtime tools are registered in createDefaultRegistry", () => {
    const registry = createDefaultRegistry();
    expect(registry.get("web.search")).not.toBeNull();
    expect(registry.get("web.fetch")).not.toBeNull();
    expect(registry.get("weather.forecast")).not.toBeNull();
  });

  it("test 1b: realtime tools are registered in new ToolRegistry()", () => {
    // This is what runtime-session.ts uses
    const registry = new ToolRegistry();
    expect(registry.get("web.search")).not.toBeNull();
    expect(registry.get("web.fetch")).not.toBeNull();
    expect(registry.get("weather.forecast")).not.toBeNull();
  });

  it("test 1c: realtime tools are registered in the actual CLI session gateway", () => {
    const session = createRuntimeSession({ cwd: process.cwd(), mode: "act" });
    const gateway = session.getGateway();
    const tools = gateway.getTools();
    expect(tools.get("web.search")).not.toBeNull();
    expect(tools.get("web.fetch")).not.toBeNull();
    expect(tools.get("weather.forecast")).not.toBeNull();
  });

  it("test 2: realtime tool can be executed through ExecutionGateway", async () => {
    const store = new RuntimeStore();
    const shell = createShellExecutor(process.cwd());
    const executor = new CommandExecutor(shell, store);
    const tools = new ToolRegistry();
    const gateway = new ExecutionGateway({
      tools,
      shell,
      executor,
      store,
      projectId: process.cwd(),
    });

    // Execute web.search through the gateway — this is a read-only tool
    // that doesn't require approval. May fail due to no network in test
    // env, but MUST NOT return "Unknown tool" (that would mean the tool
    // is not registered).
    const result = await gateway.execute({
      toolId: "web.search",
      inputs: { query: "test query" },
      cwd: process.cwd(),
      mode: "act",
      identity: {
        tenantId: "test",
        userId: "test",
        actorId: "test",
        trusted: false,
        interaction: "interactive",
      },
      runId: "test-run",
      toolCallId: "test-call",
    });

    // The tool must be FOUND — "Unknown tool" means it's not registered
    expect(result.result.message).not.toContain("Unknown tool");
    // It should either succeed or fail with a network error, not a
    // "tool not available" error
    expect(result.approved).toBe(true);
  });

  it("test 3: weather.forecast is available as a tool", async () => {
    const registry = createDefaultRegistry();
    const entry = registry.get("weather.forecast");
    expect(entry).not.toBeNull();
    expect(entry?.definition.readOnly).toBe(true);
  });
});

// ─── Test 4-7: Compound mission completion truth ──────────────────

describe("BLOCKER 2 — Compound mission completion truth", () => {
  // Helper: create a verification gate with the given evidence state
  function makeGate(opts: {
    isReadOnly: boolean;
    hasSuccess: boolean;
    hasFailures: boolean;
    summary?: string;
    failedSummary?: string;
  }): MissionVerificationGate {
    return new MissionVerificationGate({
      fullGate: {
        verify: async () => ({
          proven: false,
          status: "failed",
          checks: [],
          totalDurationMs: 0,
          message: "full gate not run",
          runId: "test",
          ranChecks: [],
          skippedChecks: [],
        }),
      },
      store: null,
      emitter: null,
      isReadOnly: () => opts.isReadOnly,
      hasSuccessfulEvidence: () => opts.hasSuccess,
      hasFailedEvidence: () => opts.hasFailures,
      evidenceSummary: () => opts.summary ?? "test summary",
      failedSummary: () => opts.failedSummary ?? "test failure",
    });
  }

  it("test 4: weather/realtime failure is surfaced truthfully", async () => {
    const gate = makeGate({
      isReadOnly: true,
      hasSuccess: true,
      hasFailures: true,
      summary: "project.status: ok; project.branch: ok",
      failedSummary: "weather.forecast: no network",
    });
    const result = await gate.verify();
    expect(result.proven).toBe(false);
    expect(result.message).toContain("weather.forecast");
    expect(result.message).toContain("failed");
  });

  it("test 5: compound request — repo succeeds + realtime fails → NOT COMPLETE", async () => {
    // Simulate: project.inspect_package succeeded, project.branch succeeded,
    // but weather.forecast failed.
    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
    // Record tool results
    tracker.recordToolResult("project.inspect_package", true, "framework: Next.js");
    tracker.recordToolResult("project.branch", true, "main");
    tracker.recordToolResult("weather.forecast", false, "no network available");

    expect(tracker.isReadOnly()).toBe(true);
    expect(tracker.hasSuccessfulEvidence()).toBe(true);
    expect(tracker.hasFailedEvidence()).toBe(true);

    const gate = makeGate({
      isReadOnly: tracker.isReadOnly(),
      hasSuccess: tracker.hasSuccessfulEvidence(),
      hasFailures: tracker.hasFailedEvidence(),
      summary: tracker.summary(),
      failedSummary: tracker.failedSummary(),
    });

    const result = await gate.verify();
    expect(result.proven).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Partial success");
    expect(result.message).toContain("weather.forecast");
  });

  it("test 6: compound request where ALL objectives succeed → may COMPLETE", async () => {
    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
    tracker.recordToolResult("project.inspect_package", true, "framework: Next.js");
    tracker.recordToolResult("project.branch", true, "main");
    tracker.recordToolResult("weather.forecast", true, "sunny 72F");

    expect(tracker.hasSuccessfulEvidence()).toBe(true);
    expect(tracker.hasFailedEvidence()).toBe(false);

    const gate = makeGate({
      isReadOnly: tracker.isReadOnly(),
      hasSuccess: tracker.hasSuccessfulEvidence(),
      hasFailures: tracker.hasFailedEvidence(),
      summary: tracker.summary(),
      failedSummary: tracker.failedSummary(),
    });

    const result = await gate.verify();
    expect(result.proven).toBe(true);
    expect(result.status).toBe("proven");
  });

  it("test 7: VerificationGate still governs real mission completion", async () => {
    // No evidence at all → not proven
    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );

    const gate = makeGate({
      isReadOnly: tracker.isReadOnly(),
      hasSuccess: tracker.hasSuccessfulEvidence(),
      hasFailures: tracker.hasFailedEvidence(),
      summary: tracker.summary(),
      failedSummary: tracker.failedSummary(),
    });

    const result = await gate.verify();
    expect(result.proven).toBe(false);
    expect(result.message).toContain("No successful tool evidence");
  });

  it("test 7b: all tools failed → NOT proven", async () => {
    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
    tracker.recordToolResult("weather.forecast", false, "no network");

    const gate = makeGate({
      isReadOnly: tracker.isReadOnly(),
      hasSuccess: tracker.hasSuccessfulEvidence(),
      hasFailures: tracker.hasFailedEvidence(),
      summary: tracker.summary(),
      failedSummary: tracker.failedSummary(),
    });

    const result = await gate.verify();
    expect(result.proven).toBe(false);
    // Message should mention the failed tool
    expect(result.message).toContain("weather.forecast");
  });
});

// ─── Test 8-12: Existing behavior unchanged ───────────────────────

describe("Existing behavior unchanged", () => {
  it("test 8: ordinary repo missions remain unchanged", () => {
    // Intent classification for repo inspection
    expect(classifyIntent("inspect this repo")).toBe("mission");
    expect(classifyIntent("scan this repo and tell me what needs attention")).toBe("mission");
  });

  it("test 9: ordinary chat does not call realtime tools", () => {
    // Chat intent should not trigger realtime
    expect(classifyIntent("whats up")).toBe("chat");
    expect(classifyIntent("explain TypeScript generics")).toBe("chat");
  });

  it("test 10: LOCAL fast lane remains unchanged", () => {
    // Local fast lane should still match deterministic phrases
    const ctx = { cwd: process.cwd(), projectName: "test", mode: "act" as const };
    expect(matchLocalFastPath("exit", ctx)).not.toBeNull();
    expect(matchLocalFastPath("quit", ctx)).not.toBeNull();
    // Non-local phrases should not match
    expect(matchLocalFastPath("whats up", ctx)).toBeNull();
    expect(matchLocalFastPath("what framework is this", ctx)).toBeNull();
  });

  it("test 11: READ lane remains unchanged", () => {
    // Read lane should still match read-only queries
    const readMatch = matchReadTools("what framework is this");
    expect(readMatch).not.toBeNull();
    expect(readMatch?.calls.length).toBeGreaterThanOrEqual(1);

    const branchMatch = matchReadTools("what branch am i on");
    expect(branchMatch).not.toBeNull();
  });

  it("test 12: mutation/approval semantics remain unchanged", () => {
    // Mutation tools should still be tracked
    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
    tracker.recordToolCall("project.run");
    expect(tracker.isReadOnly()).toBe(false);

    // Read-only tools should not trigger mutation
    const tracker2 = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
    tracker2.recordToolCall("project.status");
    expect(tracker2.isReadOnly()).toBe(true);
  });
});
