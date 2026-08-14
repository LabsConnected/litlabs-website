import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useExecutionStore,
  feedSSEEventToExecutionStore,
} from "../stores/useExecutionStore";

/**
 * End-to-end SSE event pipeline test.
 *
 * Simulates the full sequence of events that a real LiTT task would produce,
 * feeding them through the same feedSSEEventToExecutionStore function that
 * useCanonicalConversation uses. This verifies that:
 *
 *   1. Planning → inspecting → tool execution → edits → checks → Complete
 *   2. Model routing events appear in the stream
 *   3. Reasoning/status summaries appear (not chain-of-thought)
 *   4. Tool calls are tracked with success/failure
 *   5. Checkpoints are recorded
 *   6. The final event is "finished"
 *
 * This is the closest we can get to a real end-to-end test without
 * a live Clerk session and a running workspace.
 */

describe("SSE event pipeline — full LiTT task simulation", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
    useExecutionStore.getState().startRun();
  });

  it("simulates: Planning → inspecting → tool execution → edits → checks → Complete", () => {
    const feed = feedSSEEventToExecutionStore;

    // 1. Model routing — LiTT starts reasoning with primary model
    feed({
      type: "model_routing",
      model: "google/gemini-2.5-flash",
      provider: "openrouter",
    });

    // 2. Phase: planning (step 1)
    feed({
      type: "phase",
      phase: "call_llm",
      step: 1,
    });

    // 3. Reasoning summary (NOT chain-of-thought)
    feed({
      type: "reasoning",
      summary: "Inspecting project structure to understand the codebase",
    });

    // 4. Phase: inspecting
    feed({
      type: "phase",
      phase: "inspect",
      step: 1,
    });

    // 5. Tool: inspect_project_files (start)
    feed({
      type: "tool_execution",
      toolId: "inspect_project_files",
    });

    // 6. Tool: inspect_project_files (result)
    feed({
      type: "tool_execution",
      toolId: "inspect_project_files",
      success: true,
      summary: "Found 45 files in the project",
      durationMs: 320,
    });

    // 7. Tool: read_file (start)
    feed({
      type: "tool_execution",
      toolId: "read_file",
    });

    // 8. Tool: read_file (result)
    feed({
      type: "tool_execution",
      toolId: "read_file",
      success: true,
      summary: "Read package.json",
      durationMs: 120,
    });

    // 9. Reasoning summary — LiTT forms a plan
    feed({
      type: "reasoning",
      summary: "Found the landing page component. Planning changes to Hero section.",
    });

    // 10. Phase: editing (step 2)
    feed({
      type: "phase",
      phase: "execute",
      step: 2,
    });

    // 11. Tool: edit_file (start)
    feed({
      type: "tool_execution",
      toolId: "edit_file",
    });

    // 12. Tool: edit_file (result)
    feed({
      type: "tool_execution",
      toolId: "edit_file",
      success: true,
      summary: "Edited src/app/page.tsx — updated Hero section",
      durationMs: 450,
    });

    // 13. Checkpoint
    feed({
      type: "checkpoint",
      label: "After Hero edit",
      gitSha: "abc1234567",
    });

    // 14. Phase: testing
    feed({
      type: "phase",
      phase: "build_fix",
      step: 3,
    });

    // 15. Build: typecheck (start)
    feed({
      type: "build_start",
      check: "typecheck",
    });

    // 16. Build: typecheck (result)
    feed({
      type: "build_result",
      check: "typecheck",
      passed: true,
      errorCount: 0,
    });

    // 17. Build: lint (start)
    feed({
      type: "build_start",
      check: "lint",
    });

    // 18. Build: lint (result)
    feed({
      type: "build_result",
      check: "lint",
      passed: true,
      errorCount: 0,
    });

    // 19. Finished
    feed({
      type: "finished",
      totalSteps: 3,
      totalDurationMs: 5000,
    });

    // ── Verify the full event sequence ──
    const state = useExecutionStore.getState();
    const events = state.events;

    // Should have a rich set of events
    expect(events.length).toBeGreaterThan(10);

    // Should have model_routing event
    const routingEvents = events.filter((e) => e.type === "model_routing");
    expect(routingEvents).toHaveLength(1);
    expect(routingEvents[0].model).toBe("google/gemini-2.5-flash");

    // Should have reasoning events (status summaries, not chain-of-thought)
    const reasoningEvents = events.filter((e) => e.type === "reasoning");
    expect(reasoningEvents).toHaveLength(2);
    expect(reasoningEvents[0].summary).toContain("Inspecting project structure");
    expect(reasoningEvents[1].summary).toContain("Found the landing page");

    // Should have tool events with success
    const toolStarts = events.filter((e) => e.type === "tool_start");
    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolStarts.length).toBeGreaterThanOrEqual(3); // inspect, read, edit
    expect(toolResults.length).toBeGreaterThanOrEqual(3);
    expect(toolResults.every((e) => e.success)).toBe(true);

    // Should have build events
    const buildStarts = events.filter((e) => e.type === "build_start");
    const buildResults = events.filter((e) => e.type === "build_result");
    expect(buildStarts).toHaveLength(2); // typecheck + lint
    expect(buildResults).toHaveLength(2);
    expect(buildResults.every((e) => e.success)).toBe(true);

    // Should have a checkpoint
    expect(state.checkpoint).not.toBeNull();
    expect(state.checkpoint?.gitSha).toBe("abc1234567");
    expect(state.checkpoint?.label).toBe("After Hero edit");

    // Should have a finished event
    const finishedEvents = events.filter((e) => e.type === "finished");
    expect(finishedEvents).toHaveLength(1);

    // Phase should be "done"
    expect(state.phase).toBe("done");
  });

  it("simulates: model failure → fallback → recovery", () => {
    const feed = feedSSEEventToExecutionStore;

    // Primary model fails
    feed({
      type: "model_failed",
      model: "openai/gpt-4o",
      category: "auth_error",
      message: "Invalid API key",
    });

    // Fallback model succeeds
    feed({
      type: "model_routing",
      model: "google/gemini-2.5-flash",
      provider: "openrouter",
      fallbackFrom: "openai/gpt-4o",
    });

    // LiTT continues working
    feed({
      type: "reasoning",
      summary: "Recovering after model fallback — continuing inspection",
    });

    feed({
      type: "tool_execution",
      toolId: "inspect_project_files",
    });

    feed({
      type: "tool_execution",
      toolId: "inspect_project_files",
      success: true,
      summary: "Inspected 45 files",
      durationMs: 280,
    });

    feed({
      type: "finished",
      totalSteps: 1,
      totalDurationMs: 2000,
    });

    const state = useExecutionStore.getState();
    const events = state.events;

    // Model failure should be recorded
    const failedEvents = events.filter((e) => e.type === "model_failed");
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0].model).toBe("openai/gpt-4o");
    expect(failedEvents[0].category).toBe("auth_error");

    // Fallback routing should show the fallback
    const routingEvents = events.filter((e) => e.type === "model_routing");
    expect(routingEvents).toHaveLength(1);
    expect(routingEvents[0].fallbackFrom).toBe("openai/gpt-4o");
    expect(routingEvents[0].model).toBe("google/gemini-2.5-flash");

    // Tool execution should still work after model recovery
    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].success).toBe(true);

    // Task should complete successfully despite model failure
    const finishedEvents = events.filter((e) => e.type === "finished");
    expect(finishedEvents).toHaveLength(1);
    expect(state.phase).toBe("done");
  });

  it("simulates: approval pause → Approve → resume", () => {
    const feed = feedSSEEventToExecutionStore;

    // LiTT wants to edit a file — approval required
    feed({
      type: "approval_required",
      toolId: "edit_file",
      reason: "Mutation requires approval in ACT mode",
    });

    // Verify approval is pending
    expect(useExecutionStore.getState().pendingApproval).not.toBeNull();
    expect(useExecutionStore.getState().pendingApproval?.toolId).toBe("edit_file");
    expect(useExecutionStore.getState().phase).toBe("awaiting_approval");

    // User approves — resolve approval
    useExecutionStore.getState().resolveApproval("approved");
    expect(useExecutionStore.getState().pendingApproval).toBeNull();

    // LiTT resumes — executes the edit
    feed({
      type: "tool_execution",
      toolId: "edit_file",
    });

    feed({
      type: "tool_execution",
      toolId: "edit_file",
      success: true,
      summary: "Edited src/app/page.tsx",
      durationMs: 300,
    });

    feed({
      type: "finished",
      totalSteps: 1,
      totalDurationMs: 1500,
    });

    const state = useExecutionStore.getState();
    expect(state.pendingApproval).toBeNull();
    expect(state.phase).toBe("done");

    const toolResults = state.events.filter((e) => e.type === "tool_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].success).toBe(true);
  });

  it("simulates: Stop during active tool operation", () => {
    const feed = feedSSEEventToExecutionStore;

    // Tool starts
    feed({
      type: "tool_execution",
      toolId: "edit_file",
    });

    // User clicks Stop — endRun converts in-flight tool_start to failed tool_result
    useExecutionStore.getState().endRun("cancelled");

    // Verify the run is stopped
    expect(useExecutionStore.getState().isRunning).toBe(false);
    expect(useExecutionStore.getState().phase).toBe("cancelled");

    // The tool_start should be converted to a failed tool_result (interrupted)
    const toolResults = useExecutionStore.getState().events.filter((e) => e.type === "tool_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].toolId).toBe("edit_file");
    expect(toolResults[0].success).toBe(false);
    expect(toolResults[0].summary).toContain("interrupted");

    // No pending tool_start events remain
    const toolStarts = useExecutionStore.getState().events.filter((e) => e.type === "tool_start");
    expect(toolStarts).toHaveLength(0);
  });

  it("simulates: checkpoint → rollback path", () => {
    const feed = feedSSEEventToExecutionStore;

    // LiTT creates a checkpoint before making changes
    feed({
      type: "checkpoint",
      label: "Before edits",
      gitSha: "deadbeef00",
    });

    // Verify checkpoint is stored
    expect(useExecutionStore.getState().checkpoint?.gitSha).toBe("deadbeef00");
    expect(useExecutionStore.getState().checkpoint?.label).toBe("Before edits");

    // LiTT makes an edit
    feed({
      type: "tool_execution",
      toolId: "edit_file",
    });

    feed({
      type: "tool_execution",
      toolId: "edit_file",
      success: true,
      summary: "Edited src/app/page.tsx",
      durationMs: 300,
    });

    // User clicks Rollback — in the real UI, this calls /api/studio/rollback
    // with the checkpoint SHA. Here we verify the checkpoint is available
    // for the rollback handler to use.
    const ckpt = useExecutionStore.getState().checkpoint;
    expect(ckpt).not.toBeNull();
    expect(ckpt?.gitSha).toMatch(/^[0-9a-f]{7,40}$/i);

    // The rollback API would be called with this SHA:
    // POST /api/studio/rollback { projectId, sha: ckpt.gitSha }
    // → executeProjectTool("restore_checkpoint", userId, { project_id, sha })
    // → git reset --hard <sha> in the workspace
  });
});
