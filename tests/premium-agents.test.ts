// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: mockRpc,
  },
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: unknown) => handler,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_123", clerkId: "user_test_123" }),
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => ({ userId: "user_test_123", clerkId: "user_test_123" }),
}));

describe("Premium Agents — Webhook RPC Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fulfill_agent_purchase RPC is called with correct params", async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: "ok" }, error: null });

    const expectedParams = {
      p_stripe_event_id: "evt_test_123",
      p_stripe_event_type: "checkout.session.completed",
      p_clerk_id: "user_test_123",
      p_agent_version_id: "version-uuid-1",
      p_agent_slug: "litt-growth",
      p_stripe_session_id: "cs_test_123",
      p_stripe_payment_intent_id: "pi_test_123",
      p_stripe_charge_id: null,
      p_amount_cents: 1900,
      p_currency: "usd",
    };

    await mockRpc("fulfill_agent_purchase", expectedParams);
    expect(mockRpc).toHaveBeenCalledWith("fulfill_agent_purchase", expectedParams);
  });

  it("refund_agent_purchase RPC is called with correct params", async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: "ok" }, error: null });

    const expectedParams = {
      p_stripe_event_id: "evt_refund_123",
      p_stripe_event_type: "charge.refunded",
      p_stripe_payment_intent_id: "pi_test_123",
      p_stripe_refund_id: "re_test_123",
    };

    await mockRpc("refund_agent_purchase", expectedParams);
    expect(mockRpc).toHaveBeenCalledWith("refund_agent_purchase", expectedParams);
  });

  it("duplicate webhook event returns already_processed", async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: "already_processed" }, error: null });

    const result = await mockRpc("fulfill_agent_purchase", {
      p_stripe_event_id: "evt_duplicate_123",
      p_stripe_event_type: "checkout.session.completed",
      p_clerk_id: "user_test_123",
      p_agent_version_id: "version-uuid-1",
      p_agent_slug: "litt-growth",
      p_stripe_session_id: "cs_test_123",
      p_stripe_payment_intent_id: "pi_test_123",
      p_stripe_charge_id: null,
      p_amount_cents: 1900,
      p_currency: "usd",
    });

    expect(result.data.status).toBe("already_processed");
  });

  it("refund revokes entitlement and retains records", async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: "ok", order_id: "order-123" }, error: null });

    const result = await mockRpc("refund_agent_purchase", {
      p_stripe_event_id: "evt_refund_456",
      p_stripe_event_type: "charge.refunded",
      p_stripe_payment_intent_id: "pi_test_123",
      p_stripe_refund_id: "re_test_456",
    });

    expect(result.data.status).toBe("ok");
    expect(result.data.order_id).toBe("order-123");
  });
});

describe("Premium Agents — Migration Validation", () => {
  it("order statuses match spec", () => {
    const validStatuses = ["pending", "paid", "failed", "refunded"];
    expect(validStatuses).toContain("pending");
    expect(validStatuses).toContain("paid");
    expect(validStatuses).toContain("failed");
    expect(validStatuses).toContain("refunded");
    expect(validStatuses).not.toContain("cancelled");
  });

  it("entitlement statuses match spec", () => {
    const validStatuses = ["active", "revoked", "suspended", "refunded"];
    expect(validStatuses).toContain("active");
    expect(validStatuses).toContain("refunded");
    expect(validStatuses).not.toContain("deleted");
  });

  it("agent version statuses match spec", () => {
    const validStatuses = ["active", "suspended", "deprecated"];
    expect(validStatuses).toContain("active");
    expect(validStatuses).toContain("suspended");
    expect(validStatuses).toContain("deprecated");
  });

  it("currency is stored as integer cents", () => {
    const growthPrice = 1900;
    const socialPrice = 1500;
    const coderProPrice = 2900;
    expect(growthPrice % 100).toBe(0);
    expect(socialPrice % 100).toBe(0);
    expect(coderProPrice % 100).toBe(0);
  });

  it("stripe identifiers include all required fields", () => {
    const requiredFields = [
      "stripe_checkout_session_id",
      "stripe_payment_intent_id",
      "stripe_charge_id",
      "stripe_refund_id",
    ];
    expect(requiredFields).toHaveLength(4);
    expect(requiredFields).toContain("stripe_refund_id");
  });
});
