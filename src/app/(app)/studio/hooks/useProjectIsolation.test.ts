import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useProjectIsolation } from "./useProjectIsolation";
import {
  feedSSEEventToExecutionStore,
  useExecutionStore,
} from "../stores/useExecutionStore";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

/**
 * Phase 4 regression — project isolation.
 *
 * On project switch (A→B), project-scoped runtime state must reset so
 * project A's execution/terminal state never appears in project B.
 * User-global preferences (settings store) must survive the switch.
 */
describe("useProjectIsolation", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
    useTerminalStore.getState().reset();
    useSettingsStore.getState().setActiveSection("overview");
  });

  function seedProjectAState() {
    const exec = useExecutionStore.getState();
    exec.setActiveTaskId("task-a");
    exec.setTaskPhase("task-a", "running");
    exec.startRun();
    feedSSEEventToExecutionStore({ type: "status", summary: "building homepage" });
    exec.setPendingApproval({
      toolId: "tool-a",
      reason: "needs approval",
      pausedRunId: "run-a",
    });

    useTerminalStore.getState().setVerifiedSession({
      sessionId: "pty-a",
      cwd: "/workspaces/project-a",
      shell: "/bin/bash",
      workspaceId: "ws-a",
      projectId: "proj-a",
    });

    useSettingsStore.getState().setActiveSection("billing");
  }

  it("resets execution + terminal state on project switch, keeps user globals", () => {
    seedProjectAState();
    // startRun + one SSE status event + the approval-requested event.
    expect(useExecutionStore.getState().events).toHaveLength(2);
    expect(useTerminalStore.getState().sessionId).toBe("pty-a");

    const { rerender } = renderHook(({ projectId }) => useProjectIsolation(projectId), {
      initialProps: { projectId: "proj-a" as string | null },
    });

    act(() => {
      rerender({ projectId: "proj-b" });
    });

    const exec = useExecutionStore.getState();
    expect(exec.events).toHaveLength(0);
    expect(exec.phase).toBe("idle");
    expect(exec.isRunning).toBe(false);
    expect(exec.pendingApproval).toBeNull();
    expect(exec.activeTaskId).toBeNull();
    expect(exec.taskPhases).toEqual({});
    expect(exec.taskConversationIndex).toEqual({});

    const term = useTerminalStore.getState();
    expect(term.sessionId).toBeNull();
    expect(term.cwd).toBeNull();
    expect(term.projectId).toBeNull();
    expect(term.status).toBe("disconnected");

    // User-global preferences are NOT project-scoped — they survive.
    expect(useSettingsStore.getState().activeSection).toBe("billing");
  });

  it("does not reset when the project id is unchanged", () => {
    const { rerender } = renderHook(({ projectId }) => useProjectIsolation(projectId), {
      initialProps: { projectId: "proj-a" as string | null },
    });
    seedProjectAState();

    act(() => {
      rerender({ projectId: "proj-a" });
    });

    expect(useExecutionStore.getState().events).toHaveLength(2);
    expect(useTerminalStore.getState().sessionId).toBe("pty-a");
  });

  it("project B starts clean: seeded project-A state is invisible after the switch", () => {
    seedProjectAState();
    const { rerender } = renderHook(({ projectId }) => useProjectIsolation(projectId), {
      initialProps: { projectId: "proj-a" as string | null },
    });
    act(() => {
      rerender({ projectId: "proj-b" });
    });

    // Simulate project B doing its own work — it must not see A's leftovers.
    const exec = useExecutionStore.getState();
    exec.setActiveTaskId("task-b");
    feedSSEEventToExecutionStore({ type: "status", summary: "project b work" });

    expect(exec.eventsForTask("task-b").map((e) => e.summary)).toEqual(["project b work"]);
    expect(exec.eventsForTask("task-a")).toHaveLength(0);
    expect(exec.phaseForTask("task-a")).toBe("idle");
  });
});
