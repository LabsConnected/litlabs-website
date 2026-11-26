import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "./fake-supabase.testkit";
import { acquireLeaderLease, sentinelHolderId, LEADER_LEASE_TTL_MS } from "./leader";

const TABLE = "sentinel_leader";

function asClient(fake: ReturnType<typeof createFakeSupabase>) {
  return fake.client as unknown as SupabaseClient;
}

describe("acquireLeaderLease", () => {
  it("acquires a free lease and renews it for the same holder", async () => {
    const fake = createFakeSupabase();
    const c = asClient(fake);
    const first = await acquireLeaderLease(c);
    expect(first.kind).toBe("acquired");

    const second = await acquireLeaderLease(c);
    expect(second.kind).toBe("acquired"); // same process holder renews

    const row = fake.tables[TABLE][0];
    expect(row.holder).toBe(sentinelHolderId());
    expect(Date.parse(row.leased_until)).toBeGreaterThan(Date.now());
  });

  it("reports held-by-other when a live lease belongs to another replica", async () => {
    const fake = createFakeSupabase({
      [TABLE]: [
        {
          id: "leader",
          holder: "other-replica",
          leased_until: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    });
    const result = await acquireLeaderLease(asClient(fake));
    expect(result.kind).toBe("held-by-other");
  });

  it("takes over an expired lease (crashed leader recovery)", async () => {
    const fake = createFakeSupabase({
      [TABLE]: [
        {
          id: "leader",
          holder: "dead-replica",
          leased_until: new Date(Date.now() - 1000).toISOString(),
        },
      ],
    });
    const result = await acquireLeaderLease(asClient(fake));
    expect(result.kind).toBe("acquired");
    expect(fake.tables[TABLE][0].holder).toBe(sentinelHolderId());
  });

  it("lease TTL covers several probe intervals", () => {
    expect(LEADER_LEASE_TTL_MS).toBeGreaterThanOrEqual(3 * 60_000);
  });

  it("falls back to unmanaged when the table is unreachable", async () => {
    const throwing = {
      from() {
        throw new Error("relation does not exist");
      },
    } as unknown as SupabaseClient;
    const result = await acquireLeaderLease(throwing);
    expect(result.kind).toBe("unmanaged");
    expect((await acquireLeaderLease(null)).kind).toBe("unmanaged");
  });
});
