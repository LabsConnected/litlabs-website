import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to create mocks that can be referenced in vi.mock factories
const { mockRpc, mockSingle, mockThen, makeChain } = vi.hoisted(() => {
  const mockRpc = vi.fn();
  const mockSingle = vi.fn();
  const mockThen = vi.fn();

  function makeChain() {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      single: vi.fn(() => mockSingle()),
      limit: vi.fn(() => chain),
      order: vi.fn(() => chain),
      is: vi.fn(() => chain),
      filter: vi.fn(() => chain),
      rpc: vi.fn(() => mockRpc()),
      then: vi.fn((cb: (value: unknown) => unknown) => mockThen(cb)),
    };
    return chain;
  }

  return { mockRpc, mockSingle, mockThen, makeChain };
});

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeChain()),
    rpc: mockRpc,
  },
  getSupabaseAdmin: () => ({
    from: vi.fn(() => makeChain()),
    rpc: mockRpc,
  }),
}));

vi.mock("../project-resolver", () => ({
  resolveProject: vi.fn(),
  buildStudioContext: vi.fn(),
  buildProjectContextBlock: vi.fn(() => ""),
}));

import { createConversation, insertMessage, getConversation, listConversations } from "../conversation-service";
import { resolveProject } from "../project-resolver";

describe("conversation-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createConversation", () => {
    it("returns null when user does not own the project", async () => {
      vi.mocked(resolveProject).mockResolvedValue(null);

      const result = await createConversation("user_a", "proj_1", "Test", "litt");
      expect(result).toBeNull();
      expect(resolveProject).toHaveBeenCalledWith("user_a", "proj_1");
    });

    it("creates conversation when user owns the project", async () => {
      vi.mocked(resolveProject).mockResolvedValue({
        projectId: "proj_1",
        projectName: "Test",
        projectDescription: null,
        repositoryProvider: null,
        repositoryOwner: null,
        repositoryName: null,
        repositoryDefaultBranch: null,
        activeBranch: null,
        framework: null,
        scanStatus: "idle",
        scanSummary: null,
        capabilities: {
          repositoryConnected: false,
          repositoryName: null,
          terminalConnected: false,
          availableTools: [],
          connectionSummary: "No services connected.",
        },
      });

      const mockData = {
        id: "conv_1",
        owner_id: "user_a",
        project_id: "proj_1",
        title: "Test",
        active_agent_slug: "litt",
        revision: 1,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        archived_at: null,
      };
      mockSingle.mockResolvedValue({ data: mockData, error: null });

      const result = await createConversation("user_a", "proj_1", "Test", "litt");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("conv_1");
      expect(result?.ownerId).toBe("user_a");
      expect(result?.revision).toBe(1);
    });
  });

  describe("getConversation — ownership scoping", () => {
    it("returns null when conversation belongs to another user", async () => {
      mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });

      const result = await getConversation("conv_1", "user_a");
      expect(result).toBeNull();
    });

    it("returns conversation when owned by the user", async () => {
      const mockData = {
        id: "conv_1",
        owner_id: "user_a",
        project_id: "proj_1",
        title: null,
        active_agent_slug: "litt",
        revision: 3,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        archived_at: null,
      };
      mockSingle.mockResolvedValue({ data: mockData, error: null });

      const result = await getConversation("conv_1", "user_a");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("conv_1");
      expect(result?.revision).toBe(3);
    });
  });

  describe("listConversations — project filter", () => {
    it("returns empty array when no conversations exist", async () => {
      mockThen.mockImplementation((cb: (value: unknown) => unknown) =>
        Promise.resolve(cb({ data: [], error: null })),
      );

      const result = await listConversations("user_a", "proj_1");
      expect(result).toEqual([]);
    });
  });

  describe("insertMessage — idempotency", () => {
    it("returns duplicate=true when client_request_id already exists", async () => {
      // First call: check for existing — returns a match
      const existingMsg = {
        id: "msg_1",
        conversation_id: "conv_1",
        owner_id: "user_a",
        project_id: "proj_1",
        role: "user",
        agent_slug: null,
        content: "Hello",
        status: "completed",
        parent_message_id: null,
        regeneration_of_message_id: null,
        client_request_id: "req_1",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      mockThen.mockImplementationOnce((cb: (value: unknown) => unknown) =>
        Promise.resolve(cb({ data: [existingMsg], error: null })),
      );

      const result = await insertMessage({
        conversationId: "conv_1",
        ownerId: "user_a",
        projectId: "proj_1",
        role: "user",
        content: "Hello",
        status: "completed",
        clientRequestId: "req_1",
      });

      expect(result.duplicate).toBe(true);
      expect(result.message?.id).toBe("msg_1");
    });
  });
});
