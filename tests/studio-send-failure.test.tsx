// @vitest-environment jsdom
/**
 * Real integration tests for useCanonicalConversation send() failure paths.
 *
 * These tests render the actual hook via renderHook, mock fetch to return
 * various failure modes, call send(), and verify the store state and return
 * value. They do NOT manually replicate store operations — they exercise the
 * real hook code path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("?c=conv-test-1&a=litt"),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/studio",
}));

vi.mock("@/context/ProfileContext", () => ({
  useProfile: () => ({
    profile: { id: "test-user-id", displayName: "Test User", username: "testuser", email: "test@test.com", avatarUrl: null, bio: null },
    loading: false,
    error: null,
    refreshProfile: vi.fn(),
  }),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ userId: "test-clerk-id", isSignedIn: true, isLoaded: true }),
}));

vi.mock("@/app/studio/lib/builder-command-router", () => ({
  parseBuilderLocalCommand: vi.fn(() => null),
}));

vi.mock("@/app/studio/lib/studio-intent", () => ({
  detectIntent: vi.fn(() => ({ intent: "chat", tool: null }) as never),
}));

vi.mock("@/app/studio/hooks/useConnectionSummary", () => ({
  useConnectionSummary: () => ({ summary: { connected: false, services: {} }, refresh: vi.fn() }),
}));

vi.mock("@/app/studio/context/VoiceSessionContext", () => ({
  useVoiceSession: () => ({
    isListening: false,
    isSpeaking: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    speak: vi.fn(),
    stopSpeaking: vi.fn(),
    voiceTransportConnected: false,
    voiceInputState: "idle",
  }),
}));

vi.mock("@/app/studio/stores/useStudioAgentStore", () => ({
  useStudioAgentStore: (selector?: (s: any) => any) => {
    const state = { activeAgentId: "litt", setActiveAgent: vi.fn() };
    return selector ? selector(state) : state;
  },
  AGENT_META: {
    litt: { displayName: "LiT", slug: "litt", icon: "🧠" },
    builder: { displayName: "Builder", slug: "builder", icon: "🔨" },
  },
}));

vi.mock("@/app/studio/stores/useStudioModelStore", () => ({
  useStudioModelStore: (selector?: (s: any) => any) => {
    const state = {
      selectedModel: {
        id: "test-model", label: "Test Model", provider: "openrouter", name: "Test Model",
        model: "test-model", cost: "free" as const, speed: "fast" as const, icon: "🤖",
        category: "free" as const,
      },
      setSelectedModel: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/app/studio/components/StudioSidebar", () => ({ StudioTool: {} }));

// ─── Mock useConversationStore with a controllable test store ─────────────

import { create } from "zustand";
import type { ChatMessage } from "@/app/studio/stores/useConversationStore";

const CONV_ID = "conv-test-1";

// Use vi.hoisted so the store ref is available inside vi.mock factories
const hoistedData = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storeRef: { current: any } = { current: null };
  return { storeRef, CONV_ID: "conv-test-1" };
});

interface TestStoreState {
  conversations: any[];
  selectedConversationId: string | null;
  messagesByConversationId: Record<string, ChatMessage[]>;
  activeAgentSlug: string;
  revision: number;
  loading: boolean;
  streaming: boolean;
  sending: boolean;
  error: string | null;
  selectConversation: (id: string | null) => void;
  setMessages: (conversationId: string, messages: ChatMessage[]) => void;
  addMessage: (conversationId: string, message: ChatMessage) => void;
  updateMessage: (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  getMessages: () => ChatMessage[];
  setRevision: (revision: number) => void;
  setLoading: (loading: boolean) => void;
  setStreaming: (streaming: boolean) => void;
  setSending: (sending: boolean) => void;
  setError: (error: string | null) => void;
  setConversations: (conversations: any[]) => void;
  setActiveAgent: (slug: string) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createTestStore(): any {
  const CID = hoistedData.CONV_ID;
  return create<TestStoreState>((set, get) => ({
    conversations: [{ id: CID, activeAgentSlug: "litt", revision: 1 }],
    selectedConversationId: CID,
    messagesByConversationId: { [CID]: [] },
    activeAgentSlug: "litt",
    revision: 1,
    loading: false,
    streaming: false,
    sending: false,
    error: null,
    selectConversation: (id) => {
      const conv = get().conversations.find((c) => c.id === id);
      set({
        selectedConversationId: id,
        activeAgentSlug: conv?.activeAgentSlug ?? get().activeAgentSlug,
        revision: conv?.revision ?? 1,
      });
    },
    setMessages: (conversationId, messages) =>
      set((s) => ({
        messagesByConversationId: { ...s.messagesByConversationId, [conversationId]: messages },
      })),
    addMessage: (conversationId, message) =>
      set((s) => ({
        messagesByConversationId: {
          ...s.messagesByConversationId,
          [conversationId]: [...(s.messagesByConversationId[conversationId] ?? []), message],
        },
      })),
    updateMessage: (conversationId, messageId, patch) =>
      set((s) => ({
        messagesByConversationId: {
          ...s.messagesByConversationId,
          [conversationId]: (s.messagesByConversationId[conversationId] ?? []).map((m) =>
            m.id === messageId ? { ...m, ...patch } : m,
          ),
        },
      })),
    getMessages: () => {
      const s = get();
      return s.messagesByConversationId[s.selectedConversationId ?? ""] ?? [];
    },
    setRevision: (revision) => set({ revision }),
    setLoading: (loading) => set({ loading }),
    setStreaming: (streaming) => set({ streaming }),
    setSending: (sending) => set({ sending }),
    setError: (error) => set({ error }),
    setConversations: (conversations) => set({ conversations }),
    setActiveAgent: (slug) => set({ activeAgentSlug: slug }),
  }));
}

vi.mock("@/app/studio/stores/useConversationStore", async () => {
  const { create } = await import("zustand");
  const store = createTestStore();
  hoistedData.storeRef.current = store;
  return {
    useConversationStore: store,
    toChatMessage: (m: unknown) => m as ChatMessage,
    parseConversationFromUrl: (searchParams: URLSearchParams) => {
      const conversationId = searchParams.get("c") || null;
      const agentSlug = searchParams.get("a") || null;
      return { conversationId, agentSlug };
    },
    serializeConversationToUrl: (conversationId: string | null, agentSlug: string | null, existing: URLSearchParams) => {
      const params = new URLSearchParams(existing.toString());
      if (conversationId) params.set("c", conversationId); else params.delete("c");
      if (agentSlug) params.set("a", agentSlug); else params.delete("a");
      return params;
    },
  };
});

// ─── Import the hook AFTER all mocks are set up ───────────────────────────

import { useCanonicalConversation } from "@/app/studio/hooks/useCanonicalConversation";

// ─── Test helpers ─────────────────────────────────────────────────────────

function resetStore() {
  const store = hoistedData.storeRef.current;
  if (!store) return;
  store.setState({
    conversations: [{ id: CONV_ID, activeAgentSlug: "litt", revision: 1 }],
    selectedConversationId: CONV_ID,
    messagesByConversationId: { [CONV_ID]: [] },
    activeAgentSlug: "litt",
    revision: 1,
    loading: false,
    streaming: false,
    sending: false,
    error: null,
  });
}

function makeFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    blob: () => Promise.resolve(new Blob()),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    clone: () => makeFetchResponse(status, body),
    body: null,
    bodyUsed: false,
    type: "basic",
    url: "",
    redirected: false,
  } as Response;
}

function mockFetchForSend(sendResponse: Response | (() => Promise<Response>)): void {
  globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    const isPost = init?.method === "POST";
    // Mount-time conversation list fetch — return empty to prevent loops
    if (u.includes("/api/studio/conversations?")) {
      return makeFetchResponse(200, { conversations: [] });
    }
    // Mount-time messages GET fetch — return empty
    if (u.includes("/api/studio/conversations/") && u.includes("/messages") && !isPost) {
      return makeFetchResponse(200, { messages: [], revision: 1 });
    }
    // The actual send POST
    if (typeof sendResponse === "function") {
      return sendResponse();
    }
    return sendResponse;
  }) as never;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("useCanonicalConversation send() — real hook integration", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    resetStore();
    // Default: all fetches return empty 200
    mockFetchForSend(makeFetchResponse(200, { conversations: [], messages: [], revision: 1 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("HTTP 500: removes both optimistic messages, returns accepted=false, sets sendError", async () => {
    mockFetchForSend(makeFetchResponse(500, { error: "Internal Server Error" }));

    const { result } = renderHook(() => useCanonicalConversation());

    let sendResult: { accepted: boolean } | undefined;
    await act(async () => {
      sendResult = await result.current.send("Hello, world!");
    });

    expect(sendResult!.accepted).toBe(false);
    const messages: ChatMessage[] = hoistedData.storeRef.current.getState().getMessages();
    expect(messages.filter((m) => m.id.startsWith("optimistic_"))).toHaveLength(0);
    expect(result.current.sendError).toContain("Internal Server Error");
  });

  it("network failure (fetch rejects): removes both optimistic messages, returns accepted=false", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const isPost = init?.method === "POST";
      if (u.includes("/api/studio/conversations?")) return makeFetchResponse(200, { conversations: [] });
      if (u.includes("/messages") && !isPost) return makeFetchResponse(200, { messages: [], revision: 1 });
      throw new TypeError("Failed to fetch");
    }) as never;

    const { result } = renderHook(() => useCanonicalConversation());

    let sendResult: { accepted: boolean } | undefined;
    await act(async () => {
      sendResult = await result.current.send("Network test");
    });

    expect(sendResult!.accepted).toBe(false);
    const messages: ChatMessage[] = hoistedData.storeRef.current.getState().getMessages();
    expect(messages.filter((m) => m.id.startsWith("optimistic_"))).toHaveLength(0);
    expect(result.current.sendError).toBeTruthy();
  });

  it("AbortError/timeout: removes both optimistic messages, sets timeout sendError", async () => {
    // Use a real Error with name="AbortError" — DOMException may not extend
    // Error in all jsdom versions, but the hook checks `instanceof Error`.
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const isPost = init?.method === "POST";
      if (u.includes("/api/studio/conversations?")) return makeFetchResponse(200, { conversations: [] });
      if (u.includes("/messages") && !isPost) return makeFetchResponse(200, { messages: [], revision: 1 });
      throw abortError;
    }) as never;

    const { result } = renderHook(() => useCanonicalConversation());

    let sendResult: { accepted: boolean } | undefined;
    await act(async () => {
      sendResult = await result.current.send("Timeout test");
    });

    expect(sendResult!.accepted).toBe(false);
    const messages: ChatMessage[] = hoistedData.storeRef.current.getState().getMessages();
    expect(messages.filter((m) => m.id.startsWith("optimistic_"))).toHaveLength(0);
    expect(result.current.sendError).toContain("timed out");
  });

  it("409 conflict: reloads messages, removes optimistic, returns accepted=false", async () => {
    const serverMessages = [
      { id: "msg-0", role: "assistant", content: "Old reply from server", agentSlug: "litt", status: "completed", createdAt: new Date().toISOString(), parentMessageId: null, regenerationOfMessageId: null },
    ];
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      const isPost = init?.method === "POST";
      if (u.includes("/api/studio/conversations?")) return makeFetchResponse(200, { conversations: [] });
      if (u.includes("/messages") && !isPost) return makeFetchResponse(200, { messages: serverMessages, revision: 2 });
      return makeFetchResponse(409, { error: "Revision conflict", messages: serverMessages });
    }) as never;

    const { result } = renderHook(() => useCanonicalConversation());

    let sendResult: { accepted: boolean } | undefined;
    await act(async () => {
      sendResult = await result.current.send("Conflict test");
    });

    expect(sendResult!.accepted).toBe(false);
    const messages: ChatMessage[] = hoistedData.storeRef.current.getState().getMessages();
    expect(messages.filter((m) => m.id.startsWith("optimistic_"))).toHaveLength(0);
    expect(result.current.sendError).toContain("updated by another session");
  });

  it("successful send with empty assistant response: returns accepted=true, sets sendError", async () => {
    const successBody = {
      userMessage: { id: "real-user-1", role: "user", content: "Hello, world!", agentSlug: null, status: "completed", createdAt: new Date().toISOString(), parentMessageId: null, regenerationOfMessageId: null },
      assistantMessage: { id: "real-assistant-1", role: "assistant", content: "", agentSlug: "litt", status: "completed", createdAt: new Date().toISOString(), parentMessageId: "real-user-1", regenerationOfMessageId: null },
      revision: 2,
    };
    mockFetchForSend(makeFetchResponse(200, successBody));

    const { result } = renderHook(() => useCanonicalConversation());

    let sendResult: { accepted: boolean; reply?: string } | undefined;
    await act(async () => {
      sendResult = await result.current.send("Hello, world!");
    });

    expect(sendResult!.accepted).toBe(true);
    expect(result.current.sendError).toContain("empty response");
    const messages: ChatMessage[] = hoistedData.storeRef.current.getState().getMessages();
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].id).toBe("real-user-1");
    const assistantMsgs = messages.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].status).toBe("failed");
  });

  it("successful send with real assistant response: returns accepted=true with reply", async () => {
    const successBody = {
      userMessage: { id: "real-user-2", role: "user", content: "What is 2+2?", agentSlug: null, status: "completed", createdAt: new Date().toISOString(), parentMessageId: null, regenerationOfMessageId: null },
      assistantMessage: { id: "real-assistant-2", role: "assistant", content: "2+2 equals 4.", agentSlug: "litt", status: "completed", createdAt: new Date().toISOString(), parentMessageId: "real-user-2", regenerationOfMessageId: null },
      revision: 2,
    };
    mockFetchForSend(makeFetchResponse(200, successBody));

    const { result } = renderHook(() => useCanonicalConversation());

    let sendResult: { accepted: boolean; reply?: string } | undefined;
    await act(async () => {
      sendResult = await result.current.send("What is 2+2?");
    });

    expect(sendResult!.accepted).toBe(true);
    expect(sendResult!.reply).toBe("2+2 equals 4.");
    expect(result.current.sendError).toBeNull();
    const messages: ChatMessage[] = hoistedData.storeRef.current.getState().getMessages();
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].id).toBe("real-user-2");
    const assistantMsgs = messages.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].status).toBe("completed");
    expect(assistantMsgs[0].content).toBe("2+2 equals 4.");
  });

  it("no duplicate user message on resend after failure", async () => {
    // First send: HTTP 500
    mockFetchForSend(makeFetchResponse(500, { error: "Server error" }));

    const { result } = renderHook(() => useCanonicalConversation());

    await act(async () => {
      await result.current.send("Resend me");
    });

    let messages: ChatMessage[] = hoistedData.storeRef.current.getState().getMessages();
    expect(messages.filter((m) => m.id.startsWith("optimistic_"))).toHaveLength(0);
    expect(messages.filter((m) => m.role === "user")).toHaveLength(0);

    // Second send: success
    const successBody = {
      userMessage: { id: "real-user-3", role: "user", content: "Resend me", agentSlug: null, status: "completed", createdAt: new Date().toISOString(), parentMessageId: null, regenerationOfMessageId: null },
      assistantMessage: { id: "real-assistant-3", role: "assistant", content: "Got it!", agentSlug: "litt", status: "completed", createdAt: new Date().toISOString(), parentMessageId: "real-user-3", regenerationOfMessageId: null },
      revision: 2,
    };
    mockFetchForSend(makeFetchResponse(200, successBody));

    await act(async () => {
      await result.current.send("Resend me");
    });

    messages = hoistedData.storeRef.current.getState().getMessages();
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].id).toBe("real-user-3");
    expect(userMsgs[0].content).toBe("Resend me");
  });
});
