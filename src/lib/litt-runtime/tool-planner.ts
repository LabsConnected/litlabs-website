/**
 * LiTT Runtime — Tool Planner
 *
 * Determines whether tools are required for a run and builds a tool plan.
 * Tools without real handlers are NOT advertised as working (per the
 * architecture directive: "A tool definition without a handler must not
 * be advertised as working").
 *
 * Phase 5: Business operations tools are now connected via the
 * business-operations Tool Registry. They are backed by Supabase and
 * require no external capability connection, so they are always
 * available to authenticated users.
 */

import type { KernelResult } from "@/lib/litt-kernel";
import type { ResolvedRunContext } from "./types";
import { BUSINESS_TOOLS } from "@/lib/business-operations";

export interface ToolPlan {
  /** Whether any tool execution is expected for this run. */
  requiresTools: boolean;
  /** Tool ids the Kernel selected, filtered to those with real handlers. */
  advertisedToolIds: string[];
  /** Whether a multi-step mission should be created. */
  requiresMission: boolean;
  /** Whether approval is required before executing any selected tool. */
  approvalRequired: boolean;
}

/**
 * Build a tool plan from the Kernel decision and resolved context.
 *
 * Business operations tools (read + mutation) are always available
 * because they're backed by Supabase with no external dependency.
 * Mutation tools are advertised but flagged as approvalRequired — the
 * runtime will ask the LLM to explain the action and request approval
 * before executing.
 */
export function buildToolPlan(
  kernelResult: KernelResult,
  ctx: ResolvedRunContext,
): ToolPlan {
  const decision = kernelResult.decision;
  const requiresTools = decision.routing.requiresExecution;
  const requiresMission = decision.planning.required;

  // Advertise business tools that have real handlers.
  // All business tools in BUSINESS_TOOLS have handlers (verified by tests).
  // Read tools are always safe to advertise. Mutation tools are advertised
  // but the approval gate in executeBusinessTool prevents auto-execution.
  const advertisedToolIds: string[] = [];

  // Only advertise business tools to authenticated users (not anonymous companion)
  if (ctx.isAuthenticated && !ctx.isAnonymousCompanion) {
    // Add business read tools — always available
    for (const toolId of Object.keys(BUSINESS_TOOLS)) {
      if (toolId.startsWith("business.")) {
        advertisedToolIds.push(toolId);
      }
    }
  }

  const approvalRequired = decision.governance.approvalRequired;

  return {
    requiresTools: requiresTools || advertisedToolIds.length > 0,
    advertisedToolIds,
    requiresMission,
    approvalRequired,
  };
}
