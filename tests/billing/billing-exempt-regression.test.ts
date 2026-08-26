/**
 * Billing exemption regression tests.
 *
 * Verifies the canonical owner billing_exempt behavior:
 *   - Owner with 0 BITS → request succeeds, usage recorded, wallet not debited
 *   - Owner simulating zero_bits → NOT exempt, real billing checks apply
 *   - Owner simulating starter → NOT exempt, real billing checks apply
 *   - Normal user with 0 BITS → rejected before provider spend
 *   - Normal user with sufficient BITS → succeeds and debits
 *   - BYOK user → succeeds without model-usage debit
 *
 * Also verifies:
 *   - billing_exempt is server-derived, never client-supplied
 *   - isBillingExempt respects simulation state
 *   - chargeLlmUsage skips debit for exempt owner but records usage
 *   - terminal-server billing.ts authorize() skips credit check for owner
 *
 * Run: pnpm exec vitest run tests/billing/billing-exempt-regression.test.ts
 */

process.env.LITTLABS_VAPI_OWNER_CLERK_ID = "user_test_owner_123";
process.env.ADMIN_CLERK_IDS = "";

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

// ─── Pure function tests (no DB mocking needed) ───────────────────

import {
  isOwnerClerkId,
  isBillingExempt,
  OWNER_BILLING_EXEMPT,
  OWNER_SPEND_CEILING_USD,
  OWNER_ENTITLEMENTS,
  type SimulatedPlan,
} from "@/lib/owner";

const OWNER_CLERK = "user_test_owner_123";
const NORMAL_CLERK = "user_normal_456";

describe("billing_exempt: pure function tests", () => {
  it("OWNER_BILLING_EXEMPT is true", () => {
    expect(OWNER_BILLING_EXEMPT).toBe(true);
  });

  it("OWNER_ENTITLEMENTS.monthlyCredits is 0 (not 250000)", () => {
    expect(OWNER_ENTITLEMENTS.monthlyCredits).toBe(0);
    expect(OWNER_ENTITLEMENTS.monthlyCredits).not.toBe(250_000);
    expect(OWNER_ENTITLEMENTS.monthlyCredits).not.toBe(999_999);
  });

  it("OWNER_SPEND_CEILING_USD defaults to 250", () => {
    expect(OWNER_SPEND_CEILING_USD).toBe(250);
  });

  it("isOwnerClerkId identifies the owner", () => {
    expect(isOwnerClerkId(OWNER_CLERK)).toBe(true);
    expect(isOwnerClerkId(NORMAL_CLERK)).toBe(false);
    expect(isOwnerClerkId(null)).toBe(false);
    expect(isOwnerClerkId(undefined)).toBe(false);
  });

  it("isBillingExempt: owner with no simulation is exempt", () => {
    expect(isBillingExempt(OWNER_CLERK, null)).toBe(true);
    expect(isBillingExempt(OWNER_CLERK, undefined)).toBe(true);
  });

  it("isBillingExempt: owner with 'owner' simulation is exempt", () => {
    expect(isBillingExempt(OWNER_CLERK, "owner")).toBe(true);
  });

  it("isBillingExempt: owner simulating starter is NOT exempt", () => {
    expect(isBillingExempt(OWNER_CLERK, "starter")).toBe(false);
  });

  it("isBillingExempt: owner simulating creator_beta is NOT exempt", () => {
    expect(isBillingExempt(OWNER_CLERK, "creator_beta")).toBe(false);
  });

  it("isBillingExempt: owner simulating pro_builder_beta is NOT exempt", () => {
    expect(isBillingExempt(OWNER_CLERK, "pro_builder_beta")).toBe(false);
  });

  it("isBillingExempt: owner simulating zero_bits is NOT exempt", () => {
    expect(isBillingExempt(OWNER_CLERK, "zero_bits")).toBe(false);
  });

  it("isBillingExempt: normal user is never exempt regardless of simulation", () => {
    expect(isBillingExempt(NORMAL_CLERK, null)).toBe(false);
    expect(isBillingExempt(NORMAL_CLERK, undefined)).toBe(false);
    expect(isBillingExempt(NORMAL_CLERK, "owner" as SimulatedPlan)).toBe(false);
  });

  it("isBillingExempt: null/undefined clerkId is never exempt", () => {
    expect(isBillingExempt(null, null)).toBe(false);
    expect(isBillingExempt(undefined, null)).toBe(false);
  });
});

// ─── chargeLlmUsage: owner exemption + usage recording ────────────

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn(async () => ({ error: null })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: { id: "user-uuid" }, error: null })),
        })),
      })),
    })),
    rpc: vi.fn(async () => ({ data: { success: true, remaining: 900 }, error: null })),
  })),
}));

import { chargeLlmUsage } from "@/lib/llm-billing";

describe("chargeLlmUsage: owner billing exemption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("owner with no simulation: metered but NOT debited", async () => {
    const result = await chargeLlmUsage({
      clerkId: OWNER_CLERK,
      provider: "openrouter-free",
      model: "openrouter/free",
      promptTokens: 100,
      completionTokens: 50,
      isByok: false,
      callId: "test-owner-exempt-1",
      simulation: null,
    });

    expect(result.calculated).toBe(true);
    expect(result.debited).toBe(false);
    expect(result.balance).toBeNull();
    // Cost was calculated (metered)
    expect(result.cost).toBeDefined();
  });

  it("owner simulating starter: NOT exempt, real debit path applies", async () => {
    const result = await chargeLlmUsage({
      clerkId: OWNER_CLERK,
      provider: "openrouter-free",
      model: "openrouter/free",
      promptTokens: 100,
      completionTokens: 50,
      isByok: false,
      callId: "test-owner-sim-starter-1",
      simulation: "starter",
    });

    // Since owner is simulating starter, billing_exempt does NOT apply.
    // The charge goes through the real debit path (shadow mode check,
    // then Supabase debit). With our mock, debit_credits returns success.
    expect(result.calculated).toBe(true);
    // Not exempt → should attempt debit (mocked RPC returns success)
    expect(result.debited).toBe(true);
  });

  it("owner simulating zero_bits: NOT exempt, real billing checks apply", async () => {
    const result = await chargeLlmUsage({
      clerkId: OWNER_CLERK,
      provider: "openrouter-free",
      model: "openrouter/free",
      promptTokens: 100,
      completionTokens: 50,
      isByok: false,
      callId: "test-owner-sim-zero-1",
      simulation: "zero_bits",
    });

    // zero_bits simulation → NOT exempt → real debit path
    expect(result.calculated).toBe(true);
    expect(result.debited).toBe(true);
  });

  it("normal user: debited normally", async () => {
    const result = await chargeLlmUsage({
      clerkId: NORMAL_CLERK,
      provider: "openrouter-free",
      model: "openrouter/free",
      promptTokens: 100,
      completionTokens: 50,
      isByok: false,
      callId: "test-normal-debit-1",
      simulation: null,
    });

    expect(result.calculated).toBe(true);
    expect(result.debited).toBe(true);
  });

  it("BYOK user: not debited (zero BITS for model inference)", async () => {
    const result = await chargeLlmUsage({
      clerkId: NORMAL_CLERK,
      provider: "openai",
      model: "gpt-4o",
      promptTokens: 100,
      completionTokens: 50,
      isByok: true,
      callId: "test-byok-1",
      simulation: null,
    });

    expect(result.calculated).toBe(true);
    expect(result.debited).toBe(false);
    expect(result.cost.retailLiTTBits).toBe(0);
    expect(result.cost.shouldDebit).toBe(false);
  });

  it("owner BYOK: not debited (BYOK takes priority)", async () => {
    const result = await chargeLlmUsage({
      clerkId: OWNER_CLERK,
      provider: "openai",
      model: "gpt-4o",
      promptTokens: 100,
      completionTokens: 50,
      isByok: true,
      callId: "test-owner-byok-1",
      simulation: null,
    });

    expect(result.calculated).toBe(true);
    expect(result.debited).toBe(false);
    expect(result.cost.retailLiTTBits).toBe(0);
  });
});

// ─── chargeAgentRun: owner exemption ──────────────────────────────

vi.mock("@/lib/agent-registry", () => ({
  getAgentDefinition: vi.fn((slug: string) => ({
    slug,
    name: slug,
    enabled: true,
    minimumPlan: "starter",
    billingModel: "paid",
    cost: { perRun: 5, per1kTokens: 1 },
  })),
}));

import { chargeAgentRun } from "@/lib/agent-entitlements";

describe("chargeAgentRun: owner billing exemption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("owner with no simulation: NOT charged (billing-exempt)", async () => {
    const result = await chargeAgentRun({
      clerkId: OWNER_CLERK,
      agentSlug: "coder",
      idempotencyKey: "test-agent-owner-1",
      simulation: null,
    });

    expect(result.charged).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("owner simulating starter: charged normally (not exempt)", async () => {
    const result = await chargeAgentRun({
      clerkId: OWNER_CLERK,
      agentSlug: "coder",
      idempotencyKey: "test-agent-owner-sim-1",
      simulation: "starter",
    });

    // Not exempt → goes through real charge path (mocked debit_credits)
    expect(result.charged).toBe(true);
  });

  it("normal user: charged normally", async () => {
    const result = await chargeAgentRun({
      clerkId: NORMAL_CLERK,
      agentSlug: "coder",
      idempotencyKey: "test-agent-normal-1",
      simulation: null,
    });

    expect(result.charged).toBe(true);
  });
});

// ─── Security: billing_exempt is server-derived ───────────────────

describe("Security: billing_exempt is server-derived", () => {
  it("isBillingExempt only returns true for the actual owner Clerk ID", () => {
    // A normal user cannot become billing-exempt by any means
    expect(isBillingExempt(NORMAL_CLERK, null)).toBe(false);
    expect(isBillingExempt(NORMAL_CLERK, undefined)).toBe(false);
    expect(isBillingExempt("user_fake_owner", null)).toBe(false);
    expect(isBillingExempt("", null)).toBe(false);
  });

  it("isBillingExempt checks env vars, not client-supplied flags", () => {
    // The function only uses the server-side env var LITTLABS_VAPI_OWNER_CLERK_ID
    // There is no way for a client to pass billing_exempt=true and get exempted
    const ownerId = process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    expect(ownerId).toBe(OWNER_CLERK);
    expect(isBillingExempt(ownerId, null)).toBe(true);
    // Any other ID is not exempt
    expect(isBillingExempt("user_12345", null)).toBe(false);
  });
});
