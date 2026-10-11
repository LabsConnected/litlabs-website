// @vitest-environment node
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fixtures = vi.hoisted(() => ({ normalCount: 1 }));
type Row = Record<string, unknown>;
function from(table: string) {
  let rows: Row[] = table === "studio_projects"
    ? [...Array.from({ length: fixtures.normalCount }, (_, index) => ({
        id: `normal-${index}`, user_id: "clerk-owner", name: `Normal ${index}`,
        slug: `normal-${index}`, is_system: false, source_type: "blank",
        github_repository_id: null, created_at: "2026-01-01", updated_at: "2026-01-01",
      })), { id: "global", user_id: "clerk-owner", is_system: true, system_type: "global_litt" }]
    : table === "users" ? [{ id: "database-owner", clerk_id: "clerk-owner", role: "owner" }]
    : table === "subscriptions" ? [{ user_id: "database-owner", plan: "starter", status: "active" }]
    : [];
  const chain = {
    select: () => chain,
    eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return chain; },
    order: () => chain,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (result: { data: Row[]; count: number; error: null }) => unknown) => resolve({ data: rows, count: rows.length, error: null }),
  };
  return chain;
}
vi.mock("@/lib/auth", () => ({ auth: async () => ({ userId: "clerk-owner" }) }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from }, getSupabaseAdmin: () => ({ from }) }));
vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => ({ from }) }));
vi.mock("@/lib/owner", () => ({ isOwnerClerkId: () => true, OWNER_BILLING_EXEMPT: true, OWNER_SPEND_CEILING_USD: 250 }));
vi.mock("@/lib/wallet-ledger", () => ({ getCreditBalances: async () => ({ monthly: 0, purchased: 0, betaPromotional: 0, total: 0 }) }));
import { listProjects } from "@/lib/projects/project-repository";
import { getProfileStats } from "@/lib/profile-stats";
import { GET as ownerSetup } from "@/app/api/owner/setup/route";
import { GET as projectList } from "@/app/api/studio-projects/route";
import { PLAN_ENTITLEMENTS } from "@/config/plan-entitlements";

it.each(["starter", "creator_beta", "pro_builder_beta"] as const)("system workspace consumes zero normal count at the %s project limit", async plan => {
  const limit = PLAN_ENTITLEMENTS[plan].activeProjectLimit;
  fixtures.normalCount = limit;
  const result = await listProjects("clerk-owner");
  expect(result.projects).toHaveLength(limit);
  expect(result.legacyOnly).toEqual([]);
  expect(result.projects.map(project => project.id)).not.toContain("global");
  expect((await getProfileStats("database-owner", "clerk-owner"))?.projects).toBe(limit);
  const owner = await ownerSetup(new NextRequest("http://localhost/api/owner/setup"));
  expect(owner.status).toBe(200);
  expect((await owner.json()).projects.count).toBe(limit);
  const response = await projectList(new NextRequest("http://localhost/api/studio-projects"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.projects).toHaveLength(limit);
  expect(body.projects.map((project: { id: string }) => project.id)).not.toContain("global");
});
