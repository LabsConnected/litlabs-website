// @vitest-environment node
/**
 * GHL Affiliate Tracking — atomic claim idempotency tests.
 *
 * Tests:
 *   1. New user → lead tracked exactly once
 *   2. Existing user (already tracked) → no duplicate lead (replay)
 *   3. User with no am_id → tracked without attribution (no false affiliate)
 *   4. GHL API failure → user reset to untracked (can retry)
 *   5. Server endpoint rejects unauthenticated requests
 *   6. am_id validation: rejects invalid charset / too long / empty
 *   7. Concurrency: 10 simultaneous requests → GHL called exactly once
 *   8. Stale processing recovery: stuck `processing` → reset to untracked
 *   9. Atomic claim: second request sees `processing` → returns in_progress
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
const { mockGetSupabaseAdmin } = vi.hoisted(() => ({ mockGetSupabaseAdmin: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: mockGetSupabaseAdmin,
}));

// ─── Supabase mock with atomic claim simulation ─────────────────────────────
//
// The mock simulates the atomic conditional UPDATE behavior:
// claimTracking() only succeeds if state === 'untracked'.
// Once claimed, state transitions to 'processing' in the mock store,
// so subsequent claims fail (0 rows updated).

interface MockUserRow {
  ghl_tracking_state: string;
  ghl_tracking_started_at: string | null;
  ghl_lead_tracked: boolean;
  ghl_am_id: string | null;
  ghl_lead_tracked_at: string | null;
}

function createAtomicSupabaseMock(opts: {
  initialState?: string;
  startedAt?: string | null;
  updateError?: { message: string } | null;
}) {
  // In-memory user row that simulates the DB state
  const userRow: MockUserRow = {
    ghl_tracking_state: opts.initialState ?? "untracked",
    ghl_tracking_started_at: opts.startedAt ?? null,
    ghl_lead_tracked: false,
    ghl_am_id: null,
    ghl_lead_tracked_at: null,
  };

  // Track the WHERE conditions on updates to simulate conditional updates
  const updateWheres: Record<string, string>[] = [];

  const selectChain = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: userRow as unknown as Record<string, unknown>,
      error: null,
    }),
  };

  const updateChain = {
    eq: vi.fn().mockImplementation((col: string, val: string) => {
      // Track the where conditions
      updateWheres.push({ [col]: val });
      return updateChain;
    }),
    select: vi.fn().mockImplementation((cols: string) => {
      // Simulate conditional UPDATE returning rows only if the WHERE
      // condition on ghl_tracking_state matches the current state.
      const stateCondition = updateWheres.find((w) => w.ghl_tracking_state);
      const expectedState = stateCondition?.ghl_tracking_state;

      // The update has already been "applied" conceptually — check if
      // the condition would have matched BEFORE the update.
      // We need to capture this BEFORE the update modifies state.

      // For claimTracking: WHERE state='untracked' — succeeds if currently untracked
      // For markTracked: no state condition — always succeeds
      // For markFailedRetryable: WHERE state='processing' — succeeds if currently processing

      if (expectedState !== undefined) {
        // This is a conditional update — check if condition matched
        // BEFORE we look at what the update set.
        // But we already set the values... we need to check the PREVIOUS state.
        // The mock is simplified: we check if the condition matches the state
        // that was present when the update was called.
        // Since we can't time-travel, we rely on the test flow:
        // - claimTracking sets state='processing' WHERE state='untracked'
        //   → if state was 'untracked', returns [row], state becomes 'processing'
        //   → if state was NOT 'untracked', returns [], state unchanged
        // We handle this via the _pendingUpdate mechanism below.
        return {
          data: _lastUpdateClaimed ? [{ id: "row-1" }] : [],
          error: null,
        };
      }

      // No state condition — unconditional update (markTracked)
      return {
        data: [{ id: "row-1" }],
        error: null,
      };
    }),
    data: null as unknown,
    error: null as unknown,
  };

  // Track whether the last conditional update claimed the row
  let _lastUpdateClaimed = false;

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === "users") {
      return {
        select: vi.fn().mockReturnValue(selectChain),
        update: vi.fn().mockImplementation((updates: Record<string, unknown>) => {
          updateWheres.length = 0; // reset for this update call

          // Check conditional update for claimTracking
          const stateAfterUpdate = updates.ghl_tracking_state as string;

          // We need to check the WHERE condition AFTER eq() is called.
          // But eq() is chained after update(). So we defer the claim check
          // to the select() call which comes after eq().
          //
          // For now, record the intended updates and check in select().

          // Special handling: if updating to 'processing', check if currently 'untracked'
          if (stateAfterUpdate === "processing") {
            // claimTracking: only succeeds if currently 'untracked'
            _lastUpdateClaimed = userRow.ghl_tracking_state === "untracked";
            if (_lastUpdateClaimed) {
              // Apply the update
              userRow.ghl_tracking_state = "processing";
              userRow.ghl_tracking_started_at = updates.ghl_tracking_started_at as string;
            }
          } else if (stateAfterUpdate === "tracked") {
            // markTracked: unconditional (no state WHERE in the real code for this path)
            userRow.ghl_tracking_state = "tracked";
            userRow.ghl_lead_tracked = true;
            if (updates.ghl_am_id !== undefined) userRow.ghl_am_id = updates.ghl_am_id as string;
            if (updates.ghl_lead_tracked_at) userRow.ghl_lead_tracked_at = updates.ghl_lead_tracked_at as string;
            if (updates.ghl_tracking_started_at === null) userRow.ghl_tracking_started_at = null;
            _lastUpdateClaimed = true;
          } else if (stateAfterUpdate === "untracked") {
            // markFailedRetryable: WHERE state='processing'
            // The eq() for ghl_tracking_state='processing' will be called next.
            // We check if currently 'processing'.
            _lastUpdateClaimed = userRow.ghl_tracking_state === "processing";
            if (_lastUpdateClaimed) {
              userRow.ghl_tracking_state = "untracked";
              userRow.ghl_tracking_started_at = null;
            }
          }

          if (opts.updateError) {
            updateChain.error = opts.updateError;
            updateChain.data = null;
          }

          return updateChain;
        }),
      };
    }
    return {};
  });

  // Expose the userRow for test assertions
  return { from, userRow, _getClaimed: () => _lastUpdateClaimed };
}

// ─── GHL API mock ────────────────────────────────────────────────────────────

const originalFetch = global.fetch;

function mockGhlFetch(success: boolean, delayMs = 0) {
  global.fetch = vi.fn().mockImplementation(async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return {
      ok: success,
      status: success ? 200 : 500,
      text: async () => (success ? "OK" : "Server error"),
    };
  }) as unknown as typeof fetch;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockAuth.mockResolvedValue({ userId: "test-clerk-id" });
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ─── Basic idempotency tests ────────────────────────────────────────────────

describe("GHL Affiliate Tracking — atomic claim idempotency", () => {
  it("tracks a new user exactly once", async () => {
    const supabase = createAtomicSupabaseMock({ initialState: "untracked" });
    mockGetSupabaseAdmin.mockReturnValue(supabase);
    mockGhlFetch(true);

    const { trackLeadIdempotent } = await import("@/lib/ghl-affiliate");

    const result = await trackLeadIdempotent({
      clerkId: "test-clerk-id",
      email: "newuser@example.com",
      firstName: "New",
      lastName: "User",
      amId: "aff-123",
    });

    expect(result.tracked).toBe(true);
    expect(result.replayed).toBe(false);

    // GHL API was called exactly once
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // DB state is now 'tracked'
    expect(supabase.userRow.ghl_tracking_state).toBe("tracked");
    expect(supabase.userRow.ghl_lead_tracked).toBe(true);
    expect(supabase.userRow.ghl_am_id).toBe("aff-123");
  });

  it("does NOT re-track an existing user (replay)", async () => {
    const supabase = createAtomicSupabaseMock({
      initialState: "tracked",
      startedAt: null,
    });
    // Set up the row as already tracked
    supabase.userRow.ghl_lead_tracked = true;
    supabase.userRow.ghl_am_id = "aff-123";
    mockGetSupabaseAdmin.mockReturnValue(supabase);
    mockGhlFetch(true);

    const { trackLeadIdempotent } = await import("@/lib/ghl-affiliate");

    const result = await trackLeadIdempotent({
      clerkId: "test-clerk-id",
      email: "existing@example.com",
      firstName: "Existing",
      lastName: "User",
      amId: "aff-123",
    });

    expect(result.tracked).toBe(true);
    expect(result.replayed).toBe(true);
    expect(result.reason).toBe("already_tracked");

    // GHL API was NOT called — already tracked
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("tracks without am_id (no false attribution)", async () => {
    const supabase = createAtomicSupabaseMock({ initialState: "untracked" });
    mockGetSupabaseAdmin.mockReturnValue(supabase);
    mockGhlFetch(true);

    const { trackLeadIdempotent } = await import("@/lib/ghl-affiliate");

    const result = await trackLeadIdempotent({
      clerkId: "test-clerk-id",
      email: "noaffiliate@example.com",
      firstName: "No",
      lastName: "Affiliate",
      amId: null,
    });

    expect(result.tracked).toBe(true);
    expect(result.replayed).toBe(false);

    // Verify the fetch URL does NOT contain am_id
    const fetchCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = fetchCall?.[0] as string;
    expect(url).not.toContain("am_id");
  });

  it("does NOT mark as tracked when GHL API fails (allows retry)", async () => {
    const supabase = createAtomicSupabaseMock({ initialState: "untracked" });
    mockGetSupabaseAdmin.mockReturnValue(supabase);
    mockGhlFetch(false); // GHL returns 500

    const { trackLeadIdempotent } = await import("@/lib/ghl-affiliate");

    const result = await trackLeadIdempotent({
      clerkId: "test-clerk-id",
      email: "retry@example.com",
      amId: "aff-456",
    });

    expect(result.tracked).toBe(false);
    expect(result.replayed).toBe(false);
    expect(result.reason).toContain("500");

    // State should be reset to 'untracked' for retry
    expect(supabase.userRow.ghl_tracking_state).toBe("untracked");
  });

  it("rejects tracking without an email", async () => {
    const supabase = createAtomicSupabaseMock({ initialState: "untracked" });
    mockGetSupabaseAdmin.mockReturnValue(supabase);
    mockGhlFetch(true);

    const { trackLeadIdempotent } = await import("@/lib/ghl-affiliate");

    const result = await trackLeadIdempotent({
      clerkId: "test-clerk-id",
      email: "",
      amId: "aff-789",
    });

    expect(result.tracked).toBe(false);
    expect(result.reason).toContain("Email is required");
  });
});

// ─── am_id validation tests ─────────────────────────────────────────────────

describe("GHL Affiliate Tracking — am_id validation", () => {
  it("accepts a valid alphanumeric am_id", async () => {
    const { sanitizeAmId } = await import("@/lib/ghl-affiliate");
    expect(sanitizeAmId("aff-123_ABC")).toBe("aff-123_ABC");
  });

  it("rejects am_id with special characters", async () => {
    const { sanitizeAmId } = await import("@/lib/ghl-affiliate");
    expect(sanitizeAmId("aff;DROP TABLE")).toBeNull();
    expect(sanitizeAmId("aff<script>")).toBeNull();
    expect(sanitizeAmId("aff'OR'1'='1")).toBeNull();
  });

  it("rejects am_id that is too long", async () => {
    const { sanitizeAmId } = await import("@/lib/ghl-affiliate");
    const longId = "a".repeat(200);
    expect(sanitizeAmId(longId)).toBeNull();
  });

  it("returns null for empty/undefined am_id", async () => {
    const { sanitizeAmId } = await import("@/lib/ghl-affiliate");
    expect(sanitizeAmId("")).toBeNull();
    expect(sanitizeAmId(null)).toBeNull();
    expect(sanitizeAmId(undefined)).toBeNull();
    expect(sanitizeAmId("   ")).toBeNull();
  });
});

// ─── Concurrency test ───────────────────────────────────────────────────────

describe("GHL Affiliate Tracking — concurrency", () => {
  it("fires 10 simultaneous requests and GHL is called exactly once", async () => {
    // This is the critical regression test for the race condition.
    // The atomic claim ensures only one request calls GHL.
    const supabase = createAtomicSupabaseMock({ initialState: "untracked" });
    mockGetSupabaseAdmin.mockReturnValue(supabase);

    // Add a small delay to GHL fetch to increase the chance of overlap
    mockGhlFetch(true, 50);

    const { trackLeadIdempotent } = await import("@/lib/ghl-affiliate");

    // Fire 10 concurrent requests
    const promises = Array.from({ length: 10 }, (_, i) =>
      trackLeadIdempotent({
        clerkId: "test-clerk-id",
        email: `concurrent${i}@example.com`,
        firstName: "Concurrent",
        lastName: `User${i}`,
        amId: "aff-concurrent",
      }),
    );

    const results = await Promise.all(promises);

    // Exactly one should have tracked=true, replayed=false
    const tracked = results.filter((r) => r.tracked && !r.replayed);
    expect(tracked.length).toBe(1);

    // The rest should be replayed (in_progress or lost_race)
    const replayed = results.filter((r) => r.replayed);
    expect(replayed.length).toBe(9);

    // GHL API was called exactly once — the core assertion
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Final DB state is 'tracked'
    expect(supabase.userRow.ghl_tracking_state).toBe("tracked");
  });
});

// ─── Stale processing recovery test ─────────────────────────────────────────

describe("GHL Affiliate Tracking — stale processing recovery", () => {
  it("resets a stuck `processing` record to untracked after timeout", async () => {
    // Simulate a record that's been in `processing` for 10 minutes (stale)
    const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const supabase = createAtomicSupabaseMock({
      initialState: "processing",
      startedAt: staleTime,
    });
    mockGetSupabaseAdmin.mockReturnValue(supabase);
    mockGhlFetch(true);

    const { trackLeadIdempotent } = await import("@/lib/ghl-affiliate");

    const result = await trackLeadIdempotent({
      clerkId: "test-clerk-id",
      email: "stale@example.com",
      amId: "aff-stale",
    });

    // The stale processing should have been detected, reset to untracked,
    // then claimed and tracked successfully.
    expect(result.tracked).toBe(true);
    expect(result.replayed).toBe(false);

    // GHL was called (because stale processing was reset)
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Final state is tracked
    expect(supabase.userRow.ghl_tracking_state).toBe("tracked");
  });

  it("does NOT reset a recent `processing` record (still in progress)", async () => {
    // Simulate a record that's been in `processing` for only 30 seconds
    const recentTime = new Date(Date.now() - 30 * 1000).toISOString();
    const supabase = createAtomicSupabaseMock({
      initialState: "processing",
      startedAt: recentTime,
    });
    mockGetSupabaseAdmin.mockReturnValue(supabase);
    mockGhlFetch(true);

    const { trackLeadIdempotent } = await import("@/lib/ghl-affiliate");

    const result = await trackLeadIdempotent({
      clerkId: "test-clerk-id",
      email: "inprogress@example.com",
      amId: "aff-recent",
    });

    // Should return in_progress, NOT call GHL
    expect(result.tracked).toBe(false);
    expect(result.replayed).toBe(true);
    expect(result.reason).toBe("in_progress");

    // GHL was NOT called
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─── API endpoint tests ─────────────────────────────────────────────────────

describe("GHL Affiliate Tracking — API endpoint", () => {
  it("rejects unauthenticated requests", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const { POST } = await import("@/app/api/affiliate/track-lead/route");

    const req = new Request("http://localhost/api/affiliate/track-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amId: "test" }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("rejects requests without an email", async () => {
    mockAuth.mockResolvedValue({ userId: "test-clerk-id" });
    const supabase = createAtomicSupabaseMock({ initialState: "untracked" });
    mockGetSupabaseAdmin.mockReturnValue(supabase);

    const { POST } = await import("@/app/api/affiliate/track-lead/route");

    const req = new Request("http://localhost/api/affiliate/track-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amId: "test" }), // no email
    });

    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("sanitizes invalid am_id at the API boundary", async () => {
    mockAuth.mockResolvedValue({ userId: "test-clerk-id" });
    const supabase = createAtomicSupabaseMock({ initialState: "untracked" });
    mockGetSupabaseAdmin.mockReturnValue(supabase);
    mockGhlFetch(true);

    const { POST } = await import("@/app/api/affiliate/track-lead/route");

    const req = new Request("http://localhost/api/affiliate/track-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        amId: "aff;DROP TABLE--", // malicious input
      }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Should have tracked successfully with am_id sanitized to null
    expect(body.tracked).toBe(true);

    // The fetch URL should NOT contain the malicious am_id
    const fetchCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = fetchCall?.[0] as string;
    expect(url).not.toContain("DROP");
    expect(url).not.toContain("am_id");
  });
});
