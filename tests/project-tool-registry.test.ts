// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  PROJECT_TOOLS,
  executeProjectTool,
  listProjectToolNames,
  getProjectToolDefinitions,
  isSafeBranchName,
} from "@/lib/project-tools/registry";
import { TOOL_NAMES } from "@/lib/vapi-tools";

// ─── Registry completeness ───────────────────────────────────────

describe("project tool registry", () => {
  it("registers all tools from TOOL_NAMES", () => {
    const registryNames = listProjectToolNames();
    for (const name of TOOL_NAMES) {
      expect(registryNames).toContain(name);
    }
  });

  it("each tool has a handler and metadata", () => {
    for (const [, entry] of Object.entries(PROJECT_TOOLS)) {
      expect(typeof entry.handler).toBe("function");
      expect(entry.metadata).toBeDefined();
      expect(typeof entry.metadata.projectScoped).toBe("boolean");
      expect(typeof entry.metadata.mutating).toBe("boolean");
      expect(typeof entry.metadata.readOnly).toBe("boolean");
    }
  });

  it("read-only tools are not mutating", () => {
    for (const [, entry] of Object.entries(PROJECT_TOOLS)) {
      if (entry.metadata.readOnly) {
        expect(entry.metadata.mutating).toBe(false);
      }
    }
  });

  it("getProjectToolDefinitions returns definitions for all tools", () => {
    const defs = getProjectToolDefinitions();
    expect(defs.length).toBe(TOOL_NAMES.length);
    for (const def of defs) {
      expect(def.id).toBeTruthy();
      expect(def.description.length).toBeGreaterThan(10);
      expect(def.inputSchema).toBeDefined();
    }
  });
});

// ─── executeProjectTool ──────────────────────────────────────────

describe("executeProjectTool", () => {
  it("returns failure for unknown tool name", async () => {
    const result = await executeProjectTool("delete_everything", "user-123", {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown tool");
  });

  it("returns failure for send_sms (not configured)", async () => {
    const result = await executeProjectTool("send_sms", "user-123", { message: "test" });
    expect(result.success).toBe(false);
    // Fails because either owner phone is not configured or SMS is not available
    expect(result.message.length).toBeGreaterThan(10);
  });

  it("returns failure for send_email without config", async () => {
    const result = await executeProjectTool("send_email", "user-123", { body: "test" });
    expect(result.success).toBe(false);
    // Fails because owner email or RESEND_API_KEY is not configured
    expect(result.message.length).toBeGreaterThan(10);
  });

  it("returns failure for browser_test with invalid URL", async () => {
    const result = await executeProjectTool("browser_test", "user-123", { url: "not-a-url" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid URL");
  });

  it("returns failure for browser_test with private IP (SSRF protection)", async () => {
    const result = await executeProjectTool("browser_test", "user-123", { url: "http://127.0.0.1:3000" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("internal/private");
  });

  it("returns failure for request_approval with missing fields", async () => {
    const result = await executeProjectTool("request_approval", "user-123", {});
    expect(result.success).toBe(false);
    expect(result.message).toContain("requires an action");
  });

  it("returns failure for request_approval with invalid risk_level", async () => {
    const result = await executeProjectTool("request_approval", "user-123", {
      action: "test",
      description: "test",
      risk_level: "extreme",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("risk_level");
  });
});

// ─── Branch name validation ──────────────────────────────────────

describe("isSafeBranchName", () => {
  it("accepts valid branch names", () => {
    expect(isSafeBranchName("fix/mobile-nav")).toBe(true);
    expect(isSafeBranchName("feature/add-auth")).toBe(true);
    expect(isSafeBranchName("main")).toBe(true);
    expect(isSafeBranchName("fix-123")).toBe(true);
  });

  it("rejects invalid branch names", () => {
    expect(isSafeBranchName("")).toBe(false);
    expect(isSafeBranchName("FIX/UPPER")).toBe(false);
    expect(isSafeBranchName("branch with spaces")).toBe(false);
    expect(isSafeBranchName("../traversal")).toBe(false);
    expect(isSafeBranchName("a".repeat(201))).toBe(false);
  });
});

// ─── Tool metadata correctness ───────────────────────────────────

describe("tool metadata", () => {
  it("git_status is read-only and project-scoped", () => {
    expect(PROJECT_TOOLS.git_status.metadata).toEqual({
      projectScoped: true,
      mutating: false,
      readOnly: true,
    });
  });

  it("edit_file is mutating and project-scoped", () => {
    expect(PROJECT_TOOLS.edit_file.metadata).toEqual({
      projectScoped: true,
      mutating: true,
      readOnly: false,
    });
  });

  it("send_email is mutating but not project-scoped", () => {
    expect(PROJECT_TOOLS.send_email.metadata.projectScoped).toBe(false);
    expect(PROJECT_TOOLS.send_email.metadata.mutating).toBe(true);
  });

  it("browser_test is read-only and not project-scoped", () => {
    expect(PROJECT_TOOLS.browser_test.metadata).toEqual({
      projectScoped: false,
      mutating: false,
      readOnly: true,
    });
  });

  it("request_approval is not read-only and not project-scoped", () => {
    expect(PROJECT_TOOLS.request_approval.metadata.projectScoped).toBe(false);
    expect(PROJECT_TOOLS.request_approval.metadata.readOnly).toBe(false);
  });
});
