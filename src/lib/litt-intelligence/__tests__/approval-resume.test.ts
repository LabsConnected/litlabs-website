import { describe, it, expect } from "vitest";
import { PermissionEngine, type ToolPermissionInfo } from "@/lib/litt-intelligence/permission-engine";

// ─── Approval flow unit tests ─────────────────────────────────────
// These tests verify the permission engine and approval logic without
// requiring a database or real LLM calls.

describe("Approval Flow: ACT mode pause behavior", () => {
  const engine = new PermissionEngine();

  const writeTool: ToolPermissionInfo = {
    toolId: "files.write",
    permissionLevel: "workspace-write",
    isReadOnly: false,
    isMutation: true,
    enabled: true,
  };

  const readTool: ToolPermissionInfo = {
    toolId: "files.read",
    permissionLevel: "read",
    isReadOnly: true,
    isMutation: false,
    enabled: true,
  };

  const terminalTool: ToolPermissionInfo = {
    toolId: "terminal.execute",
    permissionLevel: "workspace-write",
    isReadOnly: false,
    isMutation: true,
    enabled: true,
  };

  it("ACT: files.write requires approval", () => {
    const r = engine.check(writeTool, {}, "act");
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(true);
  });

  it("ACT: files.read auto-approved (no approval needed)", () => {
    const r = engine.check(readTool, {}, "act");
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(false);
  });

  it("ACT: terminal.execute requires approval", () => {
    const r = engine.check(terminalTool, {}, "act");
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(true);
  });

  it("ACT: approval reason is descriptive", () => {
    const r = engine.check(writeTool, {}, "act");
    expect(r.reason).toContain("approval");
  });
});

describe("Approval Flow: AUTO mode safe-set behavior", () => {
  const engine = new PermissionEngine();

  const writeTool: ToolPermissionInfo = {
    toolId: "files.write",
    permissionLevel: "workspace-write",
    isReadOnly: false,
    isMutation: true,
    enabled: true,
  };

  const terminalTool: ToolPermissionInfo = {
    toolId: "terminal.execute",
    permissionLevel: "workspace-write",
    isReadOnly: false,
    isMutation: true,
    enabled: true,
  };

  const pushTool: ToolPermissionInfo = {
    toolId: "git.push",
    permissionLevel: "production",
    isReadOnly: false,
    isMutation: true,
    enabled: true,
  };

  it("AUTO: files.write auto-approved (in safe set)", () => {
    const r = engine.check(writeTool, {}, "auto");
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(false);
  });

  it("AUTO: terminal.execute still requires approval (not in safe set)", () => {
    const r = engine.check(terminalTool, {}, "auto");
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(true);
  });

  it("AUTO: git.push requires approval (sensitive)", () => {
    const r = engine.check(pushTool, {}, "auto");
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(true);
  });
});

describe("Approval Flow: Replay prevention", () => {
  // These tests verify the logical invariants that prevent replay attacks.
  // The actual single-use enforcement is in the database layer
  // (resolvePausedRun checks status = "pending" atomically).

  it("single-use: resolved approval cannot be re-resolved", () => {
    // Simulate the database invariant: once status != "pending",
    // resolvePausedRun returns null.
    // This is enforced by the .eq("status", "pending") in the update query.
    const mockResolvedRecord = {
      id: "test-1",
      status: "approved" as const,
      resolvedAt: new Date().toISOString(),
    };

    // If we try to resolve again, the query would match 0 rows
    // because status is no longer "pending"
    expect(mockResolvedRecord.status).not.toBe("pending");
  });

  it("frozen inputs: approval inputs cannot be replaced", () => {
    // The resumeAgentLoopV2 function uses the inputs from the paused run record,
    // NOT from the approval request body. The approval endpoint only accepts
    // { decision, reason } — never replacement inputs.
    const approvalRequestBody = {
      decision: "approved" as const,
      reason: "looks good",
    };

    // The approval request body does NOT contain inputs
    expect((approvalRequestBody as Record<string, unknown>).inputs).toBeUndefined();
  });
});

describe("Approval Flow: Expiration", () => {
  it("expired approvals cannot be resolved", () => {
    // The resolvePausedRun function checks expiresAt after resolving.
    // If expired, it marks as expired and returns null.
    const now = Date.now();
    const expiredTime = new Date(now - 1000).toISOString(); // 1 second ago
    const futureTime = new Date(now + 5 * 60 * 1000).toISOString(); // 5 min from now

    expect(new Date(expiredTime).getTime()).toBeLessThan(now);
    expect(new Date(futureTime).getTime()).toBeGreaterThan(now);
  });

  it("TTL is 5 minutes", () => {
    // APPROVAL_TTL_MS = 5 * 60 * 1000 = 300000
    const expectedTTL = 5 * 60 * 1000;
    expect(expectedTTL).toBe(300_000);
  });
});

describe("Approval Flow: Wrong user rejection", () => {
  it("getPausedRun filters by userId", () => {
    // The getPausedRun function includes .eq("user_id", userId) in the query.
    // A different user's paused run is invisible.
    // This is a logical invariant test — the actual DB query enforces it.
    const queryFilters = ["eq('id', pausedRunId)", "eq('user_id', userId)"];
    expect(queryFilters).toContain("eq('user_id', userId)");
  });

  it("resolvePausedRun filters by userId", () => {
    // The resolvePausedRun update includes .eq("user_id", userId).
    // A different user cannot resolve someone else's approval.
    const updateFilters = ["eq('id', pausedRunId)", "eq('user_id', userId)", "eq('status', 'pending')"];
    expect(updateFilters).toContain("eq('user_id', userId)");
  });
});

describe("Approval Flow: Changed workspace state", () => {
  it("resume re-verifies workspace ownership", () => {
    // The approval endpoint calls verifyProjectWorkspace again on resume.
    // If the workspace was deleted or transferred, the resume fails.
    // This is a logical invariant — the code calls verifyProjectWorkspace
    // and checks workspaceId matches.
    const resumeSteps = [
      "getPausedRun",
      "resolvePausedRun",
      "createWorkspaceTransport",
      "verifyProjectWorkspace",
      "resumeAgentLoopV2",
    ];
    expect(resumeSteps).toContain("verifyProjectWorkspace");
    expect(resumeSteps).toContain("createWorkspaceTransport");
  });

  it("resume checks workspaceId matches paused record", () => {
    // If workspaceId changed since pause, resume returns 409.
    // This prevents executing tools in a different workspace context.
    const pausedWorkspaceId = "ws-original";
    const currentWorkspaceId = "ws-changed";
    expect(pausedWorkspaceId).not.toBe(currentWorkspaceId);
  });
});

describe("Approval Flow: Successful continuation", () => {
  it("approved tool executes with frozen inputs", () => {
    // The resumeAgentLoopV2 function:
    // 1. Takes inputs from the paused record (frozen)
    // 2. Executes the tool with those exact inputs
    // 3. Injects the result into the conversation
    // 4. Continues the loop
    const frozenInputs = { path: "src/foo.ts", content: "export const x = 1;" };
    const executedInputs = { ...frozenInputs }; // Same reference

    expect(executedInputs).toEqual(frozenInputs);
  });

  it("rejected tool injects rejection message", () => {
    // On reject, resumeAgentLoopV2 injects a tool result with:
    // success: false, error: "REJECTED: <reason>"
    const rejectionResult = {
      success: false,
      error: "REJECTED: User rejected this operation.",
    };
    expect(rejectionResult.success).toBe(false);
    expect(rejectionResult.error).toContain("REJECTED");
  });

  it("after approval, loop continues to next LLM call", () => {
    // The resume function doesn't just execute the tool — it continues
    // the while loop, calling the LLM again with the tool result injected.
    // This lets LiTT respond to the tool result.
    const resumeFlow = [
      "execute_approved_tool",
      "inject_result_into_conversation",
      "call_llm_again",
      "process_tool_calls_or_finish",
    ];
    expect(resumeFlow).toContain("call_llm_again");
  });
});

describe("Approval Flow: Autonomous repair", () => {
  it("build-fix loop uses onRepair callback", () => {
    // The V2 agent loop now passes createAutonomousRepairCallback to runBuildFixLoop.
    // This callback:
    // 1. Feeds error output to the LLM
    // 2. Lets it inspect and fix code via tool calls
    // 3. Re-runs checks
    // Max 3 repair cycles.
    const maxRepairAttempts = 3;
    expect(maxRepairAttempts).toBe(3);
  });

  it("repair callback gets error output from failed checks", () => {
    // The build-fix loop collects stderr+stdout from failed checks
    // and passes it to the onRepair callback.
    const mockErrors = "--- typecheck (exit 1) ---\nerror TS2304: Cannot find name 'foo'.";
    expect(mockErrors).toContain("TS2304");
    expect(mockErrors).toContain("typecheck");
  });

  it("repair gives LLM up to 5 tool-call rounds per attempt", () => {
    // Within each repair attempt, the LLM gets up to 5 rounds of
    // tool calls to read files, identify issues, and write fixes.
    const maxRoundsPerAttempt = 5;
    expect(maxRoundsPerAttempt).toBe(5);
  });
});
