import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf-8");
}

describe("Global LiTT hidden system project architecture", () => {
  it("stores Global LiTT outside normal studio_projects", () => {
    const migration = read("supabase/migrations/20261003230000_global_litt_system_project.sql");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.litt_system_projects");
    expect(migration).toContain("UNIQUE (owner_id, system_key)");
    expect(migration).toContain("CHECK (system_key IN ('global_litt'))");
    expect(migration).toContain("ALTER TABLE public.litt_system_projects ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FOR ALL TO service_role");
    expect(migration).not.toContain("ALTER TABLE public.studio_projects");
  });

  it("creates one owner-scoped global_litt project and handles insert races", () => {
    const source = read("src/lib/litt/system-project.ts");

    expect(source).toContain('GLOBAL_LITT_SYSTEM_KEY = "global_litt"');
    expect(source).toContain('.eq("owner_id", ownerId)');
    expect(source).toContain('.eq("system_key", GLOBAL_LITT_SYSTEM_KEY)');
    expect(source).toContain('error?.code === "23505"');
  });

  it("uses the hidden project instead of creating visible LiTT Chat projects", () => {
    const route = read("src/app/api/studio/conversations/route.ts");

    expect(route).toContain("getOrCreateGlobalLittSystemProject(userId)");
    expect(route).not.toContain("createBlankProject");
    expect(route).not.toContain("listProjects(userId)");
    expect(route).not.toContain('name: "LiTT Chat"');
  });

  it("resolves system projects only by authenticated owner", () => {
    const resolver = read("src/lib/studio/project-resolver.ts");

    expect(resolver).toContain('.from("litt_system_projects")');
    expect(resolver).toContain('.eq("id", projectId)');
    expect(resolver).toContain('.eq("owner_id", clerkUserId)');
    expect(resolver).toContain('.eq("system_key", GLOBAL_LITT_SYSTEM_KEY)');
  });

  it("binds authenticated global companion runs to the hidden project", () => {
    const context = read("src/lib/litt-runtime/request-context.ts");

    expect(context).toContain("userId && isCompanionSurface && !effectiveProjectId");
    expect(context).toContain("getOrCreateGlobalLittSystemProject(userId)");
    expect(context).toContain("conversation?.projectId === effectiveProjectId");
    expect(context).toContain("project?.projectId ?? effectiveProjectId ?? null");
  });
});
