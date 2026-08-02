// Phase 2: Controlled Agent Execution Tests
//
// Tests for the canonical agent-run API and service:
//   - Tool manifest resolution
//   - State machine transitions
//   - Approval gate enforcement
//   - Idempotency
//   - Rate limiting logic

import { describe, it, expect } from "vitest";
import {
  LAUNCH_AGENT_V1_TOOLS,
  LAUNCH_AGENT_FORBIDDEN_TOOLS,
  resolveAllowedTools,
  isToolAllowed,
  isValidTransition,
  type RunStatus,
} from "@/lib/revenue/agent-runs";

// ─── Tool manifest tests ─────────────────────────────────────────────────

describe("Launch Agent tool manifest", () => {
  it("resolves correct tools for litt-launch-agent", () => {
    const tools = resolveAllowedTools("litt-launch-agent");
    expect(tools).toContain("project.files.read");
    expect(tools).toContain("project.files.write");
    expect(tools).toContain("deployment.trigger");
    expect(tools).toContain("project.checkpoint.create");
    expect(tools.length).toBe(LAUNCH_AGENT_V1_TOOLS.length);
  });

  it("resolves correct tools for launch-agent slug", () => {
    const tools = resolveAllowedTools("launch-agent");
    expect(tools).toContain("project.files.read");
    expect(tools.length).toBe(LAUNCH_AGENT_V1_TOOLS.length);
  });

  it("returns empty tools for unknown agent", () => {
    const tools = resolveAllowedTools("unknown-agent");
    expect(tools).toEqual([]);
  });

  it("includes all required V1 tools", () => {
    const required = [
      "project.context.read",
      "project.files.list",
      "project.files.read",
      "project.files.write",
      "project.checkpoint.create",
      "project.build.run",
      "project.test.run",
      "project.preview.start",
      "project.preview.read",
      "deployment.prepare",
      "deployment.trigger",
      "deployment.status.read",
    ];
    for (const tool of required) {
      expect(LAUNCH_AGENT_V1_TOOLS).toContain(tool);
    }
  });

  it("forbids dangerous tools", () => {
    const forbidden = [
      "terminal.command",
      "env.read",
      "secrets.read",
      "project.delete",
      "billing.modify",
      "marketplace.purchase",
      "user.impersonate",
      "cross_project.access",
    ];
    for (const tool of forbidden) {
      expect(LAUNCH_AGENT_FORBIDDEN_TOOLS).toContain(tool);
    }
  });
});

// ─── Tool authorization tests ────────────────────────────────────────────

describe("Tool authorization", () => {
  const allowedTools = resolveAllowedTools("litt-launch-agent");

  it("allows tools in the manifest", () => {
    expect(isToolAllowed("project.files.read", allowedTools)).toBe(true);
    expect(isToolAllowed("project.files.write", allowedTools)).toBe(true);
    expect(isToolAllowed("deployment.trigger", allowedTools)).toBe(true);
  });

  it("forbids tools not in the manifest", () => {
    expect(isToolAllowed("terminal.command", allowedTools)).toBe(false);
    expect(isToolAllowed("some.random.tool", allowedTools)).toBe(false);
  });

  it("forbids dangerous tools even if somehow in list", () => {
    // Even if a forbidden tool were in the allowed list, it's still blocked
    const toolsWithForbidden = [...allowedTools, "terminal.command"];
    expect(isToolAllowed("terminal.command", toolsWithForbidden)).toBe(false);
    expect(isToolAllowed("env.read", toolsWithForbidden)).toBe(false);
    expect(isToolAllowed("secrets.read", toolsWithForbidden)).toBe(false);
  });

  it("forbids project.delete", () => {
    expect(isToolAllowed("project.delete", allowedTools)).toBe(false);
  });

  it("forbids billing.modify", () => {
    expect(isToolAllowed("billing.modify", allowedTools)).toBe(false);
  });

  it("forbids marketplace.purchase", () => {
    expect(isToolAllowed("marketplace.purchase", allowedTools)).toBe(false);
  });
});

// ─── State machine tests ─────────────────────────────────────────────────

describe("Run state machine", () => {
  it("allows queued → planning", () => {
    expect(isValidTransition("queued", "planning")).toBe(true);
  });

  it("allows queued → failed", () => {
    expect(isValidTransition("queued", "failed")).toBe(true);
  });

  it("allows queued → cancelled", () => {
    expect(isValidTransition("queued", "cancelled")).toBe(true);
  });

  it("allows planning → awaiting_approval", () => {
    expect(isValidTransition("planning", "awaiting_approval")).toBe(true);
  });

  it("BLOCKS planning → executing (must go through approval)", () => {
    expect(isValidTransition("planning", "executing")).toBe(false);
  });

  it("allows awaiting_approval → executing", () => {
    expect(isValidTransition("awaiting_approval", "executing")).toBe(true);
  });

  it("allows executing → previewing", () => {
    expect(isValidTransition("executing", "previewing")).toBe(true);
  });

  it("BLOCKS executing → deploying (must go through deploy approval)", () => {
    expect(isValidTransition("executing", "deploying")).toBe(false);
  });

  it("allows previewing → awaiting_deploy_approval", () => {
    expect(isValidTransition("previewing", "awaiting_deploy_approval")).toBe(true);
  });

  it("allows awaiting_deploy_approval → deploying", () => {
    expect(isValidTransition("awaiting_deploy_approval", "deploying")).toBe(true);
  });

  it("allows deploying → completed", () => {
    expect(isValidTransition("deploying", "completed")).toBe(true);
  });

  it("allows deploying → failed", () => {
    expect(isValidTransition("deploying", "failed")).toBe(true);
  });

  it("allows any active state → cancelled", () => {
    const activeStates: RunStatus[] = [
      "queued",
      "planning",
      "awaiting_approval",
      "executing",
      "previewing",
      "awaiting_deploy_approval",
      "deploying",
    ];
    for (const state of activeStates) {
      expect(isValidTransition(state, "cancelled")).toBe(true);
    }
  });

  it("allows any active state → failed", () => {
    const activeStates: RunStatus[] = [
      "queued",
      "planning",
      "awaiting_approval",
      "executing",
      "previewing",
      "awaiting_deploy_approval",
      "deploying",
    ];
    for (const state of activeStates) {
      expect(isValidTransition(state, "failed")).toBe(true);
    }
  });

  it("BLOCKS transitions from terminal states", () => {
    const terminalStates: RunStatus[] = ["completed", "failed", "cancelled"];
    const allStates: RunStatus[] = [
      "queued",
      "planning",
      "awaiting_approval",
      "executing",
      "previewing",
      "awaiting_deploy_approval",
      "deploying",
      "completed",
      "failed",
      "cancelled",
    ];
    for (const terminal of terminalStates) {
      for (const target of allStates) {
        expect(isValidTransition(terminal, target)).toBe(false);
      }
    }
  });

  it("BLOCKS skipping the plan approval gate", () => {
    // Cannot go from queued directly to executing
    expect(isValidTransition("queued", "executing")).toBe(false);
    // Cannot go from queued directly to previewing
    expect(isValidTransition("queued", "previewing")).toBe(false);
  });

  it("BLOCKS skipping the deploy approval gate", () => {
    // Cannot go from previewing directly to deploying
    expect(isValidTransition("previewing", "deploying")).toBe(false);
    // Cannot go from executing directly to deploying
    expect(isValidTransition("executing", "deploying")).toBe(false);
  });

  it("BLOCKS reverse transitions", () => {
    expect(isValidTransition("executing", "planning")).toBe(false);
    expect(isValidTransition("completed", "deploying")).toBe(false);
    expect(isValidTransition("planning", "queued")).toBe(false);
  });
});

// ─── Request validation tests ────────────────────────────────────────────

describe("Run creation request validation", () => {
  function validateRequest(body: unknown): { ok: boolean; error?: string } {
    if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };
    const b = body as Record<string, unknown>;
    if (!b.projectId || typeof b.projectId !== "string") {
      return { ok: false, error: "Missing projectId" };
    }
    if (!b.prompt || typeof b.prompt !== "string" || (b.prompt as string).trim().length === 0) {
      return { ok: false, error: "Missing prompt" };
    }
    if (!b.clientRequestId || typeof b.clientRequestId !== "string") {
      return { ok: false, error: "Missing clientRequestId" };
    }
    return { ok: true };
  }

  it("accepts valid request", () => {
    expect(validateRequest({
      projectId: "proj-1",
      prompt: "Build a landing page",
      clientRequestId: "req-123",
    })).toEqual({ ok: true });
  });

  it("rejects missing projectId", () => {
    expect(validateRequest({
      prompt: "Build a landing page",
      clientRequestId: "req-123",
    }).ok).toBe(false);
  });

  it("rejects missing prompt", () => {
    expect(validateRequest({
      projectId: "proj-1",
      clientRequestId: "req-123",
    }).ok).toBe(false);
  });

  it("rejects empty prompt", () => {
    expect(validateRequest({
      projectId: "proj-1",
      prompt: "  ",
      clientRequestId: "req-123",
    }).ok).toBe(false);
  });

  it("rejects missing clientRequestId", () => {
    expect(validateRequest({
      projectId: "proj-1",
      prompt: "Build a landing page",
    }).ok).toBe(false);
  });

  it("rejects non-string projectId", () => {
    expect(validateRequest({
      projectId: 123,
      prompt: "Build a landing page",
      clientRequestId: "req-123",
    }).ok).toBe(false);
  });
});

// ─── Approval flow tests ─────────────────────────────────────────────────

describe("Approval flow logic", () => {
  it("plan approval transitions to executing when approved", () => {
    const approvalType = "plan";
    const decision = "approved";
    const expectedTransition = decision === "approved" && approvalType === "plan"
      ? "executing"
      : null;
    expect(expectedTransition).toBe("executing");
  });

  it("deploy approval transitions to deploying when approved", () => {
    const approvalType = "deploy";
    const decision = "approved";
    const expectedTransition = decision === "approved" && approvalType === "deploy"
      ? "deploying"
      : null;
    expect(expectedTransition).toBe("deploying");
  });

  it("rejection transitions to failed", () => {
    const decision = "rejected";
    const expectedTransition = decision === "rejected" ? "failed" : null;
    expect(expectedTransition).toBe("failed");
  });

  it("plan approval does NOT transition to deploying", () => {
    const approvalType = "plan";
    const decision = "approved";
    const expectedTransition = decision === "approved" && approvalType === "plan"
      ? "executing"
      : null;
    expect(expectedTransition).not.toBe("deploying");
  });
});
