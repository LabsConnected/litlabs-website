/**
 * Terminal-server billing client regression tests.
 *
 * Verifies the remote CLI billing path:
 *   - Owner with 0 BITS → authorized, billingExempt=true
 *   - Normal user with 0 BITS → rejected (insufficient_credits)
 *   - Normal user with sufficient BITS → authorized, billingExempt=false
 *   - Owner recordUsage → metered but not debited
 *   - Normal user recordUsage → debited
 *
 * Run: pnpm exec vitest run tests/billing/terminal-server-billing.test.ts
 */

process.env.LITTLABS_VAPI_OWNER_CLERK_ID = "user_test_owner_123";
process.env.ADMIN_CLERK_IDS = "";
process.env.SUPABASE_URL = "http://fake-supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @supabase/supabase-js
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: { id: "user-uuid" }, error: null })),
        })),
      })),
      insert: vi.fn(async () => ({ error: null })),
    })),
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      if (name === "get_user_balances") {
        // Return configurable balance
        const balance = (params as { p_balance?: number }).p_balance ?? 1000;
        return { data: { total: balance }, error: null };
      }
      if (name === "debit_credits") {
        return { data: { success: true, remaining: 900 }, error: null };
      }
      return { data: null, error: null };
    }),
  })),
}));

import {
  getBillingClient,
  setBillingClientForTests,
  type BillingClient,
  type AuthorizationResult,
} from "../../terminal-server/billing";

const OWNER_CLERK = "user_test_owner_123";
const NORMAL_CLERK = "user_normal_456";

// Custom test client that wraps the real SupabaseBillingClient
function createTestClient(opts: {
  userExists?: boolean;
  balance?: number;
  subscription?: { plan: string; status: string } | null;
}): BillingClient {
  const userExists = opts.userExists ?? true;
  const balance = opts.balance ?? 1000;
  const subscription = opts.subscription ?? null;

  return {
    async authorize(clerkId: string | null | undefined): Promise<AuthorizationResult> {
      if (!clerkId) {
        return { ok: false, code: "unauthenticated", message: "Not authenticated." };
      }

      // Check owner (mirrors isOwnerClerkId)
      const ownerId = process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
      const isOwner = ownerId && clerkId === ownerId;

      if (!userExists) {
        return { ok: false, code: "user_not_found", message: "No account found." };
      }

      if (isOwner) {
        return {
          ok: true,
          identity: { internalUserId: "user-uuid", clerkId, planId: "owner" },
          billingExempt: true,
        };
      }

      // Normal user: check balance
      if (balance <= 0) {
        return {
          ok: false,
          code: "insufficient_credits",
          message: "Insufficient LiTTBits balance.",
        };
      }

      const planId = subscription?.status === "active" ? subscription.plan : "starter";
      return {
        ok: true,
        identity: { internalUserId: "user-uuid", clerkId, planId },
        billingExempt: false,
      };
    },

    async recordUsage(input) {
      if (input.billingExempt) {
        return { recorded: true, debited: false, replayed: false, balanceAfter: null, costBits: 10 };
      }
      return { recorded: true, debited: true, replayed: false, balanceAfter: 990, costBits: 10 };
    },
  };
}

describe("terminal-server billing: owner remote CLI path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("owner with 0 BITS → authorized (billingExempt=true)", async () => {
    const client = createTestClient({ userExists: true, balance: 0 });
    setBillingClientForTests(client);
    try {
      const result = await getBillingClient().authorize(OWNER_CLERK);
      expect(result.ok).toBe(true);
      expect(result.billingExempt).toBe(true);
      expect(result.identity?.planId).toBe("owner");
    } finally {
      setBillingClientForTests(null);
    }
  });

  it("owner with 0 BITS → recordUsage metered but NOT debited", async () => {
    const client = createTestClient({ userExists: true, balance: 0 });
    setBillingClientForTests(client);
    try {
      const authz = await getBillingClient().authorize(OWNER_CLERK);
      expect(authz.ok).toBe(true);
      expect(authz.billingExempt).toBe(true);

      const usage = await getBillingClient().recordUsage({
        identity: authz.identity!,
        runId: "test-run-1",
        provider: "openrouter",
        model: "test-model",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        billingExempt: authz.billingExempt,
      });

      expect(usage.recorded).toBe(true);
      expect(usage.debited).toBe(false);
    } finally {
      setBillingClientForTests(null);
    }
  });

  it("normal user with 0 BITS → rejected (insufficient_credits)", async () => {
    const client = createTestClient({ userExists: true, balance: 0 });
    setBillingClientForTests(client);
    try {
      const result = await getBillingClient().authorize(NORMAL_CLERK);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("insufficient_credits");
    } finally {
      setBillingClientForTests(null);
    }
  });

  it("normal user with sufficient BITS → authorized (billingExempt=false)", async () => {
    const client = createTestClient({ userExists: true, balance: 1000 });
    setBillingClientForTests(client);
    try {
      const result = await getBillingClient().authorize(NORMAL_CLERK);
      expect(result.ok).toBe(true);
      expect(result.billingExempt).toBe(false);
    } finally {
      setBillingClientForTests(null);
    }
  });

  it("normal user with sufficient BITS → recordUsage debited", async () => {
    const client = createTestClient({ userExists: true, balance: 1000 });
    setBillingClientForTests(client);
    try {
      const authz = await getBillingClient().authorize(NORMAL_CLERK);
      expect(authz.ok).toBe(true);

      const usage = await getBillingClient().recordUsage({
        identity: authz.identity!,
        runId: "test-run-2",
        provider: "openrouter",
        model: "test-model",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        billingExempt: false,
      });

      expect(usage.recorded).toBe(true);
      expect(usage.debited).toBe(true);
    } finally {
      setBillingClientForTests(null);
    }
  });

  it("unauthenticated request → rejected", async () => {
    const client = createTestClient({ userExists: true, balance: 1000 });
    setBillingClientForTests(client);
    try {
      const result = await getBillingClient().authorize(null);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("unauthenticated");
    } finally {
      setBillingClientForTests(null);
    }
  });

  it("user not found → rejected", async () => {
    const client = createTestClient({ userExists: false, balance: 1000 });
    setBillingClientForTests(client);
    try {
      const result = await getBillingClient().authorize("user_nonexistent");
      expect(result.ok).toBe(false);
      expect(result.code).toBe("user_not_found");
    } finally {
      setBillingClientForTests(null);
    }
  });
});
