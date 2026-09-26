// Guards the honesty invariant against the REAL registry: as long as no
// capability has an execute function, every marketplace item must report
// installable: false. If someone adds an executor to the real registry,
// this test fails loudly — which is the intended signal that the page can
// start showing Install buttons for that capability.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: vi.fn() },
  // No Supabase env in tests: the rate limiter falls back to in-process.
  getSupabaseAdmin: () => null,
}));

import { supabaseAdmin } from "@/lib/supabase";
import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";

function mockSupabaseItems(data: unknown[]) {
  const query: Record<string, unknown> = {};
  for (const name of ["select", "order", "eq", "contains"]) {
    query[name] = vi.fn(() => query);
  }
  query.then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
  vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);
}

describe("marketplace installable vs the real capability registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no registry entry has an execute function today", () => {
    const withExecutor = Object.entries(CAPABILITY_REGISTRY)
      .filter(([, def]) => typeof def.execute === "function")
      .map(([key]) => key);
    expect(withExecutor).toEqual([]);
  });

  it("returns installable: false for items keyed to every real capability", async () => {
    const keys = Object.keys(CAPABILITY_REGISTRY);
    expect(keys.length).toBeGreaterThan(0);
    mockSupabaseItems(keys.map((k, i) => ({ id: String(i), name: k, capability_key: k })));

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost:3000/api/marketplace/items"));
    const body = await res.json();

    expect(body.items).toHaveLength(keys.length);
    for (const item of body.items) {
      expect(item.installable).toBe(false);
    }
  });
});
