// @vitest-environment node
/**
 * GET /api/admin/metering-reconciliation — read-only P0 reconciliation report.
 *
 * Asserts the JS aggregation shape over a mocked admin client:
 *   - one row per UTC day x plan x capability
 *   - providerCostMicros sums cost_events (LiTT's real cost, ALL attempts)
 *   - chargedBits sums ledger debits behind BILLABLE events only
 *     (customer consumption)
 *   - marginMicrosModeled = chargedBits * 1000 - providerCostMicros
 *     ($1/1K-bit PRICING MODEL — modeled, never fact)
 *   - multiBillableActions counts logical actions (original_request_id)
 *     with >1 billable usage_event, and flips p0Violation
 *   - non-admin callers get 401
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({ from: mocks.from }),
}));

vi.stubEnv("ADMIN_CLERK_ID", "admin-clerk-1");

const { GET } = await import("./route");

const TODAY = new Date().toISOString().slice(0, 10);
const nowIso = new Date().toISOString();

const usageEvents = [
  {
    usage_event_id: "ue-1",
    user_id: "u-1",
    capability: "llm",
    billable: true,
    original_request_id: "req-A",
    created_at: nowIso,
  },
  {
    // Second billable event for the same logical action — P0 violation.
    usage_event_id: "ue-2",
    user_id: "u-1",
    capability: "llm",
    billable: true,
    original_request_id: "req-A",
    created_at: nowIso,
  },
  {
    usage_event_id: "ue-3",
    user_id: "u-2",
    capability: "browser",
    billable: false,
    original_request_id: "req-B",
    created_at: nowIso,
  },
];

const costEvents = [
  { usage_event_id: "ue-1", provider_cost_micros: 500_000 },
  { usage_event_id: "ue-2", provider_cost_micros: 200_000 },
  { usage_event_id: "ue-3", provider_cost_micros: 100_000 },
];

const ledgerDebits = [
  { usage_event_id: "ue-1", amount: 800, direction: "debit" },
  { usage_event_id: "ue-2", amount: 300, direction: "debit" },
];

const subscriptions = [{ user_id: "u-1", plan: "creator", status: "active", updated_at: nowIso }];

// Minimal thenable query builder: every clause returns the builder;
// awaiting (or .then on) it resolves { data, error }.
function query(rows: unknown[]) {
  const q: Record<string, (...args: never[]) => unknown> = {};
  for (const m of ["select", "gte", "order", "range", "in", "eq"]) {
    q[m] = () => q;
  }
  (q as Record<string, unknown>).then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(onFulfilled);
  return q;
}

function mockDb() {
  mocks.from.mockImplementation((table: string) => {
    if (table === "usage_events") return query(usageEvents);
    if (table === "subscriptions") return query(subscriptions);
    if (table === "cost_events") return query(costEvents);
    if (table === "credit_ledger") return query(ledgerDebits);
    return query([]);
  });
}

function request(): NextRequest {
  return new NextRequest("http://localhost/api/admin/metering-reconciliation", {
    method: "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "admin-clerk-1" });
  mockDb();
});

describe("GET /api/admin/metering-reconciliation", () => {
  it("rejects non-admin callers with 401", async () => {
    mocks.auth.mockResolvedValue({ userId: "someone-else" });
    const res = await GET(request());
    expect(res.status).toBe(401);
  });

  it("aggregates cost vs consumption and flags P0 violations", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.windowDays).toBe(30);
    expect(body.p0Violations).toBe(1);

    const llmRow = body.rows.find(
      (r: { day: string; plan: string; capability: string }) =>
        r.day === TODAY && r.plan === "creator" && r.capability === "llm",
    );
    expect(llmRow).toBeDefined();
    expect(llmRow.usageEvents).toBe(2);
    expect(llmRow.billableUsageEvents).toBe(2);
    expect(llmRow.costEvents).toBe(2);
    // Real cost: every provider attempt, billable or not.
    expect(llmRow.providerCostMicros).toBe(700_000);
    // Consumption: charged bits behind billable events only.
    expect(llmRow.chargedBits).toBe(1100);
    // $1/1K-bit pricing model: 1100 bits * 1000 - 700_000.
    expect(llmRow.marginMicrosModeled).toBe(400_000);
    // req-A has 2 billable events -> one violating action.
    expect(llmRow.multiBillableActions).toBe(1);
    expect(llmRow.p0Violation).toBe(true);

    const browserRow = body.rows.find(
      (r: { day: string; plan: string; capability: string }) =>
        r.day === TODAY && r.plan === "starter" && r.capability === "browser",
    );
    expect(browserRow).toBeDefined();
    // u-2 has no subscription -> 'starter' fallback.
    expect(browserRow.plan).toBe("starter");
    expect(browserRow.usageEvents).toBe(1);
    expect(browserRow.billableUsageEvents).toBe(0);
    expect(browserRow.providerCostMicros).toBe(100_000);
    // Failed/non-billable event contributes cost but no charged bits.
    expect(browserRow.chargedBits).toBe(0);
    expect(browserRow.multiBillableActions).toBe(0);
    expect(browserRow.p0Violation).toBe(false);

    expect(body.totals).toMatchObject({
      usageEvents: 3,
      billableUsageEvents: 2,
      costEvents: 3,
      providerCostMicros: 800_000,
      chargedBits: 1100,
      marginMicrosModeled: 300_000,
    });
  });
});
