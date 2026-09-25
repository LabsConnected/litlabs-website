/**
 * profile-stats.test.ts — honest profile counters.
 *
 * Regression test: profile stats must come from the database, never from
 * hardcoded placeholders. Covers the count queries, the fail-soft null,
 * and the compact number formatting.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClient = {
  from: vi.fn(),
};

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => mockClient,
}));

import { getProfileStats, formatStatCount } from "./profile-stats";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getProfileStats", () => {
  it("returns real counts from the four tables", async () => {
    const counts = [3, 7, 12, 2];
    let i = 0;
    mockClient.from.mockImplementation(() => ({
      select: () => ({ eq: () => Promise.resolve({ count: counts[i++], error: null }) }),
    }));

    const stats = await getProfileStats("db-user-1", "clerk-user-1");
    expect(stats).toEqual({ followers: 3, following: 7, posts: 12, projects: 2 });

    const tables = mockClient.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(tables).toEqual(["follows", "follows", "posts", "studio_projects"]);
  });

  it("scopes follows to the db user id and projects to the clerk id", async () => {
    const eqCalls: Array<[string, string]> = [];
    mockClient.from.mockImplementation(() => ({
      select: () => ({
        eq: (col: string, val: string) => {
          eqCalls.push([col, val]);
          return Promise.resolve({ count: 0, error: null });
        },
      }),
    }));

    await getProfileStats("db-user-9", "clerk-user-9");
    expect(eqCalls).toContainEqual(["followee_id", "db-user-9"]);
    expect(eqCalls).toContainEqual(["follower_id", "db-user-9"]);
    expect(eqCalls).toContainEqual(["user_id", "db-user-9"]); // posts
    expect(eqCalls).toContainEqual(["user_id", "clerk-user-9"]); // studio_projects
  });

  it("returns null (fail-soft) when any count query errors", async () => {
    let i = 0;
    mockClient.from.mockImplementation(() => ({
      select: () => ({
        eq: () =>
          Promise.resolve(
            i++ === 2 ? { count: null, error: { message: "boom" } } : { count: 1, error: null },
          ),
      }),
    }));

    await expect(getProfileStats("db-user-1", "clerk-user-1")).resolves.toBeNull();
  });

  it("returns null when the client throws", async () => {
    mockClient.from.mockImplementation(() => {
      throw new Error("no db");
    });
    await expect(getProfileStats("db-user-1", "clerk-user-1")).resolves.toBeNull();
  });
});

describe("formatStatCount", () => {
  it("formats small numbers as-is", () => {
    expect(formatStatCount(0)).toBe("0");
    expect(formatStatCount(7)).toBe("7");
    expect(formatStatCount(999)).toBe("999");
  });

  it("compacts thousands and millions without fabricating precision", () => {
    expect(formatStatCount(1000)).toBe("1K");
    expect(formatStatCount(2400)).toBe("2.4K");
    expect(formatStatCount(22000)).toBe("22K");
    expect(formatStatCount(1500000)).toBe("1.5M");
  });

  it("returns a dash for unknown/invalid input", () => {
    expect(formatStatCount(-1)).toBe("—");
    expect(formatStatCount(NaN)).toBe("—");
  });
});
