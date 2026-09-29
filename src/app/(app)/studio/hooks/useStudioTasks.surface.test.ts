import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useStudioTasks } from "./useStudioTasks";

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: {
    userId: "user-1",
    getToken: async () => null as string | null,
    isLoaded: true,
    isSignedIn: true,
  },
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => mockAuth,
}));

const LIST_URL = "/api/studio/tasks?projectId=proj-1&includeClosed=true";

const baseTask = {
  id: "task-1",
  projectId: "proj-1",
  title: "New task",
  status: "open" as const,
  conversationId: "conv-1",
  lastOpenedSurface: "preview",
  lastOpenedAt: "2026-09-27T00:00:00Z",
  createdAt: "2026-09-27T00:00:00Z",
  updatedAt: "2026-09-27T00:00:00Z",
};

/** Tracks every PATCH body sent for the task endpoint. */
function mockFetch() {
  const patchBodies: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === LIST_URL) {
      return { ok: true, json: async () => ({ tasks: [{ ...baseTask }], closedTasks: [] }) };
    }
    if (url === "/api/studio/tasks/task-1" && init?.method === "PATCH") {
      const body = String(init.body ?? "");
      patchBodies.push(body);
      const parsed = JSON.parse(body) as { lastOpenedSurface?: string };
      return {
        ok: true,
        json: async () => ({
          task: { ...baseTask, lastOpenedSurface: parsed.lastOpenedSurface ?? baseTask.lastOpenedSurface },
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, patchBodies };
}

describe("useStudioTasks.persistSurface (Phase 3 single writer)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes lastOpenedSurface once and updates local state", async () => {
    const { patchBodies } = mockFetch();
    const { result } = renderHook(() => useStudioTasks("proj-1"));
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));

    let updated: unknown = null;
    await act(async () => {
      updated = await result.current.persistSurface("task-1", "code");
    });

    expect(patchBodies).toHaveLength(1);
    expect(JSON.parse(patchBodies[0])).toEqual({ lastOpenedSurface: "code" });
    expect((updated as { lastOpenedSurface: string }).lastOpenedSurface).toBe("code");
    expect(result.current.tasks[0].lastOpenedSurface).toBe("code");
  });

  it("is idempotent: no PATCH when the cached value already matches (oscillation breaker)", async () => {
    const { patchBodies } = mockFetch();
    const { result } = renderHook(() => useStudioTasks("proj-1"));
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));

    await act(async () => {
      await result.current.persistSurface("task-1", "code");
    });
    expect(patchBodies).toHaveLength(1);

    // Re-rendered effects / duplicate writers that agree with the stored
    // value become silent no-ops instead of competing writes.
    await act(async () => {
      await result.current.persistSurface("task-1", "code");
    });
    await act(async () => {
      await result.current.persistSurface("task-1", "code");
    });
    expect(patchBodies).toHaveLength(1);
  });

  it("activateTask routes surface writes through the single path (one PATCH for switch + persist)", async () => {
    const { patchBodies } = mockFetch();
    const { result } = renderHook(() => useStudioTasks("proj-1"));
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));

    await act(async () => {
      await result.current.activateTask("task-1", "activity");
    });
    expect(patchBodies).toHaveLength(1);
    expect(JSON.parse(patchBodies[0])).toEqual({ lastOpenedSurface: "activity" });
    expect(result.current.activeTaskId).toBe("task-1");

    // Activating again with the already-stored surface issues no PATCH.
    await act(async () => {
      await result.current.activateTask("task-1", "activity");
    });
    expect(patchBodies).toHaveLength(1);
  });

  it("returns null for an unknown task without touching the network", async () => {
    const { fetchMock } = mockFetch();
    const { result } = renderHook(() => useStudioTasks("proj-1"));
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));

    let out: unknown = "not-null";
    await act(async () => {
      out = await result.current.persistSurface("nope", "code");
    });
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/studio/tasks/nope",
      expect.anything(),
    );
  });
});
