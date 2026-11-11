import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useStudioTasks,
  clearStudioTaskAssociationCache,
  TASK_ASSOCIATION_UNAVAILABLE_MESSAGE,
} from "./useStudioTasks";

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

describe("useStudioTasks.createTask", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not POST when conversationId is an optimistic pending_* id", async () => {
    // Optimistic send placeholders are client-only — the server has no
    // conversation row to bind, so the request was a guaranteed 403.
    const fetchMock = mockFetch((url) => {
      if (url === LIST_URL) return { tasks: [], closedTasks: [] };
      return {};
    });
    const { result } = renderHook(() => useStudioTasks("proj-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let created: unknown = "not-null";
    await act(async () => {
      created = await result.current.createTask({
        title: "Adopted task",
        taskType: "general",
        conversationId: "pending_req_123_abc",
      });
    });

    expect(created).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/studio/tasks",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("POSTs normally for a canonical conversation id", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === LIST_URL) return { tasks: [], closedTasks: [] };
      if (url === "/api/studio/tasks" && init?.method === "POST") {
        return { task: { ...baseTask, conversationId: "conv-real-1" } };
      }
      return {};
    });
    const { result } = renderHook(() => useStudioTasks("proj-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let created: unknown = null;
    await act(async () => {
      created = await result.current.createTask({
        title: "Adopted task",
        taskType: "general",
        conversationId: "conv-real-1",
      });
    });

    expect(created).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/studio/tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectId: "proj-1",
          title: "Adopted task",
          taskType: "general",
          conversationId: "conv-real-1",
        }),
      }),
    );
  });
});

describe("useStudioTasks.createTask — association 403 handling", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    clearStudioTaskAssociationCache();
  });

  function mockStatusFetch(post: { status: number; body: unknown }) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/studio/tasks") {
        return { ok: post.status < 300, status: post.status, json: async () => post.body };
      }
      return { ok: true, status: 200, json: async () => ({ tasks: [], closedTasks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function postCalls(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/studio/tasks" && (init as RequestInit)?.method === "POST",
    );
  }

  it("treats the association 403 as handled: quiet, and never re-POSTs for the same pair", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = mockStatusFetch({
      status: 403,
      body: { error: TASK_ASSOCIATION_UNAVAILABLE_MESSAGE },
    });
    const { result } = renderHook(() => useStudioTasks("proj-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let first: unknown = "unset";
    await act(async () => {
      first = await result.current.createTask({ title: "Adopt", taskType: "general", conversationId: "conv-foreign" });
    });
    expect(first).toBeNull();
    expect(postCalls(fetchMock)).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();

    // The adoption effect re-running (remount/round-trip) must not
    // re-issue the doomed POST.
    let second: unknown = "unset";
    await act(async () => {
      second = await result.current.createTask({ title: "Adopt", taskType: "general", conversationId: "conv-foreign" });
    });
    expect(second).toBeNull();
    expect(postCalls(fetchMock)).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it("does NOT cache other failures: a 500 is surfaced and a later call retries", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = mockStatusFetch({ status: 500, body: { error: "database unavailable" } });
    const { result } = renderHook(() => useStudioTasks("proj-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createTask({ title: "Adopt", taskType: "general", conversationId: "conv-x" });
    });
    expect(errorSpy).toHaveBeenCalled();

    await act(async () => {
      await result.current.createTask({ title: "Adopt", taskType: "general", conversationId: "conv-x" });
    });
    expect(postCalls(fetchMock)).toHaveLength(2);
    errorSpy.mockRestore();
  });

  it("a 403 with a different message is a real failure, not the association verdict", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = mockStatusFetch({ status: 403, body: { error: "Forbidden" } });
    const { result } = renderHook(() => useStudioTasks("proj-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createTask({ title: "Adopt", taskType: "general", conversationId: "conv-y" });
    });
    await act(async () => {
      await result.current.createTask({ title: "Adopt", taskType: "general", conversationId: "conv-y" });
    });
    expect(postCalls(fetchMock)).toHaveLength(2);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
