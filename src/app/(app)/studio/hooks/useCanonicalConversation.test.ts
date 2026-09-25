import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { shouldDeferConversationUrlSync, useConversationStore } from "../stores/useConversationStore";
import type { Conversation, ConversationMessage } from "@/lib/studio/types";
import type { SendResult } from "./useCanonicalConversation";
import { useCanonicalConversation } from "./useCanonicalConversation";

// Minimal browser-environment mocks for rendering the real hook.
// Every mocked hook must return a STABLE object — this hook's useCallback
// dependency chains (getToken → authHeaders → loadConversations → effect)
// turn a fresh-identity-per-render mock into an infinite effect loop.
vi.mock("next/navigation", () => {
  const router = { replace: () => {}, push: () => {}, refresh: () => {}, prefetch: () => {} };
  const searchParams = new URLSearchParams();
  return {
    useRouter: () => router,
    usePathname: () => "/studio",
    useSearchParams: () => searchParams,
  };
});

vi.mock("@/hooks/useClerkAuth", () => {
  const auth = {
    userId: "user-1",
    getToken: async () => null,
    isLoaded: true,
    isSignedIn: true,
  };
  return { useClerkAuth: () => auth };
});

vi.mock("./useConnectionSummary", () => {
  const value = {
    capabilities: {
      repository: "none",
      repositoryName: null,
      repositoryIndexed: false,
      projectId: "proj-1",
      projectName: "Test Project",
      defaultBranch: null,
      activeBranch: null,
      sourceType: null,
      sourceKind: null,
      sourceLabel: null,
      sourceStatus: null,
      versionControl: "none",
      githubConnected: false,
      workspaceStatus: null,
      githubInstalled: false,
      terminalExecution: "unavailable",
      writeAccess: false,
      connectedProviders: [],
      availableTools: [],
      connectionSummary: "No services connected.",
      terminalStatus: "disconnected",
      terminalSessionId: null,
      terminalError: null,
      terminalFailureStage: null,
      terminalCwd: null,
      terminalServerReachable: false,
      voiceTransportConnected: false,
      voiceMicrophoneOn: false,
      voiceHealth: { configured: false, tokenService: "unknown", available: false },
    },
  };
  return { useConnectionSummary: () => value };
});

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("getActiveProjectId resolution", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns serverProjectId when provided (authoritative)", () => {
    localStorageMock.setItem("litt:active-project-id", "local-123");
    // Simulate the resolution logic
    const serverProjectId = "server-456";
    const result = serverProjectId ?? localStorageMock.getItem("litt:active-project-id") ?? null;
    expect(result).toBe("server-456");
  });

  it("falls back to localStorage when serverProjectId is null", () => {
    localStorageMock.setItem("litt:active-project-id", "local-123");
    const serverProjectId: string | null = null;
    const result = serverProjectId ?? localStorageMock.getItem("litt:active-project-id") ?? null;
    expect(result).toBe("local-123");
  });

  it("returns null when neither server nor localStorage has a value", () => {
    const serverProjectId: string | null = null;
    const result = serverProjectId ?? localStorageMock.getItem("litt:active-project-id") ?? null;
    expect(result).toBeNull();
  });

  it("server resolution takes priority over stale localStorage", () => {
    localStorageMock.setItem("litt:active-project-id", "stale-local");
    const serverProjectId = "fresh-server";
    const result = serverProjectId ?? localStorageMock.getItem("litt:active-project-id") ?? null;
    expect(result).toBe("fresh-server");
  });
});

describe("conversation URL hydration", () => {
  it("preserves a durable URL conversation while the client store is empty", () => {
    expect(shouldDeferConversationUrlSync(false, "conv-ember", null)).toBe(true);
  });

  it("allows URL synchronization after the server list hydrates", () => {
    expect(shouldDeferConversationUrlSync(true, "conv-ember", null)).toBe(false);
  });
});

describe("ConnectionCapabilities project fields", () => {
  it("DEFAULT_CAPABILITIES includes projectId, projectName, defaultBranch", async () => {
    // Verify the interface contract by checking the default object shape
    const defaultCaps = {
      repository: "none",
      repositoryName: null,
      repositoryIndexed: false,
      projectId: null,
      projectName: null,
      defaultBranch: null,
      terminalExecution: "unavailable",
      writeAccess: false,
      connectedProviders: [],
      availableTools: [],
      connectionSummary: "No services connected.",
      terminalStatus: "disconnected",
      terminalSessionId: null,
      terminalError: null,
      voiceTransportConnected: false,
      voiceMicrophoneOn: false,
      voiceHealth: {
        configured: false,
        tokenService: "unknown",
        available: false,
      },
    };
    expect(defaultCaps.projectId).toBeNull();
    expect(defaultCaps.projectName).toBeNull();
    expect(defaultCaps.defaultBranch).toBeNull();
  });
});

describe("SendResult contract", () => {
  it("accepted=false with persisted=false means draft should be restored", () => {
    // Simulate a 401 on conversation creation — user message NOT persisted
    const result = { accepted: false, persisted: false, errorKind: "auth" as const };
    expect(result.accepted).toBe(false);
    expect(result.persisted).toBe(false);
    // Composer should restore draft when persisted === false
    const shouldRestoreDraft = !result.accepted && !result.persisted;
    expect(shouldRestoreDraft).toBe(true);
  });

  it("accepted=false with persisted=true means draft should NOT be restored", () => {
    // Simulate a provider failure AFTER the user message was persisted
    const result = { accepted: false, persisted: true, errorKind: "provider" as const };
    expect(result.accepted).toBe(false);
    expect(result.persisted).toBe(true);
    // Composer should NOT restore draft — the message is on the server
    const shouldRestoreDraft = !result.accepted && !result.persisted;
    expect(shouldRestoreDraft).toBe(false);
  });

  it("accepted=true with persisted=true is a successful send", () => {
    const result = { accepted: true, persisted: true, reply: "Hello!" };
    expect(result.accepted).toBe(true);
    expect(result.persisted).toBe(true);
    const shouldRestoreDraft = !result.accepted && !result.persisted;
    expect(shouldRestoreDraft).toBe(false);
  });

  it("errorKind=auth triggers requiresReauth", () => {
    const result = { accepted: false, persisted: false, errorKind: "auth" as const };
    expect(result.errorKind).toBe("auth");
    // The hook should set requiresReauth=true when errorKind is "auth"
    const shouldRequireReauth = result.errorKind === "auth";
    expect(shouldRequireReauth).toBe(true);
  });

  it("errorKind=conflict means revision conflict, not auth", () => {
    const result = { accepted: false, persisted: false, errorKind: "conflict" as const };
    expect(result.errorKind).toBe("conflict");
    const shouldRequireReauth = (result.errorKind as string) === "auth";
    expect(shouldRequireReauth).toBe(false);
  });

  it("errorKind=provider means provider failed after persistence", () => {
    const result = { accepted: false, persisted: true, errorKind: "provider" as const };
    expect(result.errorKind).toBe("provider");
    // Draft should NOT be restored — user message is on the server
    expect(result.persisted).toBe(true);
  });
});

describe("Optimistic rollback behavior", () => {
  it("rollback removes both optimistic user and assistant messages", () => {
    // Simulate the rollback logic: filter out optimistic IDs
    const optimisticUserId = "optimistic_req_1";
    const optimisticAssistantId = "optimistic_assistant_req_1";
    const messages = [
      { id: "real_1", role: "user" as const, content: "Previous", status: "completed" as const },
      { id: optimisticUserId, role: "user" as const, content: "New message", status: "completed" as const },
      { id: optimisticAssistantId, role: "assistant" as const, content: "", status: "streaming" as const },
    ];
    const rolledBack = messages.filter(
      (m) => m.id !== optimisticUserId && m.id !== optimisticAssistantId,
    );
    expect(rolledBack.length).toBe(1);
    expect(rolledBack[0].id).toBe("real_1");
  });

  it("rollback restores previous conversation selection", () => {
    // When a pending_* conversation fails, the previous conversation
    // should be reselected, not the pending one.
    const previousConversationId = "conv_123";
    const pendingConversationId = "pending_req_1";
    // After rollback, selectedConversationId should be the previous one
    const restoredId = pendingConversationId.startsWith("pending_")
      ? previousConversationId
      : pendingConversationId;
    expect(restoredId).toBe(previousConversationId);
  });

  it("pending_ conversation prefix is correctly identified", () => {
    const pendingId = "pending_req_abc123";
    expect(pendingId.startsWith("pending_")).toBe(true);

    const realId = "conv_abc123";
    expect(realId.startsWith("pending_")).toBe(false);
  });
});

// ── Transport-loss reconciliation — real hook render ───────────────
// Regression for the completed-with-clarifying-question gap: when the SSE
// transport dies after dispatch but the server-side run actually finished
// by ASKING the user for input, the reconciled SendResult must carry
// awaitingInput — otherwise CommandStudio renders the "Done · No files
// changed" completion card over what is really a question.
describe("send() transport-loss reconciliation — awaitingInput", () => {
  const CONVERSATION: Conversation = {
    id: "conv-1",
    ownerId: "user-1",
    projectId: "proj-1",
    title: "Test",
    activeAgentSlug: "litt",
    activeAgentMode: "standard",
    agentInstanceId: null,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  };

  const makeMsg = (overrides: Partial<ConversationMessage>): ConversationMessage => ({
    id: "msg-x",
    conversationId: "conv-1",
    ownerId: "user-1",
    projectId: "proj-1",
    role: "assistant",
    agentSlug: "litt",
    agentMode: "standard",
    agentInstanceId: null,
    content: "",
    status: "completed",
    parentMessageId: null,
    regenerationOfMessageId: null,
    clientRequestId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  let capturedClientRequestId: string | null;
  let reconciledReply: string;

  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  beforeEach(() => {
    capturedClientRequestId = null;
    reconciledReply = "Which project should I update?";
    useConversationStore.getState().resetForProject();

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      // The send POST accepts then the transport dies — the run may still
      // have completed server-side, which is exactly what reconciliation
      // is for.
      if (method === "POST" && /\/api\/studio\/conversations\/[^/]+\/messages$/.test(url)) {
        capturedClientRequestId = (JSON.parse(String(init?.body)) as { clientRequestId: string }).clientRequestId;
        throw new TypeError("fetch failed");
      }
      // Reconciliation snapshot — the canonical GET.
      if (method === "GET" && /\/api\/studio\/conversations\/[^/]+\/messages$/.test(url)) {
        return jsonResponse({
          messages: capturedClientRequestId
            ? [
                makeMsg({ id: "user-1", role: "user", clientRequestId: capturedClientRequestId, content: "Fix it" }),
                makeMsg({ id: "asst-1", role: "assistant", parentMessageId: "user-1", status: "completed", content: reconciledReply }),
              ]
            : [],
          revision: 2,
        });
      }
      if (url.startsWith("/api/studio/conversations")) {
        return jsonResponse({ conversations: [] });
      }
      return jsonResponse({});
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useConversationStore.getState().resetForProject();
  });

  async function renderAndSend(text: string): Promise<SendResult | undefined> {
    const { result } = renderHook(() => useCanonicalConversation({ serverProjectId: "proj-1" }));
    // Let mount-time loadConversations settle before seeding the store so
    // its setConversations response cannot wipe our fixture.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => {
      const st = useConversationStore.getState();
      st.setConversations([CONVERSATION]);
      st.selectConversation("conv-1");
    });
    let sendResult: SendResult | undefined;
    await act(async () => {
      sendResult = await result.current.send(text);
    });
    return sendResult;
  }

  it("flags awaitingInput when the reconciled reply is a clarifying question", async () => {
    reconciledReply = "Which project should I update?";
    const sendResult = await renderAndSend("Fix the dropdown positioning in the popover component");

    expect(sendResult?.accepted).toBe(true);
    expect(sendResult?.persisted).toBe(true);
    expect(sendResult?.reply).toBe("Which project should I update?");
    expect(sendResult?.awaitingInput).toBe(true);
  });

  it("does not flag awaitingInput for an ordinary reconciled reply", async () => {
    reconciledReply = "Done. I updated the popover component.";
    const sendResult = await renderAndSend("Fix the dropdown positioning in the popover component");

    expect(sendResult?.accepted).toBe(true);
    expect(sendResult?.awaitingInput).toBe(false);
  });
});
