// Phase 3: Launch Agent capability manifest and enforcement tests

import { describe, it, expect } from "vitest";
import {
  LAUNCH_AGENT_V1_ALLOWED_TOOLS,
  LAUNCH_AGENT_V1_FORBIDDEN_TOOLS,
  TOOLS_REQUIRING_PLAN_APPROVAL,
  TOOLS_REQUIRING_DEPLOY_APPROVAL,
  TOOLS_NO_APPROVAL_REQUIRED,
  getApprovalGateForTool,
  isLaunchAgentToolAllowed,
  getLaunchAgentManifest,
} from "@/lib/revenue/launch-agent-manifest";

describe("Launch Agent capability manifest", () => {
  it("has exactly 12 allowed tools", () => {
    expect(LAUNCH_AGENT_V1_ALLOWED_TOOLS.length).toBe(12);
  });

  it("has exactly 8 forbidden tools", () => {
    expect(LAUNCH_AGENT_V1_FORBIDDEN_TOOLS.length).toBe(8);
  });

  it("includes all required allowed tools", () => {
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
      expect(LAUNCH_AGENT_V1_ALLOWED_TOOLS).toContain(tool);
    }
  });

  it("includes all forbidden tools", () => {
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
      expect(LAUNCH_AGENT_V1_FORBIDDEN_TOOLS).toContain(tool);
    }
  });

  it("does not allow any forbidden tool in the allowed list", () => {
    for (const forbidden of LAUNCH_AGENT_V1_FORBIDDEN_TOOLS) {
      expect(LAUNCH_AGENT_V1_ALLOWED_TOOLS).not.toContain(forbidden);
    }
  });
});

describe("Approval gate resolution", () => {
  it("requires plan approval for file writes", () => {
    expect(getApprovalGateForTool("project.files.write")).toBe("plan");
  });

  it("requires plan approval for checkpoint creation", () => {
    expect(getApprovalGateForTool("project.checkpoint.create")).toBe("plan");
  });

  it("requires deploy approval for deployment trigger", () => {
    expect(getApprovalGateForTool("deployment.trigger")).toBe("deploy");
  });

  it("requires no approval for read-only tools", () => {
    expect(getApprovalGateForTool("project.context.read")).toBe("none");
    expect(getApprovalGateForTool("project.files.list")).toBe("none");
    expect(getApprovalGateForTool("project.files.read")).toBe("none");
    expect(getApprovalGateForTool("project.build.run")).toBe("none");
    expect(getApprovalGateForTool("project.test.run")).toBe("none");
    expect(getApprovalGateForTool("project.preview.start")).toBe("none");
    expect(getApprovalGateForTool("project.preview.read")).toBe("none");
    expect(getApprovalGateForTool("deployment.prepare")).toBe("none");
    expect(getApprovalGateForTool("deployment.status.read")).toBe("none");
  });

  it("requires no approval for unknown tools", () => {
    expect(getApprovalGateForTool("unknown.tool")).toBe("none");
  });

  it("plan approval tools list includes file write and checkpoint", () => {
    expect(TOOLS_REQUIRING_PLAN_APPROVAL).toContain("project.files.write");
    expect(TOOLS_REQUIRING_PLAN_APPROVAL).toContain("project.checkpoint.create");
  });

  it("deploy approval tools list includes deployment trigger", () => {
    expect(TOOLS_REQUIRING_DEPLOY_APPROVAL).toContain("deployment.trigger");
  });

  it("no-approval tools list includes all read-only tools", () => {
    expect(TOOLS_NO_APPROVAL_REQUIRED).toContain("project.context.read");
    expect(TOOLS_NO_APPROVAL_REQUIRED).toContain("project.files.list");
    expect(TOOLS_NO_APPROVAL_REQUIRED).toContain("project.files.read");
  });
});

describe("Tool authorization check", () => {
  it("allows all V1 allowed tools", () => {
    for (const tool of LAUNCH_AGENT_V1_ALLOWED_TOOLS) {
      expect(isLaunchAgentToolAllowed(tool)).toBe(true);
    }
  });

  it("forbids all forbidden tools", () => {
    for (const tool of LAUNCH_AGENT_V1_FORBIDDEN_TOOLS) {
      expect(isLaunchAgentToolAllowed(tool)).toBe(false);
    }
  });

  it("forbids unknown tools", () => {
    expect(isLaunchAgentToolAllowed("unknown.tool")).toBe(false);
    expect(isLaunchAgentToolAllowed("")).toBe(false);
    expect(isLaunchAgentToolAllowed("terminal.command")).toBe(false);
  });

  it("forbids terminal.command even though it is not in the allowed list", () => {
    // This is defense in depth — the forbidden check runs first
    expect(isLaunchAgentToolAllowed("terminal.command")).toBe(false);
  });
});

describe("Full manifest retrieval", () => {
  it("returns a complete manifest object", () => {
    const manifest = getLaunchAgentManifest();
    expect(manifest.allowedTools).toHaveLength(12);
    expect(manifest.forbiddenTools).toHaveLength(8);
    expect(manifest.toolsRequiringPlanApproval).toContain("project.files.write");
    expect(manifest.toolsRequiringDeployApproval).toContain("deployment.trigger");
    expect(manifest.toolsNoApprovalRequired).toContain("project.context.read");
  });

  it("returns copies of arrays (not references)", () => {
    const manifest1 = getLaunchAgentManifest();
    const manifest2 = getLaunchAgentManifest();
    expect(manifest1.allowedTools).not.toBe(manifest2.allowedTools);
    expect(manifest1.allowedTools).toEqual(manifest2.allowedTools);
  });
});

describe("Launch Agent restrictions (from the spec)", () => {
  // The spec says the Launch Agent V1 may use only:
  // - project context read
  // - project file list/read
  // - project file write after approval
  // - checkpoint creation
  // - build command
  // - test command
  // - preview start/read
  // - deployment preparation
  // - deployment trigger after explicit approval
  // - deployment status read

  it("may use project context read", () => {
    expect(isLaunchAgentToolAllowed("project.context.read")).toBe(true);
  });

  it("may use project file list/read", () => {
    expect(isLaunchAgentToolAllowed("project.files.list")).toBe(true);
    expect(isLaunchAgentToolAllowed("project.files.read")).toBe(true);
  });

  it("may use project file write (after approval)", () => {
    expect(isLaunchAgentToolAllowed("project.files.write")).toBe(true);
    expect(getApprovalGateForTool("project.files.write")).toBe("plan");
  });

  it("may use checkpoint creation", () => {
    expect(isLaunchAgentToolAllowed("project.checkpoint.create")).toBe(true);
  });

  it("may use build command", () => {
    expect(isLaunchAgentToolAllowed("project.build.run")).toBe(true);
  });

  it("may use test command", () => {
    expect(isLaunchAgentToolAllowed("project.test.run")).toBe(true);
  });

  it("may use preview start/read", () => {
    expect(isLaunchAgentToolAllowed("project.preview.start")).toBe(true);
    expect(isLaunchAgentToolAllowed("project.preview.read")).toBe(true);
  });

  it("may use deployment preparation", () => {
    expect(isLaunchAgentToolAllowed("deployment.prepare")).toBe(true);
  });

  it("may use deployment trigger (after explicit approval)", () => {
    expect(isLaunchAgentToolAllowed("deployment.trigger")).toBe(true);
    expect(getApprovalGateForTool("deployment.trigger")).toBe("deploy");
  });

  it("may use deployment status read", () => {
    expect(isLaunchAgentToolAllowed("deployment.status.read")).toBe(true);
  });

  // The spec says it may NOT:
  // - access another user's project
  // - run arbitrary unrestricted terminal commands
  // - expose environment variables
  // - print secrets
  // - deploy without approval
  // - delete a project
  // - change billing
  // - purchase products
  // - bypass entitlement checks

  it("may NOT access another user's project", () => {
    expect(isLaunchAgentToolAllowed("cross_project.access")).toBe(false);
  });

  it("may NOT run arbitrary terminal commands", () => {
    expect(isLaunchAgentToolAllowed("terminal.command")).toBe(false);
  });

  it("may NOT expose environment variables", () => {
    expect(isLaunchAgentToolAllowed("env.read")).toBe(false);
  });

  it("may NOT print secrets", () => {
    expect(isLaunchAgentToolAllowed("secrets.read")).toBe(false);
  });

  it("may NOT deploy without approval", () => {
    expect(getApprovalGateForTool("deployment.trigger")).toBe("deploy");
  });

  it("may NOT delete a project", () => {
    expect(isLaunchAgentToolAllowed("project.delete")).toBe(false);
  });

  it("may NOT change billing", () => {
    expect(isLaunchAgentToolAllowed("billing.modify")).toBe(false);
  });

  it("may NOT purchase products", () => {
    expect(isLaunchAgentToolAllowed("marketplace.purchase")).toBe(false);
  });

  it("may NOT bypass entitlement checks", () => {
    expect(isLaunchAgentToolAllowed("user.impersonate")).toBe(false);
  });
});
