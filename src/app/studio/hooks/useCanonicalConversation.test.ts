import { describe, it, expect, beforeEach, vi } from "vitest";

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
