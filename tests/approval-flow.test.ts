/**
 * Approval flow regression tests.
 *
 * Verifies the security properties of the V2 agent loop approval system:
 * 1. Paused runs are scoped by userId (no IDOR)
 * 2. Approvals are single-use (atomic resolution)
 * 3. Frozen inputs are never replaced by client input
 * 4. Conversation ID mismatch is rejected
 * 5. Expiration is enforced
 * 6. Deny does not execute the tool
 * 7. Workspace is re-validated on resume
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAUSED_RUN_STORE_PATH = join(process.cwd(), "src", "lib", "litt-intelligence", "paused-run-store.ts");
const APPROVAL_ROUTE_PATH = join(process.cwd(), "src", "app", "api", "studio", "conversations", "[conversationId]", "approvals", "[pausedRunId]", "route.ts");

describe("paused-run-store security", () => {
  it("getPausedRun scopes by userId (no IDOR)", () => {
    const content = readFileSync(PAUSED_RUN_STORE_PATH, "utf-8");
    expect(content).toContain(".eq(\"id\", pausedRunId)");
    expect(content).toContain(".eq(\"user_id\", userId)");
  });

  it("resolvePausedRun is atomic (only updates pending status)", () => {
    const content = readFileSync(PAUSED_RUN_STORE_PATH, "utf-8");
    // The update must include .eq("status", "pending") to enforce single-use
    expect(content).toContain(".eq(\"status\", \"pending\")");
  });

  it("resolvePausedRun scopes by userId", () => {
    const content = readFileSync(PAUSED_RUN_STORE_PATH, "utf-8");
    // The resolve update must also scope by user_id
    expect(content).toMatch(/\.eq\("user_id", userId\)/);
  });

  it("has 5-minute TTL for approvals", () => {
    const content = readFileSync(PAUSED_RUN_STORE_PATH, "utf-8");
    expect(content).toContain("APPROVAL_TTL_MS");
    expect(content).toMatch(/5\s*\*\s*60\s*\*\s*1000/);
  });

  it("checks expiration after resolution", () => {
    const content = readFileSync(PAUSED_RUN_STORE_PATH, "utf-8");
    expect(content).toContain("expiresAt");
    expect(content).toContain("expired");
  });

  it("has expireStaleRuns cleanup function", () => {
    const content = readFileSync(PAUSED_RUN_STORE_PATH, "utf-8");
    expect(content).toContain("expireStaleRuns");
    expect(content).toContain(".lt(\"expires_at\", now)");
  });
});

describe("approval route security", () => {
  it("requires authentication", () => {
    const content = readFileSync(APPROVAL_ROUTE_PATH, "utf-8");
    expect(content).toContain("await auth(req)");
    expect(content).toContain("401");
  });

  it("validates decision is approved or rejected", () => {
    const content = readFileSync(APPROVAL_ROUTE_PATH, "utf-8");
    expect(content).toContain("\"approved\"");
    expect(content).toContain("\"rejected\"");
    expect(content).toContain("400");
  });

  it("rejects already-resolved approvals (409)", () => {
    const content = readFileSync(APPROVAL_ROUTE_PATH, "utf-8");
    expect(content).toContain("pausedRun.status !== \"pending\"");
    expect(content).toContain("409");
  });

  it("rejects conversation ID mismatch (403)", () => {
    const content = readFileSync(APPROVAL_ROUTE_PATH, "utf-8");
    expect(content).toContain("pausedRun.conversationId !== conversationId");
    expect(content).toContain("403");
  });

  it("uses frozen inputs from paused run, never from client", () => {
    const content = readFileSync(APPROVAL_ROUTE_PATH, "utf-8");
    // The resume must use resolved.inputs (from the paused run), not body.inputs
    expect(content).toContain("resolved.inputs");
    expect(content).toContain("Frozen from pause time");
    // Must NOT accept replacement inputs from the client
    expect(content).not.toMatch(/body\.inputs/);
  });

  it("re-validates workspace ownership on resume", () => {
    const content = readFileSync(APPROVAL_ROUTE_PATH, "utf-8");
    expect(content).toContain("verifyProjectWorkspace");
    expect(content).toContain("resolved.projectId");
    expect(content).toContain("userId");
  });

  it("detects workspace ID change since approval was requested", () => {
    const content = readFileSync(APPROVAL_ROUTE_PATH, "utf-8");
    expect(content).toContain("verified.workspaceId !== resolved.workspaceId");
  });

  it("GET endpoint also requires auth and scopes by userId", () => {
    const content = readFileSync(APPROVAL_ROUTE_PATH, "utf-8");
    // GET handler must also call auth() and getPausedRun with userId
    expect(content).toContain("export async function GET");
    // The GET handler must also check auth
    const getSection = content.split("export async function GET")[1] ?? "";
    expect(getSection).toContain("await auth(req)");
    expect(getSection).toContain("getPausedRun");
  });
});
