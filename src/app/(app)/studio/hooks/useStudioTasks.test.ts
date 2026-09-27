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
  lastOpenedSurface: "studio",
  createdAt: "2026-09-27T00:00:00Z",
  updatedAt: "2026-09-27T00:00:00Z",
};

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => handler(url, init),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useStudioTasks.renameTask", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes the title and updates local state", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === LIST_URL) {
        return { tasks: [baseTask], closedTasks: [] };
      }
      if (url === "/api/studio/tasks/task-1" && init?.method === "PATCH") {
        return { task: { ...baseTask, title: "Homepage hero refresh" } };
      }
      return {};
    });

    const { result } = renderHook(() => useStudioTasks("proj-1"));
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));

    let renamed: unknown = null;
    await act(async () => {
      renamed = await result.current.renameTask("task-1", "Homepage hero refresh");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/studio/tasks/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Homepage hero refresh" }),
      }),
    );
    expect((renamed as { title: string }).title).toBe("Homepage hero refresh");
    expect(result.current.tasks[0].title).toBe("Homepage hero refresh");
  });

  it("rejects empty titles without calling the API", async () => {
    const fetchMock = mockFetch((url) => {
      if (url === LIST_URL) return { tasks: [baseTask], closedTasks: [] };
      return {};
    });
    const { result } = renderHook(() => useStudioTasks("proj-1"));
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));

    let renamed: unknown = "not-null";
    await act(async () => {
      renamed = await result.current.renameTask("task-1", "   ");
    });

    expect(renamed).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/studio/tasks/task-1",
      expect.anything(),
    );
  });
});
