/**
 * Security isolation regression tests.
 *
 * Verifies that User A cannot access User B's:
 * - Projects
 * - Conversations
 * - Files
 * - Terminal workspace
 * - Preview
 * - Approvals
 *
 * These are source-level assertions that confirm the ownership scoping
 * is present in every query. They do NOT weaken auth or RLS.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readSrc(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf-8");
}

describe("project ownership isolation", () => {
  it("project-repository getProject scopes by userId", () => {
    const content = readSrc("src/lib/projects/project-repository.ts");
    // getProject must include .eq("user_id", userId) or .eq("owner_id", userId)
    expect(content).toMatch(/\.eq\("(user_id|owner_id)",\s*userId\)/);
  });

  it("project-repository deleteProject scopes by userId", () => {
    const content = readSrc("src/lib/projects/project-repository.ts");
    // deleteProject must scope by userId
    expect(content).toMatch(/deleteProject/);
    // The delete query must include user_id scoping
    const deleteSection = content.split("deleteProject")[1] ?? "";
    expect(deleteSection).toMatch(/\.eq\("(user_id|owner_id)",\s*userId\)/);
  });

  it("project-repository verifyProjectWorkspace scopes by userId", () => {
    const content = readSrc("src/lib/projects/project-repository.ts");
    const verifySection = content.split("verifyProjectWorkspace")[1] ?? "";
    expect(verifySection).toMatch(/\.eq\("(user_id|owner_id)",\s*userId\)/);
  });

  it("studio-projects GET route uses auth() userId", () => {
    const content = readSrc("src/app/api/studio-projects/route.ts");
    expect(content).toMatch(/await auth\(/);
    expect(content).toMatch(/userId/);
  });

  it("studio-projects/[projectId] GET uses ownership-scoped getProject", () => {
    const content = readSrc("src/app/api/studio-projects/[projectId]/route.ts");
    expect(content).toMatch(/await auth\(/);
    expect(content).toMatch(/getProject\(.*userId\)/);
  });
});

describe("conversation ownership isolation", () => {
  it("conversation-service scopes queries by owner_id", () => {
    const content = readSrc("src/lib/studio/conversation-service.ts");
    expect(content).toContain(".eq(\"owner_id\"");
  });

  it("conversations GET route uses auth() userId", () => {
    const content = readSrc("src/app/api/studio/conversations/route.ts");
    expect(content).toMatch(/await auth\(/);
  });

  it("conversations POST validates project ownership before creating", () => {
    const content = readSrc("src/app/api/studio/conversations/route.ts");
    // Must call getProject with userId to validate ownership
    expect(content).toMatch(/getProject\(.*userId\)/);
  });

  it("messages route loads conversation scoped to owner", () => {
    const content = readSrc("src/app/api/studio/conversations/[conversationId]/messages/route.ts");
    expect(content).toMatch(/await auth\(/);
    // Must load conversation with owner_id scoping
    expect(content).toMatch(/getConversation|owner_id/);
  });
});

describe("file ownership isolation", () => {
  it("files route requires auth", () => {
    const content = readSrc("src/app/api/studio-projects/[projectId]/files/route.ts");
    expect(content).toMatch(/await auth\(/);
  });

  it("files route verifies project workspace ownership", () => {
    const content = readSrc("src/app/api/studio-projects/[projectId]/files/route.ts");
    expect(content).toMatch(/verifyProjectWorkspace|getProject\(.*userId\)/);
  });
});

describe("terminal ownership isolation", () => {
  it("terminal token route requires auth", () => {
    const content = readSrc("src/app/api/terminal/token/route.ts");
    expect(content).toMatch(/await auth\(/);
  });

  it("terminal token route verifies project ownership for bound tokens", () => {
    const content = readSrc("src/app/api/terminal/token/route.ts");
    expect(content).toMatch(/verifyProjectWorkspace|getProject\(.*userId\)/);
  });
});

describe("preview ownership isolation", () => {
  it("preview route requires auth", () => {
    const content = readSrc("src/app/api/studio-projects/[projectId]/preview/route.ts");
    expect(content).toMatch(/await auth\(/);
  });

  it("preview route verifies project ownership", () => {
    const content = readSrc("src/app/api/studio-projects/[projectId]/preview/route.ts");
    expect(content).toMatch(/getProject\(.*userId\)/);
  });
});

describe("approval ownership isolation", () => {
  it("approval route requires auth", () => {
    const content = readSrc("src/app/api/studio/conversations/[conversationId]/approvals/[pausedRunId]/route.ts");
    expect(content).toContain("await auth(req)");
  });

  it("paused-run-store getPausedRun scopes by user_id", () => {
    const content = readSrc("src/lib/litt-intelligence/paused-run-store.ts");
    expect(content).toContain(".eq(\"user_id\", userId)");
  });

  it("paused-run-store resolvePausedRun scopes by user_id", () => {
    const content = readSrc("src/lib/litt-intelligence/paused-run-store.ts");
    const resolveSection = content.split("resolvePausedRun")[1] ?? "";
    expect(resolveSection).toContain(".eq(\"user_id\", userId)");
  });
});

describe("proxy/middleware auth gate", () => {
  it("proxy protects /studio at server level", () => {
    const content = readSrc("src/proxy.ts");
    expect(content).toContain('"/studio');
    expect(content).toContain("NextResponse.redirect");
    expect(content).toContain("/sign-in");
  });

  it("proxy returns 401 for unauthenticated API routes", () => {
    const content = readSrc("src/proxy.ts");
    expect(content).toContain("401");
    expect(content).toContain("Unauthorized");
  });

  it("proxy always calls clerkMiddleware (no conditional bypass)", () => {
    const content = readSrc("src/proxy.ts");
    expect(content).toContain("clerkMiddleware(");
  });
});
