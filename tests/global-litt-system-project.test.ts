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
    expect(migration).toContain("primary_conversation_id uuid");
    expect(migration).toContain("REFERENCES public.studio_conversations(id) ON DELETE SET NULL");
    expect(migration).toContain("UNIQUE (primary_conversation_id)");
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
    expect(source).toContain("claimGlobalLittPrimaryConversation");
    expect(source).toContain('.is("primary_conversation_id", null)');
  });

  it("owns one race-safe persistent primary conversation", () => {
    const source = read("src/lib/litt/global-conversation.ts");

    expect(source).toContain("getOrCreateGlobalLittConversation");
    expect(source).toContain("systemProject.primaryConversationId");
    expect(source).toContain("claimGlobalLittPrimaryConversation");
    expect(source).toContain("archiveConversation(candidate.id, ownerId)");
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

  it("binds authenticated global companion runs to the hidden project and rejects forged scope", () => {
    const context = read("src/lib/litt-runtime/request-context.ts");

    expect(context).toContain("userId && isCompanionSurface && !effectiveProjectId");
    expect(context).toContain("getOrCreateGlobalLittSystemProject(userId)");
    expect(context).toContain("projectScopeRejected = true");
    expect(context).toContain("projectScopeRejected = !project");
    expect(context).toContain("!projectScopeRejected && (");
    expect(context).toContain("conversation?.projectId === effectiveProjectId");
    expect(context).toContain("m.clientRequestId !== req.clientRequestId");
    expect(context).toContain("!projectScopeRejected ? effectiveProjectId : null");
  });

  it("claims Global LiTT idempotency before any provider execution", () => {
    const route = read("src/app/api/litt/global/route.ts");

    expect(route).toContain("getOrCreateGlobalLittConversation(userId)");
    expect(route).toContain('item.clientRequestId === clientRequestId');
    expect(route).toContain('"try_increment_conversation_revision"');
    expect(route).toContain('status: "completed"');
    expect(route).toContain("assistantLockId(clientRequestId)");
    expect(route).toContain('status: "streaming"');
    expect(route).toContain("if (assistantInsert.duplicate)");
    expect(route).toContain("runLiTT({");
    expect(route).toContain('surface: "global_companion"');
    expect(route).toContain("updateMessageStatus(");

    expect(route.indexOf('role: "user"')).toBeLessThan(route.indexOf("runLiTT({"));
    expect(route.indexOf("assistantLockId(clientRequestId)")).toBeLessThan(route.indexOf("runLiTT({"));
  });
});
