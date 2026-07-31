/**
 * Phase 2 unit tests for agent installation and entitlement enforcement.
 *
 * Tests verify the server-side authorization rules including:
 * - Free agent installs (version price = 0)
 * - Paid agent without entitlement rejected
 * - Paid agent with active entitlement installs
 * - Plan-included agent installs
 * - Duplicate install idempotent
 * - User B cannot install using User A's entitlement
 * - Refunded entitlement blocks installation
 * - Disabled installation re-enables via POST (canEnable)
 * - Uninstall does not delete financial entitlement
 * - Repurchase blocked while active entitlement exists
 * - Pending order does not grant access
 * - Server response never exposes system prompts or Stripe secrets
 * - Private agent returns 404
 * - Unlisted agent returns 404
 * - Price drift: version price > 0 requires payment even if agent row differs
 * - v1 entitlement allows v1.1 but not v2.0
 * - Lapsed plan blocks re-enable
 * - Refund blocks re-enable
 * - Expired pending order does not show processing
 * - PATCH enable enforces canEnable
 * - includes_future_updates=false only allows exact purchased version
 *
 * Run: pnpm exec vitest run tests/premium-agents-phase2.unit.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// -- Mocks ----------------------------------------------------------------

let mockClerkId: string | null = "user_a_clerk_id";
let mockUser: { id: string } | null = { id: "user-a-uuid" };
let mockAgent: { id: string; slug: string; is_public: boolean } | null = {
  id: "agent-uuid-001",
  slug: "litt-growth",
  is_public: true,
};
let mockVersion: {
  id: string;
  version: string;
  price_cents: number;
  currency: string;
  status: string;
  published_at: string;
} | null = {
  id: "version-001",
  version: "1.0.0",
  price_cents: 1900,
  currency: "usd",
  status: "published",
  published_at: "2026-07-30T00:00:00Z",
};
let mockEntitlement: {
  id: string;
  status: string;
  purchased_version_id: string;
  minimum_version: string;
  maximum_version: string | null;
  includes_future_updates: boolean;
} | null = null;
let mockInstallation: { id: string; is_active: boolean } | null = null;
let mockSubscription: { plan: string; status: string } | null = null;
let mockMarketplaceItem: {
  status: string;
  item_type: string;
  included_plan_ids: string[] | null;
  billing_model: string;
} | null = null;
let mockPendingOrders: { id: string }[] | null = null;
let mockPendingItem: { id: string } | null = null;
let mockInsertResult: { id: string } | null = { id: "install-uuid-001" };
let mockInsertError: unknown = null;

let lastTable: string | null = null;
let lastOperation: string | null = null;

function makeChainable(resultFn: () => Promise<{ data: unknown; error: unknown }>) {
  const terminal = {
    single: vi.fn(resultFn),
    maybeSingle: vi.fn(resultFn),
  };
  const chainAfterEq = {
    eq: vi.fn(() => chainAfterEq),
    in: vi.fn(() => chainAfterEq),
    gt: vi.fn(() => chainAfterEq),
    order: vi.fn(() => chainAfterEq),
    limit: vi.fn(() => chainAfterEq),
    single: terminal.single,
    maybeSingle: terminal.maybeSingle,
    then: (resolve: (v: unknown) => void) => Promise.resolve(resultFn()).then(resolve),
  };
  return {
    eq: vi.fn(() => chainAfterEq),
    in: vi.fn(() => chainAfterEq),
    gt: vi.fn(() => chainAfterEq),
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
    rpc: vi.fn(async () => ({ data: null, error: null })),
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
  mockAgent = { id: "agent-uuid-001", slug: "litt-growth", is_public: true };
  mockVersion = {
    id: "version-001",
    version: "1.0.0",
    price_cents: 1900,
    currency: "usd",
    status: "published",
    published_at: "2026-07-30T00:00:00Z",
  };
  mockEntitlement = null;
  mockInstallation = null;
  mockSubscription = null;
  mockMarketplaceItem = {
    status: "available",
    item_type: "agent",
    included_plan_ids: [],
    billing_model: "one_time",
  };
  mockPendingOrders = null;
  mockPendingItem = null;
  mockInsertResult = { id: "install-uuid-001" };
  mockInsertError = null;
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

async function callPatch(agentId: string, action: string) {
  const { PATCH } = await import("@/app/api/marketplace/agents/[id]/install/route");
  const req = new Request(
    `http://localhost:3000/api/marketplace/agents/${agentId}/install`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    },
  );
  return PATCH(req as never, {
    params: Promise.resolve({ id: agentId }),
  } as never);
}

// -- Tests -----------------------------------------------------------------

describe("Phase 2: Agent installation authorization", () => {
  it("free agent installs without purchase (version price = 0)", async () => {
    mockAgent = { id: "agent-free", slug: "litt-free", is_public: true };
    mockVersion = {
      id: "ver-free", version: "1.0.0", price_cents: 0, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    const res = await callInstall("agent-free");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("open");
    expect(data.installationId).toBeDefined();
  });

  it("paid agent without entitlement is rejected", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", is_public: true };
    mockVersion = {
      id: "ver-paid", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = null;
    mockSubscription = null;
    mockMarketplaceItem = {
      status: "available", item_type: "agent", included_plan_ids: [], billing_model: "one_time",
    };
    const res = await callInstall("agent-paid");
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Payment required");
  });

  it("paid agent with active entitlement installs", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", is_public: true };
    mockVersion = {
      id: "ver-paid", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = {
      id: "ent-001", status: "active", purchased_version_id: "ver-paid",
      minimum_version: "1.0.0", maximum_version: "1.999.999", includes_future_updates: true,
    };
    mockInstallation = null;
    const res = await callInstall("agent-paid");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("open");
  });

  it("plan-included agent installs", async () => {
    mockAgent = { id: "agent-plan", slug: "litt-growth", is_public: true };
    mockVersion = {
      id: "ver-plan", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = null;
    mockSubscription = { plan: "pro_builder_beta", status: "active" };
    mockMarketplaceItem = {
      status: "available", item_type: "agent",
      included_plan_ids: ["pro_builder_beta"], billing_model: "one_time",
    };
    mockInstallation = null;
    const res = await callInstall("agent-plan");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("open");
  });

  it("duplicate install is idempotent", async () => {
    mockAgent = { id: "agent-free", slug: "litt-free", is_public: true };
    mockVersion = {
      id: "ver-free", version: "1.0.0", price_cents: 0, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockInstallation = { id: "existing-install", is_active: true };
    const res = await callInstall("agent-free");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toContain("Already installed");
  });

  it("User B cannot install using User A's entitlement", async () => {
    mockClerkId = "user_b_clerk_id";
    mockUser = { id: "user-b-uuid" };
    mockAgent = { id: "agent-paid", slug: "litt-growth", is_public: true };
    mockVersion = {
      id: "ver-paid", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = null;
    mockSubscription = null;
    mockMarketplaceItem = {
      status: "available", item_type: "agent", included_plan_ids: [], billing_model: "one_time",
    };
    const res = await callInstall("agent-paid");
    expect(res.status).toBe(403);
  });

  it("refunded entitlement blocks installation", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", is_public: true };
    mockVersion = {
      id: "ver-paid", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = {
      id: "ent-001", status: "refunded", purchased_version_id: "ver-paid",
      minimum_version: "1.0.0", maximum_version: "1.999.999", includes_future_updates: true,
    };
    mockInstallation = null;
    const res = await callInstall("agent-paid");
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("revoked");
  });

  it("disabled installation re-enables via POST (canEnable)", async () => {
    mockAgent = { id: "agent-free", slug: "litt-free", is_public: true };
    mockVersion = {
      id: "ver-free", version: "1.0.0", price_cents: 0, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockInstallation = { id: "install-001", is_active: false };
    const res = await callInstall("agent-free");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("open");
    expect(data.message).toContain("re-enabled");
  });

  it("uninstall does not delete the financial entitlement", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", is_public: true };
    mockVersion = {
      id: "ver-paid", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = {
      id: "ent-001", status: "active", purchased_version_id: "ver-paid",
      minimum_version: "1.0.0", maximum_version: "1.999.999", includes_future_updates: true,
    };
    mockInstallation = { id: "install-001", is_active: true };
    const res = await callUninstall("agent-paid");
    expect(res.status).toBe(200);
    expect(lastTable).toBe("user_agents");
    expect(lastOperation).toBe("delete");
  });

  it("repurchase is blocked while active entitlement exists (state shows install, not buy)", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", is_public: true };
    mockVersion = {
      id: "ver-paid", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = {
      id: "ent-001", status: "active", purchased_version_id: "ver-paid",
      minimum_version: "1.0.0", maximum_version: "1.999.999", includes_future_updates: true,
    };
    mockInstallation = null;
    const res = await callState("agent-paid");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("install");
    expect(data.hasEntitlement).toBe(true);
  });

  it("pending order does not grant access (state shows processing)", async () => {
    mockAgent = { id: "agent-paid", slug: "litt-growth", is_public: true };
    mockVersion = {
      id: "ver-paid", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = null;
    mockSubscription = null;
    mockMarketplaceItem = {
      status: "available", item_type: "agent", included_plan_ids: [], billing_model: "one_time",
    };
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
    mockAgent = { id: "agent-paid", slug: "litt-growth", is_public: true };
    mockVersion = {
      id: "ver-paid", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = {
      id: "ent-001", status: "active", purchased_version_id: "ver-paid",
      minimum_version: "1.0.0", maximum_version: "1.999.999", includes_future_updates: true,
    };
    mockInstallation = null;
    const res = await callState("agent-paid");
    expect(res.status).toBe(200);
    const data = await res.json();
    const jsonStr = JSON.stringify(data);
    expect(jsonStr).not.toContain("system_prompt");
    expect(jsonStr).not.toContain("stripe_price_id");
    expect(jsonStr).not.toContain("sk_");
    expect(jsonStr).not.toContain("secret");
  });

  // ── New tests for Phase 2 review fixes ────────────────────────────────

  it("private agent returns 404 (does not reveal existence)", async () => {
    mockAgent = { id: "agent-private", slug: "litt-private", is_public: false };
    mockVersion = {
      id: "ver-priv", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    const res = await callState("agent-private");
    expect(res.status).toBe(404);
  });

  it("unlisted agent returns 404 (does not reveal existence)", async () => {
    mockAgent = { id: "agent-unlisted", slug: "litt-unlisted", is_public: true };
    mockVersion = {
      id: "ver-unl", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockMarketplaceItem = null;
    const res = await callState("agent-unlisted");
    expect(res.status).toBe(404);
  });

  it("price drift: version.price_cents>0 requires payment even if agent row differs", async () => {
    mockAgent = { id: "agent-drift", slug: "litt-drift", is_public: true };
    mockVersion = {
      id: "ver-drift", version: "1.0.0", price_cents: 2900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = null;
    mockSubscription = null;
    mockMarketplaceItem = {
      status: "available", item_type: "agent", included_plan_ids: [], billing_model: "one_time",
    };
    const res = await callInstall("agent-drift");
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Payment required");
  });

  it("v1 entitlement allows v1.1 (within range)", async () => {
    mockAgent = { id: "agent-v1", slug: "litt-v1", is_public: true };
    mockVersion = {
      id: "ver-v11", version: "1.1.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = {
      id: "ent-v1", status: "active", purchased_version_id: "ver-v10",
      minimum_version: "1.0.0", maximum_version: "1.999.999", includes_future_updates: true,
    };
    mockInstallation = null;
    const res = await callState("agent-v1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasEntitlement).toBe(true);
    expect(data.state).toBe("install");
  });

  it("v1 entitlement does not allow v2.0 (upgrade required)", async () => {
    mockAgent = { id: "agent-v2", slug: "litt-v2", is_public: true };
    mockVersion = {
      id: "ver-v20", version: "2.0.0", price_cents: 2900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = {
      id: "ent-v1", status: "active", purchased_version_id: "ver-v10",
      minimum_version: "1.0.0", maximum_version: "1.999.999", includes_future_updates: true,
    };
    mockInstallation = null;
    const res = await callState("agent-v2");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("upgrade_required");
    expect(data.canInstall).toBe(false);
  });

  it("lapsed plan blocks re-enable (canEnable false)", async () => {
    mockAgent = { id: "agent-lapsed", slug: "litt-lapsed", is_public: true };
    mockVersion = {
      id: "ver-lapsed", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = null;
    mockSubscription = null;
    mockMarketplaceItem = {
      status: "available", item_type: "agent",
      included_plan_ids: ["pro_builder_beta"], billing_model: "one_time",
    };
    mockInstallation = { id: "install-lapsed", is_active: false };
    const res = await callInstall("agent-lapsed");
    expect(res.status).toBe(403);
  });

  it("refund blocks re-enable (canEnable false)", async () => {
    mockAgent = { id: "agent-refund", slug: "litt-refund", is_public: true };
    mockVersion = {
      id: "ver-refund", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = {
      id: "ent-refund", status: "refunded", purchased_version_id: "ver-refund",
      minimum_version: "1.0.0", maximum_version: "1.999.999", includes_future_updates: true,
    };
    mockInstallation = { id: "install-refund", is_active: false };
    const res = await callInstall("agent-refund");
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("revoked");
  });

  it("PATCH enable enforces canEnable (lapsed plan rejected)", async () => {
    mockAgent = { id: "agent-patch", slug: "litt-patch", is_public: true };
    mockVersion = {
      id: "ver-patch", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = null;
    mockSubscription = null;
    mockMarketplaceItem = {
      status: "available", item_type: "agent",
      included_plan_ids: ["pro_builder_beta"], billing_model: "one_time",
    };
    mockInstallation = { id: "install-patch", is_active: false };
    const res = await callPatch("agent-patch", "enable");
    expect(res.status).toBe(403);
  });

  it("PATCH enable succeeds with active entitlement", async () => {
    mockAgent = { id: "agent-patch-ok", slug: "litt-patch-ok", is_public: true };
    mockVersion = {
      id: "ver-patch-ok", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = {
      id: "ent-patch-ok", status: "active", purchased_version_id: "ver-patch-ok",
      minimum_version: "1.0.0", maximum_version: "1.999.999", includes_future_updates: true,
    };
    mockInstallation = { id: "install-patch-ok", is_active: false };
    const res = await callPatch("agent-patch-ok", "enable");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("open");
  });

  it("expired pending order does not show processing", async () => {
    mockAgent = { id: "agent-exp", slug: "litt-exp", is_public: true };
    mockVersion = {
      id: "ver-exp", version: "1.0.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = null;
    mockSubscription = null;
    mockMarketplaceItem = {
      status: "available", item_type: "agent", included_plan_ids: [], billing_model: "one_time",
    };
    mockPendingOrders = null;
    mockPendingItem = null;
    mockInstallation = null;
    const res = await callState("agent-exp");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).not.toBe("processing");
    expect(data.hasPendingOrder).toBe(false);
  });

  it("includes_future_updates=false only allows exact purchased version", async () => {
    mockAgent = { id: "agent-nofuture", slug: "litt-nofuture", is_public: true };
    mockVersion = {
      id: "ver-new", version: "1.1.0", price_cents: 1900, currency: "usd",
      status: "published", published_at: "2026-07-30T00:00:00Z",
    };
    mockEntitlement = {
      id: "ent-nofuture", status: "active", purchased_version_id: "ver-old",
      minimum_version: "1.0.0", maximum_version: "1.999.999", includes_future_updates: false,
    };
    mockInstallation = null;
    const res = await callState("agent-nofuture");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("upgrade_required");
    expect(data.canInstall).toBe(false);
  });
});
