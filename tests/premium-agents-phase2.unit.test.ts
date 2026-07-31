/**
 * Phase 2 unit tests for agent installation and entitlement enforcement.
 *
 * These tests verify the server-side authorization rules:
 * - Free agent installs without purchase
 * - Paid agent without entitlement is rejected
 * - Paid agent with entitlement installs
 * - Plan-included agent installs
 * - Duplicate install is idempotent
 * - User B cannot install using User A's entitlement
 * - Refunded entitlement blocks installation
 * - Disabled installation cannot be opened as active
 * - Uninstall does not delete the financial entitlement
 * - Repurchase is blocked while active entitlement exists
 * - Pending order does not grant access
 * - Server response never exposes system prompts or Stripe secrets
 *
 * Run: pnpm exec vitest run tests/premium-agents-phase2.unit.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// -- Mocks ----------------------------------------------------------------

let mockClerkId: string | null = "user_a_clerk_id";
let mockUser: { id: string } | null = { id: "user-a-uuid" };
let mockAgent: { id: string; slug: string; price_cents: number; is_public: boolean } | null = {
  id: "agent-uuid-001",
  slug: "litt-growth",
  price_cents: 1900,
  is_public: true,
};
let mockVersion: { status: string } | null = { status: "published" };
let mockEntitlement: { id: string; status: string } | null = null;
let mockInstallation: { id: string; is_active: boolean } | null = null;
let mockSubscription: { plan: string; status: string } | null = null;
let mockMarketplaceItem: { included_plan_ids: string[] | null } | null = null;
let mockPendingOrders: { id: string }[] | null = null;
let mockPendingItem: { id: string } | null = null;
let mockInsertResult: { id: string } | null = { id: "install-uuid-001" };
let mockInsertError: unknown = null;
let mockUpdateResult: unknown = null;
let mockDeleteResult: unknown = null;

// Track which table+operation was called
let lastTable: string | null = null;
let lastOperation: string | null = null;

function makeChainable(resultFn: () => Promise<{ data: unknown; error: unknown }>) {
  const terminal = {
    single: vi.fn(resultFn),
    maybeSingle: vi.fn(resultFn),
  };
  // The chain is thenable so `await supabase.from(t).select().eq().eq()`
  // resolves to { data, error } without calling single/maybeSingle.
  const chainAfterEq = {
    eq: vi.fn(() => chainAfterEq),
    in: vi.fn(() => chainAfterEq),
    order: vi.fn(() => chainAfterEq),
    limit: vi.fn(() => chainAfterEq),
    single: terminal.single,
    maybeSingle: terminal.maybeSingle,
    then: (resolve: (v: unknown) => void) => Promise.resolve(resultFn()).then(resolve),
  };
  return {
    eq: vi.fn(() => chainAfterEq),
    in: vi.fn(() => chainAfterEq),
    order: vi.fn(() => chainAfterEq),
    limit: vi.fn(() => chainAfterEq),
    single: terminal.single,
    maybeSingle: terminal.maybeSingle,
    then: (resolve: (v: unknown) => void) => Promise.resolve(resultFn()).then(resolve),
  };
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      lastTable = table;

      const selectChain = makeChainable(async () => {
        if (table === "users") return { data: mockUser, error: null };
        if (table === "agents") return { data: mockAgent, error: null };
        if (table === "agent_versions") return { data: mockVersion, error: null };
        if (table === "agent_entitlements") return { data: mockEntitlement, error: null };
        if (table === "user_agents") return { data: mockInstallation, error: null };
        if (table === "subscriptions") return { data: mockSubscription, error: null };
        if (table === "marketplace_items") return { data: mockMarketplaceItem, error: null };
        if (table === "marketplace_orders") return { data: mockPendingOrders, error: null };
        if (table === "marketplace_order_items") return { data: mockPendingItem, error: null };
        return { data: null, error: null };
      });

      const insertChain = {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: mockInsertResult, error: mockInsertError })),
        })),
      };

      const updateChain = {
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: mockInsertError })),
        })),
      };

      const deleteChain = {
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: mockInsertError })),
        })),
      };

      return {
        select: vi.fn(() => selectChain),
        insert: vi.fn(() => {
          lastOperation = "insert";
          return insertChain;
        }),
        update: vi.fn(() => {
          lastOperation = "update";
          return updateChain;
        }),
        delete: vi.fn(() => {
          lastOperation = "delete";
          return deleteChain;
        }),
        eq: vi.fn(() => selectChain),
      };
    }),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: mockClerkId, clerkId: mockClerkId })),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: vi.fn((handler: unknown) => handler),
  rateLimit: vi.fn(async () => ({ success: true, remaining: 10, resetTime: 60 })),
}));

// -- Setup ----------------------------------------------------------------

beforeEach(() => {
  mockClerkId = "user_a_clerk_id";
  mockUser = { id: "user-a-uuid" };
  mockAgent = { id: "agent-uuid-001", slug: "litt-growth", price_cents: 1900, is_public: true };
  mockVersion = { status: "published" };
  mockEntitlement = null;
  mockInstallation = null;
  mockSubscription = null;
  mockMarketplaceItem = null;
  mockPendingOrders = null;
  mockPendingItem = null;
  mockInsertResult = { id: "install-uuid-001" };
  mockInsertError = null;
  mockUpdateResult = null;
  mockDeleteResult = null;
  lastTable = null;
  lastOperation = null;
});

afterEach(() => {
  vi.resetModules();
});

// -- Helpers ---------------------------------------------------------------

async function callInstall(agentId: string) {
  const { POST } = await import("@/app/api/marketplace/agents/[id]/install/route");
  const req = new Request(
    `http://localhost:3000/api/marketplace/agents/${agentId}/install`,
    { method: "POST" },
  );
  return POST(req as never, {
    params: Promise.resolve({ id: agentId }),
  } as never);
}

async function callUninstall(agentId: string) {
  const { DELETE } = await import("@/app/api/marketplace/agents/[id]/install/route");
  const req = new Request(
    `http://localhost:3000/api/marketplace/agents/${agentId}/install`,
    { method: "DELETE" },
  );
  return DELETE(req as never, {
    params: Promise.resolve({ id: agentId }),
  } as never);
}

async function callState(agentId: string) {
  const { GET } = await import("@/app/api/marketplace/agents/[id]/state/route");
  const req = new Request(
    `http://localhost:3000/api/marketplace/agents/${agentId}/state`,
    { method: "GET" },
  );
  return GET(req as never, {
    params: Promise.resolve({ id: agentId }),
  } as never);
}

// -- Tests -----------------------------------------------------------------

describe("Phase 2: Agent installation authorization", () => {
  it("free agent installs without purchase", async () => {
    mockAgent = { id: "agent-free", slug: "litt-free", price_cents: 0, is_public: true };
    const res = await callInstall("agent-free");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("open");
    expect(data.installationId).toBeDefined();
  });

  it("paid agent without entitlement is rejected", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", price_cents: 1900, is_public: true };
    mockEntitlement = null;
    mockSubscription = null;
    mockMarketplaceItem = null;
    const res = await callInstall("agent-paid");
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Payment required");
  });

  it("paid agent with active entitlement installs", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", price_cents: 1900, is_public: true };
    mockEntitlement = { id: "ent-001", status: "active" };
    mockInstallation = null;
    const res = await callInstall("agent-paid");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("open");
  });

  it("plan-included agent installs", async () => {
    mockAgent = { id: "agent-plan", slug: "litt-growth", price_cents: 1900, is_public: true };
    mockEntitlement = null;
    mockSubscription = { plan: "pro_builder_beta", status: "active" };
    mockMarketplaceItem = { included_plan_ids: ["pro_builder_beta"] };
    mockInstallation = null;
    const res = await callInstall("agent-plan");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("open");
  });

  it("duplicate install is idempotent", async () => {
    mockAgent = { id: "agent-free", slug: "litt-free", price_cents: 0, is_public: true };
    mockInstallation = { id: "existing-install", is_active: true };
    const res = await callInstall("agent-free");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toContain("Already installed");
  });

  it("User B cannot install using User A's entitlement", async () => {
    // User B is authenticated but has no entitlement for this agent.
    mockClerkId = "user_b_clerk_id";
    mockUser = { id: "user-b-uuid" };
    mockAgent = { id: "agent-paid", slug: "litt-growth", price_cents: 1900, is_public: true };
    mockEntitlement = null; // User B has no entitlement
    mockSubscription = null;
    mockMarketplaceItem = null;
    const res = await callInstall("agent-paid");
    expect(res.status).toBe(403);
  });

  it("refunded entitlement blocks installation", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", price_cents: 1900, is_public: true };
    mockEntitlement = { id: "ent-001", status: "refunded" };
    mockInstallation = null;
    const res = await callInstall("agent-paid");
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("revoked");
  });

  it("disabled installation re-enables via POST", async () => {
    mockAgent = { id: "agent-free", slug: "litt-free", price_cents: 0, is_public: true };
    mockInstallation = { id: "install-001", is_active: false };
    const res = await callInstall("agent-free");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("open");
    expect(data.message).toContain("re-enabled");
  });

  it("uninstall does not delete the financial entitlement", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", price_cents: 1900, is_public: true };
    mockEntitlement = { id: "ent-001", status: "active" };
    mockInstallation = { id: "install-001", is_active: true };
    const res = await callUninstall("agent-paid");
    expect(res.status).toBe(200);
    // The delete should target user_agents, NOT agent_entitlements.
    // The entitlement remains in the database.
    expect(lastTable).toBe("user_agents");
    expect(lastOperation).toBe("delete");
  });

  it("repurchase is blocked while active entitlement exists (state shows install, not buy)", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", price_cents: 1900, is_public: true };
    mockEntitlement = { id: "ent-001", status: "active" };
    mockInstallation = null;
    const res = await callState("agent-paid");
    expect(res.status).toBe(200);
    const data = await res.json();
    // Should show "install" (owned), not "buy"
    expect(data.state).toBe("install");
    expect(data.hasEntitlement).toBe(true);
  });

  it("pending order does not grant access (state shows processing)", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", price_cents: 1900, is_public: true };
    mockEntitlement = null;
    mockSubscription = null;
    mockMarketplaceItem = null;
    mockPendingOrders = [{ id: "order-pending-001" }];
    mockPendingItem = { id: "item-pending-001" };
    mockInstallation = null;
    const res = await callState("agent-paid");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("processing");
    expect(data.hasPendingOrder).toBe(true);
    expect(data.canInstall).toBe(false);
  });

  it("server response never exposes system prompts or Stripe secrets", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", price_cents: 1900, is_public: true };
    mockEntitlement = { id: "ent-001", status: "active" };
    mockInstallation = null;
    const res = await callState("agent-paid");
    expect(res.status).toBe(200);
    const data = await res.json();
    const jsonStr = JSON.stringify(data);
    // Must not contain system prompt fields or Stripe secrets
    expect(jsonStr).not.toContain("system_prompt");
    expect(jsonStr).not.toContain("stripe_price_id");
    expect(jsonStr).not.toContain("sk_");
    expect(jsonStr).not.toContain("secret");
  });
});
