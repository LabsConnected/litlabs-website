import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockSingle = vi.fn();

// Chain builder for Supabase query mock
function buildChain() {
  const chain: Record<string, unknown> = {
    delete: vi.fn(() => chain),
    update: vi.fn((data: unknown) => {
      mockUpdate(data);
      return chain;
    }),
    select: vi.fn((cols: string) => {
      mockSelect(cols);
      return chain;
    }),
    insert: vi.fn(() => chain),
    eq: vi.fn((col: string, val: unknown) => {
      mockEq(col, val);
      return chain;
    }),
    in: vi.fn((col: string, vals: unknown[]) => {
      mockIn(col, vals);
      return chain;
    }),
    single: vi.fn(() => {
      mockSingle();
      return { data: chain._singleData, error: chain._singleError };
    }),
    _singleData: null as unknown,
    _singleError: null as unknown,
  };
  return chain;
}

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => {
      const chain = buildChain();
      return chain;
    }),
  })),
}));

import { anonymizeUser } from "@/lib/user-deletion";

describe("User Deletion Lifecycle", () => {
  let mockFrom: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockFrom = vi.fn();
  });

  it("returns success when user is not found in DB", async () => {
    const mockDb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({
              data: null,
              error: { code: "PGRST116" }, // no rows
            })),
          })),
        })),
        delete: vi.fn(() => ({ eq: vi.fn(() => ({})) })),
        update: vi.fn(() => ({ eq: vi.fn(() => ({})) })),
      })),
    } as unknown as Parameters<typeof anonymizeUser>[0];

    const result = await anonymizeUser(mockDb, "clerk_nonexistent");
    expect(result.success).toBe(true);
    expect(result.alreadyDeleted).toBe(false);
  });

  it("returns success (alreadyDeleted) when user was already anonymized", async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === "users") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => ({
                  data: { id: "user-123", deleted_at: "2026-01-01T00:00:00Z" },
                  error: null,
                })),
              })),
            })),
            update: vi.fn(() => ({ eq: vi.fn(() => ({})) })),
          };
        }
        return {
          delete: vi.fn(() => ({ eq: vi.fn(() => ({})) })),
          update: vi.fn(() => ({ eq: vi.fn(() => ({})) })),
          select: vi.fn(() => ({ eq: vi.fn(() => ({ data: [] })) })),
        };
      }),
    } as unknown as Parameters<typeof anonymizeUser>[0];

    const result = await anonymizeUser(mockDb, "clerk_already_deleted");
    expect(result.success).toBe(true);
    expect(result.alreadyDeleted).toBe(true);
  });

  it("anonymizes user and purges content on first call (idempotent — second call is no-op)", async () => {
    let callCount = 0;
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === "users") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => {
                  callCount++;
                  if (callCount === 1) {
                    return {
                      data: { id: "user-abc", deleted_at: null },
                      error: null,
                    };
                  }
                  return {
                    data: { id: "user-abc", deleted_at: "2026-08-26T00:00:00Z" },
                    error: null,
                  };
                }),
              })),
            })),
            update: vi.fn((data: Record<string, unknown>) => ({
              eq: vi.fn(() => {
                if (data.email && String(data.email).startsWith("deleted_")) {
                  expect(data.name).toBeNull();
                  expect(data.username).toBeNull();
                  expect(data.deleted_at).toBeDefined();
                }
                return {};
              }),
            })),
          };
        }
        // Generic table mock with full chain support
        const chain = {
          delete: vi.fn(() => chain),
          update: vi.fn(() => chain),
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          in: vi.fn(() => chain),
          single: vi.fn(() => ({ data: [], error: null })),
        };
        return chain;
      }),
    } as unknown as Parameters<typeof anonymizeUser>[0];

    // First call — should anonymize
    const result1 = await anonymizeUser(mockDb, "clerk_abc");
    expect(result1.success).toBe(true);
    expect(result1.alreadyDeleted).toBe(false);

    // Second call (duplicate webhook) — should be idempotent no-op
    const result2 = await anonymizeUser(mockDb, "clerk_abc");
    expect(result2.success).toBe(true);
    expect(result2.alreadyDeleted).toBe(true);
  });

  it("retains billing tables (does not delete from transactions, credit_ledger, audit_events)", async () => {
    const deletedTables: string[] = [];
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === "users") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => ({
                  data: { id: "user-billing", deleted_at: null },
                  error: null,
                })),
              })),
            })),
            update: vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) })),
          };
        }
        const chain = {
          delete: vi.fn(() => {
            deletedTables.push(table);
            return chain;
          }),
          update: vi.fn(() => chain),
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          in: vi.fn(() => chain),
          single: vi.fn(() => ({ data: [], error: null })),
        };
        return chain;
      }),
    } as unknown as Parameters<typeof anonymizeUser>[0];

    await anonymizeUser(mockDb, "clerk_billing");

    // Verify billing/legal tables are NOT in the purge list
    const retainedTables = [
      "transactions",
      "subscriptions",
      "creator_earnings",
      "credit_ledger",
      "credit_reservations",
      "audit_events",
      "llm_usage_records",
      "creator_payout_ledger",
    ];
    for (const retained of retainedTables) {
      expect(deletedTables).not.toContain(retained);
    }
  });
});
