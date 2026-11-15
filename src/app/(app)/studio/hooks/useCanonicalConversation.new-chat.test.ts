import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConversationStore } from "../stores/useConversationStore";
import type { Conversation, ConversationMessage } from "@/lib/studio/types";
import { useCanonicalConversation } from "./useCanonicalConversation";

/**
 * Regression — the dead "+ New Chat" button (live proof 2026-11-15).
 *
 * Two defects made the board chat panel's New Chat button a no-op:
 *
 * 1. Restore-overwrite: both restore paths (the sync-from-URL effect and
 *    loadConversations) re-applied the URL conversation whenever they
 *    re-ran — and their callback identities hang off authHeaders →
 *    getToken, so a Clerk identity churn re-runs them. router.replace
 *    commits asynchronously, so right after a New Chat click the store
 *    holds the new conversation while the URL still names the old one;
 *    a restore re-run in that window reselected the old conversation,
 *    after which syncUrl saw selection == URL and never wrote the new
 *    id. Net effect: click did nothing, URL unchanged.
 *
 * 2. Server reuse: a bare create POST returns an existing empty,
 *    untitled conversation — including the one already selected — so an
 *    explicit New Chat must tell the server to mint a fresh one
 *    (forceNew). Implicit creation (first send) keeps the reuse.
 */

const navState = vi.hoisted(() => ({
  searchParams: new URLSearchParams("conversation=conv-old"),
  replaceCalls: [] as string[],
}));

const authHolder = vi.hoisted(() => ({
  current: {
    userId: "user-1" as string | null,
    getToken: async () => "token-1",
    isLoaded: true,
    isSignedIn: true,
  },
}));

vi.mock("next/navigation", () => {
  const router = {
    // Records the replace but does NOT mutate searchParams — the App
    // Router commit is asynchronous, which is exactly the window in
    // which the restore paths used to clobber the new selection.
    replace: (url: string) => { navState.replaceCalls.push(url); },
    push: () => {},
    refresh: () => {},
    prefetch: () => {},
  };
  return {
    useRouter: () => router,
    usePathname: () => "/studio",
    useSearchParams: () => navState.searchParams,
  };
});

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => authHolder.current,
}));

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

const OLD: Conversation = {
  id: "conv-old",
  ownerId: "user-1",
  projectId: "proj-1",
  title: "Old chat",
  activeAgentSlug: "litt",
  activeAgentMode: "standard",
  agentInstanceId: null,
  revision: 1,
  createdAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-14T00:00:00.000Z",
  archivedAt: null,
};

const FRESH: Conversation = {
  ...OLD,
  id: "conv-fresh",
  title: null,
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
};

function makeMsg(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: "msg-x",
    conversationId: "conv-old",
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
    createdAt: "2026-11-14T00:00:00.000Z",
    updatedAt: "2026-11-14T00:00:00.000Z",
    ...overrides,
  };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("New Chat (board chat panel) — restore-overwrite regression", () => {
  let serverConversations: Conversation[];
  let postBodies: Array<Record<string, unknown>>;

  beforeEach(() => {
    serverConversations = [OLD];
    postBodies = [];
    navState.replaceCalls = [];
    navState.searchParams = new URLSearchParams("conversation=conv-old");
    authHolder.current = {
      userId: "user-1",
      getToken: async () => "token-1",
      isLoaded: true,
      isSignedIn: true,
    };
    useConversationStore.getState().resetForProject();

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (method === "GET" && /\/api\/studio\/conversations\/[^/]+\/messages$/.test(url)) {
        const messages = url.includes("conv-old")
          ? [
              makeMsg({ id: "u-1", role: "user", content: "Earlier work" }),
              makeMsg({ id: "a-1", role: "assistant", content: "Done", parentMessageId: "u-1" }),
            ]
          : [];
        return jsonResponse({ messages, revision: 1 });
      }
      if (method === "POST" && /\/api\/studio\/conversations$/.test(url.split("?")[0])) {
        postBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        serverConversations = [FRESH, OLD];
        return jsonResponse({ conversation: FRESH, projectId: "proj-1" }, 201);
      }
      if (method === "GET" && url.startsWith("/api/studio/conversations")) {
        return jsonResponse({ conversations: serverConversations });
      }
      return jsonResponse({});
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useConversationStore.getState().resetForProject();
  });

  async function settle() {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  it("keeps the new conversation selected when the restore paths re-run against the stale URL", async () => {
    const { result, rerender } = renderHook(() =>
      useCanonicalConversation({ serverProjectId: "proj-1" }),
    );
    await settle();
    // Initial load restored the URL conversation.
    expect(useConversationStore.getState().selectedConversationId).toBe("conv-old");

    // The "+ New Chat" click.
    await act(async () => {
      await result.current.createConversation({ forceNew: true });
    });
    expect(useConversationStore.getState().selectedConversationId).toBe("conv-fresh");
    // The URL sync did its part — the new id was written toward the URL.
    expect(navState.replaceCalls.some((u) => u.includes("conversation=conv-fresh"))).toBe(true);

    // The race: Clerk hands back a new getToken identity (token refresh /
    // session touch), which re-runs loadConversations and the
    // sync-from-URL effect while the committed URL still names conv-old
    // (router.replace has not landed as a searchParams prop yet).
    authHolder.current = {
      userId: "user-1",
      getToken: async () => "token-2",
      isLoaded: true,
      isSignedIn: true,
    };
    rerender();
    await settle();

    // The new conversation must survive — the old one must not resurrect.
    expect(useConversationStore.getState().selectedConversationId).toBe("conv-fresh");
    // The old conversation is untouched and still listed (reachable from
    // Recents), with its messages intact.
    const state = useConversationStore.getState();
    expect(state.conversations.map((c) => c.id)).toContain("conv-old");
    expect(state.messagesByConversationId["conv-old"]?.length).toBe(2);
    expect(state.messagesByConversationId["conv-fresh"]).toEqual([]);
  });

  it("an explicit New Chat asks the server for a fresh conversation (forceNew); an implicit create does not", async () => {
    navState.searchParams = new URLSearchParams();
    const { result } = renderHook(() =>
      useCanonicalConversation({ serverProjectId: "proj-1" }),
    );
    await settle();
    // Bare load restores the most recent conversation (designed resume).
    expect(useConversationStore.getState().selectedConversationId).toBe("conv-old");

    await act(async () => {
      await result.current.createConversation({ forceNew: true });
    });
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0].forceNew).toBe(true);
    expect(useConversationStore.getState().selectedConversationId).toBe("conv-fresh");

    // The implicit path (first send with no conversation) must NOT force
    // a fresh record — the server's empty-conversation reuse still
    // applies there.
    await act(async () => {
      await result.current.createConversation();
    });
    expect(postBodies).toHaveLength(2);
    expect(postBodies[1].forceNew).toBeUndefined();
  });
});
