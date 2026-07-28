import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStudioConversations } from "./useStudioConversations";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
vi.stubGlobal("localStorage", localStorageMock);

// Mock crypto.randomUUID
vi.stubGlobal("crypto", {
  randomUUID: vi.fn(() => `uuid-${Math.random().toString(36).slice(2)}`),
});

function waitForHydration() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useStudioConversations — Phase 2.2 session behavior", () => {
  beforeEach(() => {
    localStorageMock.clear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ sessions: [] }) });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 1. New chat creates a genuinely empty conversation
  it("creates a genuinely empty conversation on new", async () => {
    const { result } = renderHook(() => useStudioConversations());
    await waitForHydration();
    const initialCount = result.current.conversations.length;
    act(() => { result.current.create(); });
    expect(result.current.conversations.length).toBe(initialCount + 1);
    expect(result.current.activeConversation?.messages).toEqual([]);
    expect(result.current.activeConversation?.title).toBe("New chat");
  });

  // 2. Rename updates the active conversation
  it("renames the active conversation", async () => {
    const { result } = renderHook(() => useStudioConversations());
    await waitForHydration();
    const id = result.current.activeId;
    act(() => { result.current.rename(id, "My Project"); });
    expect(result.current.activeConversation?.title).toBe("My Project");
  });

  // 3. Delete removes the correct conversation
  it("deletes the correct conversation", async () => {
    const { result } = renderHook(() => useStudioConversations());
    await waitForHydration();
    const firstId = result.current.activeId;
    act(() => { result.current.create(); });
    const secondId = result.current.activeId;
    act(() => { result.current.remove(firstId); });
    expect(result.current.conversations.find((c) => c.id === firstId)).toBeUndefined();
    expect(result.current.activeId).toBe(secondId);
  });

  // 4. Duplicate copies messages but clears terminal-session associations
  it("duplicate copies messages but clears terminal sessions", async () => {
    const { result } = renderHook(() => useStudioConversations());
    await waitForHydration();
    const id = result.current.activeId;
    // Add a message and terminal session
    act(() => {
      result.current.setMessages([{ id: "m1", role: "user", content: "test", status: "complete", createdAt: Date.now() }]);
      result.current.updateTerminalSessions({ terminalSessionIds: ["pty-1"], activeTerminalSessionId: "pty-1" });
    });
    // Duplicate
    act(() => { result.current.create(result.current.activeConversation); });
    const dup = result.current.activeConversation;
    expect(dup).toBeTruthy();
    expect(dup?.messages).toHaveLength(1);
    expect(dup?.messages[0].content).toBe("test");
    // Terminal sessions should be cleared
    expect(dup?.terminalSessionIds).toEqual([]);
    expect(dup?.activeTerminalSessionId).toBeNull();
  });

  // 5. LiTT/Spark selection is stored with the conversation
  it("stores selected agent with the conversation", async () => {
    const { result } = renderHook(() => useStudioConversations());
    await waitForHydration();
    expect(result.current.selectedAgentId).toBe("litt");
    act(() => { result.current.setSelectedAgent("spark"); });
    expect(result.current.selectedAgentId).toBe("spark");
    expect(result.current.activeConversation?.selectedAgentId).toBe("spark");
  });

  // 6. Switching agents preserves transcript
  it("switching agents preserves the transcript", async () => {
    const { result } = renderHook(() => useStudioConversations());
    await waitForHydration();
    act(() => {
      result.current.setMessages([{ id: "m1", role: "user", content: "hello", status: "complete", createdAt: Date.now() }]);
    });
    act(() => { result.current.setSelectedAgent("spark"); });
    // Messages should still be there
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe("hello");
  });

  // 7. Delete all clears all conversations
  it("deleteAll removes all conversations and creates a fresh one", async () => {
    const { result } = renderHook(() => useStudioConversations());
    await waitForHydration();
    act(() => {
      result.current.create();
      result.current.create();
    });
    expect(result.current.conversations.length).toBeGreaterThan(1);
    act(() => { result.current.removeAll(); });
    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.activeConversation?.messages).toEqual([]);
  });

  // 8. Toggle pin
  it("toggles pin on a conversation", async () => {
    const { result } = renderHook(() => useStudioConversations());
    await waitForHydration();
    const id = result.current.activeId;
    expect(result.current.activeConversation?.pinned).toBe(false);
    act(() => { result.current.togglePin(id); });
    expect(result.current.activeConversation?.pinned).toBe(true);
  });

  // 9. setMessages with updater function
  it("setMessages accepts an updater function", async () => {
    const { result } = renderHook(() => useStudioConversations());
    await waitForHydration();
    act(() => {
      result.current.setMessages((prev) => [...prev, { id: "m1", role: "user", content: "hi", status: "complete", createdAt: Date.now() }]);
    });
    expect(result.current.messages).toHaveLength(1);
    act(() => {
      result.current.setMessages((prev) => [...prev, { id: "m2", role: "assistant", content: "hello", status: "complete", createdAt: Date.now() }]);
    });
    expect(result.current.messages).toHaveLength(2);
  });

  // 10. updateProject patches project context
  it("updateProject patches the project context", async () => {
    const { result } = renderHook(() => useStudioConversations());
    await waitForHydration();
    act(() => {
      result.current.updateProject({ projectId: "proj-1", repositoryName: "my-repo", branch: "main" });
    });
    expect(result.current.activeConversation?.project.projectId).toBe("proj-1");
    expect(result.current.activeConversation?.project.repositoryName).toBe("my-repo");
    expect(result.current.activeConversation?.project.branch).toBe("main");
  });
});
