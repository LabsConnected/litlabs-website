// @vitest-environment node
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const fixture = vi.hoisted(() => ({ id: "system", user_id: "owner", is_system: true, name: "Global" }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ userId: "owner" }) }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (table: string) => {
  let rows = table === "studio_projects" ? [fixture] : [];
  const chain: any = { select: () => chain, eq: (key: string,value: unknown) => { rows = rows.filter(row => (row as any)[key] === value); return chain; }, in: () => chain, lt: () => chain, update: () => chain, delete: () => chain, single: () => Promise.resolve({ data: rows[0] ?? null }), maybeSingle: () => Promise.resolve({ data: rows[0] ?? null }), then: (resolve: any) => resolve({ data: rows[0] ?? null }) };
  return chain;
} } }));
import { GET, PATCH, DELETE } from "@/app/api/studio-projects/[projectId]/route";
import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";
import { resolveProject } from "@/lib/studio/project-resolver";
import { getBusinessProfileForProject, saveBusinessProfileForProject } from "@/lib/business-profile-server";
it("rejects owned system ID through ordinary GET, rename and delete", async () => {
  const context = { params: Promise.resolve({ projectId: "system" }) };
  expect((await GET(new NextRequest("http://localhost/api/studio-projects/system"), context)).status).toBe(404);
  expect((await PATCH(new NextRequest("http://localhost/api/studio-projects/system", { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) }), context)).status).toBe(404);
  expect((await DELETE(new NextRequest("http://localhost/api/studio-projects/system", { method: "DELETE" }), context)).status).toBe(404);
});
it("rejects explicit normal resolution and project profile paths", async () => {
  expect(await resolveCurrentProject({ userId: "owner", explicitProjectId: "system" })).toBeNull();
  expect(await resolveProject("owner", "system")).toBeNull();
  expect(await getBusinessProfileForProject("system", "owner")).toBeNull();
  expect(await saveBusinessProfileForProject("system", "owner", {})).toBeNull();
});

import { updateProjectWorkspace, updateProjectRuntime, updateProjectWorkspaceType, claimProvisioningLock, recoverStaleProvisioning, ensureCanonicalStudioProject, verifyProjectWorkspace } from "@/lib/projects/project-repository";
it("rejects workspace, runtime, provisioning and workspace-type mutations", async () => {
  expect(await updateProjectWorkspace("system", "owner", { workspaceStatus: "ready" })).toBeNull();
  expect(await updateProjectRuntime("system", "owner", { runtimeStatus: "ready" })).toBeNull();
  expect(await updateProjectWorkspaceType("system", "owner", "developer")).toBeNull();
  expect(await claimProvisioningLock("system", "owner")).toBeNull();
  expect(await recoverStaleProvisioning("system", "owner")).toBe(false);
  await expect(ensureCanonicalStudioProject("system", "owner")).rejects.toThrow("project not found");
  await expect(verifyProjectWorkspace("system", "owner")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  expect(fixture.name).toBe("Global");
});
