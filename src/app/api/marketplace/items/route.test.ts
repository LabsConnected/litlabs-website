// installable is computed server-side from the capability registry:
// true only when the capability has a real execute function.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Test-local registry: one entry WITH an executor, one without, and no
// entry at all for "nope.missing". The real registry is never modified.
vi.mock("@/lib/capability-registry", () => ({
  CAPABILITY_REGISTRY: {
    "test.has_executor": {
      key: "test.has_executor",
      assistant: "litt",
      status: "available",
      requiredConnections: [],
      requiredPermissions: [],
      execute: async () => ({ success: true }),
    },
    "test.no_executor": {
      key: "test.no_executor",
      assistant: "litt",
      status: "available",
      requiredConnections: [],
      requiredPermissions: [],
    },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: vi.fn() },
  // No Supabase env in tests: the rate limiter falls back to in-process.
  getSupabaseAdmin: () => null,
}));

import { supabaseAdmin } from "@/lib/supabase";

const DB_ITEMS = [
  { id: "1", name: "Has Executor", capability_key: "test.has_executor" },
  { id: "2", name: "No Executor", capability_key: "test.no_executor" },
  { id: "3", name: "Unknown Key", capability_key: "nope.missing" },
  { id: "4", name: "Null Key", capability_key: null },
];

function mockSupabaseItems(data: unknown[] | null, error: unknown = null) {
  const query: Record<string, unknown> = {};
  const chain = (name: string) => {
    query[name] = vi.fn(() => query);
  };
  for (const name of ["select", "order", "eq", "contains"]) chain(name);
  // The route awaits the query builder directly, so make it thenable.
  query.then = (resolve: (v: unknown) => void) => resolve({ data, error });
  vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);
  return query;
}

async function getItems(url = "http://localhost:3000/api/marketplace/items") {
  const { GET } = await import("./route");
  const res = await GET(new NextRequest(url));
  const body = await res.json();
  return { res, body };
}

describe("/api/marketplace/items installable flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseItems(DB_ITEMS);
  });

  it("marks installable true only for the capability with an execute fn", async () => {
    const { body } = await getItems();
    const byId = Object.fromEntries(body.items.map((i: { id: string }) => [i.id, i]));
    expect(byId["1"].installable).toBe(true);
    expect(byId["2"].installable).toBe(false);
    expect(byId["3"].installable).toBe(false);
    expect(byId["4"].installable).toBe(false);
    expect(body.total).toBe(4);
  });

  it("keeps the original item fields alongside installable", async () => {
    const { body } = await getItems();
    expect(body.items[0]).toMatchObject({ id: "1", name: "Has Executor" });
  });

  it("still applies category/type/assistant filters", async () => {
    const query = mockSupabaseItems(DB_ITEMS);
    await getItems("http://localhost:3000/api/marketplace/items?category=development&type=tool&assistant=litt");
    expect(query.eq as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("category", "development");
    expect(query.eq as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("item_type", "tool");
    expect(query.contains as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("compatible_assistants", ["litt"]);
  });

  it("returns 500 when the database errors", async () => {
    mockSupabaseItems(null, new Error("db down"));
    const { res, body } = await getItems();
    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to fetch marketplace items");
  });

  it("returns an empty list when the table is empty", async () => {
    mockSupabaseItems([]);
    const { body } = await getItems();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });
});
