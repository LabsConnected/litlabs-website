/**
 * Launch Agent V1 capability manifest.
 *
 * This is the server-side source of truth for what the LiTT Launch Agent
 * is allowed to do. The browser can never override this — it's loaded
 * server-side and used by the agent-run service to populate
 * `allowed_tools` on each run.
 *
 * The manifest defines:
 *   - Allowed tools (explicitly granted)
 *   - Forbidden tools (explicitly denied, defense in depth)
 *   - Tool descriptions (for audit logging)
 *   - Required approval gates (which tools need human approval first)
 */

// ─── Allowed tools ───────────────────────────────────────────────────────

export const LAUNCH_AGENT_V1_ALLOWED_TOOLS = [
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
] as const;

// ─── Forbidden tools ─────────────────────────────────────────────────────

export const LAUNCH_AGENT_V1_FORBIDDEN_TOOLS = [
  "terminal.command",
  "env.read",
  "secrets.read",
  "project.delete",
  "billing.modify",
  "marketplace.purchase",
  "user.impersonate",
  "cross_project.access",
] as const;

// ─── Tool descriptions (for audit log) ───────────────────────────────────

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  "project.context.read": "Read project metadata and configuration",
  "project.files.list": "List files in the project workspace",
  "project.files.read": "Read file contents from the project workspace",
  "project.files.write": "Write or modify files in the project workspace",
  "project.checkpoint.create": "Create a Git checkpoint (commit) in the workspace",
  "project.build.run": "Run the project build command",
  "project.test.run": "Run the project test command",
  "project.preview.start": "Start the preview server",
  "project.preview.read": "Read preview server status and URL",
  "deployment.prepare": "Prepare deployment artifacts",
  "deployment.trigger": "Trigger a deployment to the provider",
  "deployment.status.read": "Read deployment status from the provider",
  "terminal.command": "Run an arbitrary terminal command (FORBIDDEN)",
  "env.read": "Read environment variables (FORBIDDEN)",
  "secrets.read": "Read secrets (FORBIDDEN)",
  "project.delete": "Delete the project (FORBIDDEN)",
  "billing.modify": "Modify billing settings (FORBIDDEN)",
  "marketplace.purchase": "Purchase marketplace items (FORBIDDEN)",
  "user.impersonate": "Impersonate another user (FORBIDDEN)",
  "cross_project.access": "Access another user's project (FORBIDDEN)",
};

// ─── Approval gates ──────────────────────────────────────────────────────

/**
 * Tools that require explicit human approval before execution.
 * The agent can request these tools, but the run pauses in
 * 'awaiting_approval' or 'awaiting_deploy_approval' until the
 * user approves.
 */
export const TOOLS_REQUIRING_PLAN_APPROVAL: string[] = [
  "project.files.write",
  "project.checkpoint.create",
];

export const TOOLS_REQUIRING_DEPLOY_APPROVAL: string[] = [
  "deployment.trigger",
];

/**
 * Tools that can be used freely without approval (read-only operations).
 */
export const TOOLS_NO_APPROVAL_REQUIRED: string[] = [
  "project.context.read",
  "project.files.list",
  "project.files.read",
  "project.build.run",
  "project.test.run",
  "project.preview.start",
  "project.preview.read",
  "deployment.prepare",
  "deployment.status.read",
];

// ─── Capability check ────────────────────────────────────────────────────

export type ApprovalGate = "none" | "plan" | "deploy";

/**
 * Determine which approval gate (if any) is required for a tool.
 */
export function getApprovalGateForTool(tool: string): ApprovalGate {
  if (TOOLS_REQUIRING_DEPLOY_APPROVAL.includes(tool)) return "deploy";
  if (TOOLS_REQUIRING_PLAN_APPROVAL.includes(tool)) return "plan";
  return "none";
}

/**
 * Check if a tool is allowed for the Launch Agent.
 * Returns false for forbidden tools even if they're in the allowed list.
 */
export function isLaunchAgentToolAllowed(tool: string): boolean {
  if (LAUNCH_AGENT_V1_FORBIDDEN_TOOLS.includes(tool as never)) {
    return false;
  }
  return LAUNCH_AGENT_V1_ALLOWED_TOOLS.includes(tool as never);
}

/**
 * Get the full capability manifest for the Launch Agent.
 */
export function getLaunchAgentManifest() {
  return {
    allowedTools: [...LAUNCH_AGENT_V1_ALLOWED_TOOLS],
    forbiddenTools: [...LAUNCH_AGENT_V1_FORBIDDEN_TOOLS],
    toolsRequiringPlanApproval: [...TOOLS_REQUIRING_PLAN_APPROVAL],
    toolsRequiringDeployApproval: [...TOOLS_REQUIRING_DEPLOY_APPROVAL],
    toolsNoApprovalRequired: [...TOOLS_NO_APPROVAL_REQUIRED],
  };
}
