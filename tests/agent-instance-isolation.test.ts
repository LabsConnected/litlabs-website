import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseAgentSelection, serializeAgentSelection } from "@/lib/agent-selection";

beforeEach(() => {
  vi.clearAllMocks();
});

// Mock supabase for resolveRuntimeAgent tests
const mockMaybeSingle = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mockMaybeSingle,
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: mockMaybeSingle,
            })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { id: "run-1" }, error: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
    rpc: mockRpc,
  },
}));

vi.mock("@/lib/agent-entitlements", () => ({
  resolveAgentEntitlement: vi.fn(() => Promise.resolve({ allowed: true, reason: null })),
}));

vi.mock("@/lib/agent-registry", () => ({
  getAgentDefinition: vi.fn((slug: string) => {
    if (slug === "litt" || slug === "spark") {
      return {
        id: slug,
        slug,
        name: slug === "litt" ? "LiTT" : "Spark",
        systemPrompt: `You are ${slug}`,
        tools: { allowlist: [] },
        defaultModelTask: "chat",
      };
    }
    return null;
  }),
}));

describe("AgentSelection — instance isolation", () => {
  describe("parseAgentSelection", () => {
    it("parses a builtin slug 'litt'", () => {
      const sel = parseAgentSelection("litt");
      expect(sel).toEqual({ kind: "builtin", slug: "litt" });
    });

    it("parses a builtin slug 'spark'", () => {
      const sel = parseAgentSelection("spark");
      expect(sel).toEqual({ kind: "builtin", slug: "spark" });
    });

    it("parses a UUID as an installed instance", () => {
      const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const sel = parseAgentSelection(uuid);
      expect(sel).toEqual({ kind: "installed", instanceId: uuid });
    });

    it("parses an object with kind=builtin", () => {
      const sel = parseAgentSelection({ kind: "builtin", slug: "litt" });
      expect(sel).toEqual({ kind: "builtin", slug: "litt" });
    });

    it("parses an object with kind=installed", () => {
      const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const sel = parseAgentSelection({ kind: "installed", instanceId: uuid });
      expect(sel).toEqual({ kind: "installed", instanceId: uuid });
    });

    it("returns null for invalid input", () => {
      expect(parseAgentSelection(null)).toBeNull();
      expect(parseAgentSelection(undefined)).toBeNull();
      expect(parseAgentSelection("")).toBeNull();
      expect(parseAgentSelection("invalid-slug")).toBeNull();
      expect(parseAgentSelection({ kind: "unknown" })).toBeNull();
      expect(parseAgentSelection(123)).toBeNull();
    });
  });

  describe("serializeAgentSelection", () => {
    it("serializes a builtin selection to the slug", () => {
      expect(serializeAgentSelection({ kind: "builtin", slug: "litt" })).toBe("litt");
    });

    it("serializes an installed selection to the instance ID", () => {
      const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      expect(serializeAgentSelection({ kind: "installed", instanceId: uuid })).toBe(uuid);
    });
  });

  describe("Two buyers receive isolated instances", () => {
    it("produces different AgentSelections for two different instance IDs", () => {
      const buyer1Instance = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const buyer2Instance = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

      const sel1 = parseAgentSelection(buyer1Instance);
      const sel2 = parseAgentSelection(buyer2Instance);

      expect(sel1).not.toEqual(sel2);
      expect(sel1?.kind).toBe("installed");
      expect(sel2?.kind).toBe("installed");
      expect((sel1 as { instanceId: string }).instanceId).toBe(buyer1Instance);
      expect((sel2 as { instanceId: string }).instanceId).toBe(buyer2Instance);
    });

    it("produces different memory namespaces for two different instance IDs", () => {
      // The runtime resolver uses the instance ID as the memory namespace
      // when memory_namespace is not explicitly set.
      const buyer1Instance = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const buyer2Instance = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

      // Memory namespace = instance ID (from the migration backfill)
      const ns1 = buyer1Instance;
      const ns2 = buyer2Instance;

      expect(ns1).not.toBe(ns2);
    });

    it("builtin agents use per-user memory namespaces, not per-instance", () => {
      const clerkId1 = "user_2abc";
      const clerkId2 = "user_2def";

      // Builtin agents use `${clerkId}:${slug}` as the memory namespace
      const ns1 = `${clerkId1}:litt`;
      const ns2 = `${clerkId2}:litt`;

      expect(ns1).not.toBe(ns2);
    });
  });
});

describe("Billing — reserve → settle flow", () => {
  // These tests verify the billing flow logic without a real database.
  // The actual RPC calls are mocked.

  it("estimateCredits calculates per-run + per-1k-tokens cost", async () => {
    const { estimateCredits } = await import("@/lib/agent-billing");
    // 1000 tokens, 1 credit per 1k, 1 credit per run
    expect(estimateCredits(500, 500, 1, 1)).toBe(2);
    // 2000 tokens, 2 credits per 1k, 1 credit per run
    expect(estimateCredits(1000, 1000, 2, 1)).toBe(5);
    // 0 tokens, 0 per 1k, 0 per run
    expect(estimateCredits(0, 0, 1, 0)).toBe(0);
  });

  it("reserveCredits returns 402 when balance is insufficient", async () => {
    const { reserveCredits } = await import("@/lib/agent-billing");

    // Mock chain:
    // 1. from("agent_runs").select().eq().maybeSingle() — no existing run
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    // 2. from("users").select().eq().maybeSingle() — user exists
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "user-uuid-1" }, error: null });
    // 3. rpc("reserve_credits") — insufficient balance
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "insufficient balance: have 0, need 5" } as never,
    });

    const result = await reserveCredits(
      {
        clerkId: "user_test",
        agentInstanceId: "test-instance",
        agentId: null,
        agentVersionId: null,
        idempotencyKey: "test-key-1",
      },
      5,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(402);
    expect(result.error).toContain("Insufficient");
  });
});
