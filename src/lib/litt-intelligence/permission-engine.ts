/**
 * Permission Engine — PLAN / ACT / AUTO execution modes.
 *
 * Wraps the existing ToolPermissionLevel + ApprovalPolicy with execution
 * mode logic. Does NOT create a competing command-security system.
 * The terminal server's isBlockedCommand() + workspace isolation remain
 * the authoritative security enforcement.
 *
 * Mode definitions:
 *   PLAN = read-only. No mutations, no commands that write.
 *   ACT  = normal workspace development. Edits, commands, git operations
 *          allowed. Sensitive actions (force push, production deploy,
 *          destructive git operations) require explicit approval.
 *   AUTO = same security boundary as ACT. May auto-approve explicitly
 *          classified safe workspace operations (file reads, list, search,
 *          git status, non-destructive builds). AUTO never increases
 *          privilege beyond ACT.
 */

import type { ToolPermissionLevel } from "./types";

export type ExecutionMode = "plan" | "act" | "auto";

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
}

export interface ToolPermissionInfo {
  toolId: string;
  permissionLevel: ToolPermissionLevel;
  isReadOnly: boolean;
  isMutation: boolean;
  enabled: boolean;
}

// Tools that are safe to auto-approve in AUTO mode.
// These are non-destructive, reversible, workspace-scoped operations.
// Standard workspace edits (write, mkdir, rename, patch, commit) are
// included because AUTO mode is for autonomous development — these
// are the same operations a developer does routinely.
const AUTO_APPROVE_SAFE: ReadonlySet<string> = new Set([
  // Read-only tools
  "files.list",
  "files.read",
  "search_code",
  "git.status",
  "git.diff",
  "git.log",
  "project.scan",
  "project.health",
  "build.run",
  "typecheck.run",
  "lint.run",
  "test.run",
  "package.info",
  // Standard workspace mutations (reversible, workspace-scoped)
  "files.write",
  "files.mkdir",
  "files.rename",
  "apply_patch",
  "git.commit",
]);

// Sensitive actions that ALWAYS require approval, even in AUTO mode.
// These are irreversible or potentially destructive operations.
const SENSITIVE_ACTIONS: ReadonlySet<string> = new Set([
  "git.push",
  "git.force_push",
  "git.reset_hard",
  "git.rebase",
  "files.delete",
  "deploy.production",
]);

export class PermissionEngine {
  check(
    tool: ToolPermissionInfo,
    _inputs: Record<string, unknown>,
    mode: ExecutionMode,
  ): PermissionResult {
    // 1. Disabled tools are never allowed
    if (!tool.enabled) {
      return {
        allowed: false,
        reason: `Tool "${tool.toolId}" is disabled`,
        requiresApproval: false,
      };
    }

    // 2. PLAN mode: read-only only
    if (mode === "plan") {
      if (!tool.isReadOnly) {
        return {
          allowed: false,
          reason: "PLAN mode only allows read-only operations",
          requiresApproval: false,
        };
      }
      return { allowed: true, requiresApproval: false };
    }

    // 3. ACT and AUTO: same security boundary
    // Sensitive actions always require approval
    if (SENSITIVE_ACTIONS.has(tool.toolId)) {
      return {
        allowed: true,
        requiresApproval: true,
        reason: "Sensitive action — requires explicit approval",
      };
    }

    // 4. Read-only tools: always allowed in ACT/AUTO
    if (tool.isReadOnly) {
      return { allowed: true, requiresApproval: false };
    }

    // 5. Mutation tools in ACT mode: allowed, but always require approval
    if (mode === "act") {
      return {
        allowed: true,
        requiresApproval: true,
        reason: "Mutation requires approval in ACT mode",
      };
    }

    // 6. AUTO mode: auto-approve safe workspace operations
    if (mode === "auto") {
      if (AUTO_APPROVE_SAFE.has(tool.toolId)) {
        return { allowed: true, requiresApproval: false };
      }
      // Other mutations: allowed but require approval
      // AUTO never increases privilege beyond ACT
      return {
        allowed: true,
        requiresApproval: true,
        reason: "Mutation requires approval",
      };
    }

    return { allowed: false, reason: "Unknown mode", requiresApproval: false };
  }
}

export function isModeCompatible(
  tool: ToolPermissionInfo,
  mode: ExecutionMode,
): boolean {
  if (mode === "plan") return tool.isReadOnly;
  return true; // ACT and AUTO allow all non-sensitive tools
}
