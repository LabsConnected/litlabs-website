// @vitest-environment node
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/auth", () => ({ auth: async () => ({ userId: "owner" }) }));
vi.mock("@/lib/deployments/deployment-store", () => ({ listLatestDeploymentsForUser: async () => [
  { id: "normal-site", projectId: "normal", status: "ready", urlVerified: true },
  { id: "system-site", projectId: "system", status: "ready", urlVerified: true },
] }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (table: string) => {
  let rows: any[] = table === "studio_projects" ? [{ id: "normal", name: "Normal", user_id: "owner", is_system: false },{ id: "system", name: "Global", user_id: "owner", is_system: true }] : [{ id: "normal-deploy", user_id: "owner", integration_project_id: "normal" },{ id: "system-deploy", user_id: "owner", integration_project_id: "system" }];
  const chain: any = { select: () => chain, eq: (key: string,value: unknown) => { rows=rows.filter(row => row[key]===value); return chain; }, in: (key: string,values: unknown[]) => { rows=rows.filter(row => values.includes(row[key])); return chain; }, order: () => chain, limit: () => chain, then: (resolve: any) => resolve({ data: rows, error: null }) };
  return chain;
} } }));
import { GET } from "@/app/api/deployments/route";
it("removes system deployments and published sites, not only names", async () => {
  const response = await GET(new NextRequest("http://localhost/api/deployments"));
  expect(response.status).toBe(200);
  const result=await response.json();
  expect(result.deployments.map((row: any) => row.id)).toEqual(["normal-deploy"]);
  expect(result.count).toBe(1);
  expect(result.sites.map((row: any) => row.id)).toEqual(["normal-site"]);
});
