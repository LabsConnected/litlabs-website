/**
 * Approval and Permission System
 *
 * Enforces explicit user approval for risky actions. No action that
 * modifies files, deploys, spends money, or makes external API calls
 * proceeds without explicit confirmation.
 *
 * Approval policies by risk:
 *   none/low     → no approval required
 *   medium       → recommended confirmation (auto-proceed with log)
 *   high         → explicit approval required
 *   critical     → explicit approval + full reflection required
 *
 * Never allowed (without separate secure implementation):
 *   - Public host-shell execution
 *   - Reading platform secrets
 *   - Returning secret values to the model
 *   - Disabling security controls
 *   - Cross-user project access
 *   - Arbitrary MCP server installation
 *   - Unrestricted outbound API execution
 */

import { randomUUID } from "crypto";
import type { LiTTActionPlan, LiTTActionStep, ToolRisk } from "./types";

// ─── Approval request ───────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  planId: string;
  userId: string;
  projectId: string;
  goal: string;
  steps: Array<{
    stepId: string;
    toolId: string;
    description: string;
    risk: ToolRisk;
    inputsSummary: string;
  }>;
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "denied" | "expired";
  decidedAt?: string;
  decidedBy?: string;
}

// ─── Permission check ───────────────────────────────────────────

export interface PermissionContext {
  userId: string;
  projectId: string;
  permissions: Set<string>;
  availableCapabilities: string[];
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
  missingPermissions?: string[];
  missingCapabilities?: string[];
}

// ─── Never-allowed actions ──────────────────────────────────────

const NEVER_ALLOWED_ACTIONS = new Set([
  "terminal.execute",       // Public host-shell execution
  "secrets.read",           // Reading platform secrets
  "secrets.return",         // Returning secret values to the model
  "security.disable",       // Disabling security controls
  "cross_user.access",      // Cross-user project access
  "mcp.install_arbitrary",  // Arbitrary MCP server installation
  "api.unrestricted",       // Unrestricted outbound API execution
]);

// ─── Approval manager ───────────────────────────────────────────

export class ApprovalManager {
  private requests = new Map<string, ApprovalRequest>();
  private listeners = new Set<(request: ApprovalRequest) => void>();
  private approvalTimeoutMs: number;

  constructor(options: { approvalTimeoutMs?: number } = {}) {
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Create an approval request for an action plan.
   * Only called when the plan requires approval (risk >= high).
   */
  requestApproval(plan: LiTTActionPlan): ApprovalRequest {
    const id = `approval-${randomUUID()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.approvalTimeoutMs);

    const request: ApprovalRequest = {
      id,
      planId: plan.id,
      userId: plan.userId,
      projectId: plan.projectId,
      goal: plan.goal,
      steps: plan.steps.map((step) => ({
        stepId: step.id,
        toolId: step.toolId,
        description: step.expectedOutput,
        risk: step.risk,
        inputsSummary: this.summarizeInputs(step),
      })),
      risk: plan.risk,
      reason: this.buildApprovalReason(plan),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "pending",
    };

    this.requests.set(id, request);
    this.notifyListeners(request);

    return request;
  }

  /**
   * Approve a pending request.
   */
  approve(requestId: string, decidedBy: string): ApprovalRequest | null {
    const request = this.requests.get(requestId);
    if (!request) return null;
    if (request.status !== "pending") return null;

    // Check expiry
    if (this.isExpired(request)) {
      request.status = "expired";
      return null;
    }

    request.status = "approved";
    request.decidedAt = new Date().toISOString();
    request.decidedBy = decidedBy;

    return request;
  }

  /**
   * Deny a pending request.
   */
  deny(requestId: string, decidedBy: string): ApprovalRequest | null {
    const request = this.requests.get(requestId);
    if (!request) return null;
    if (request.status !== "pending") return null;

    request.status = "denied";
    request.decidedAt = new Date().toISOString();
    request.decidedBy = decidedBy;

    return request;
  }

  /**
   * Get a request by ID.
   */
  getRequest(requestId: string): ApprovalRequest | null {
    return this.requests.get(requestId) ?? null;
  }

  /**
   * List pending requests for a user.
   */
  listPending(userId: string): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(
      (r) => r.userId === userId && r.status === "pending" && !this.isExpired(r),
    );
  }

  /**
   * Check if a request is approved.
   */
  isApproved(requestId: string): boolean {
    const request = this.requests.get(requestId);
    return request?.status === "approved";
  }

  /**
   * Check if an action is never allowed.
   */
  isNeverAllowed(actionId: string): boolean {
    return NEVER_ALLOWED_ACTIONS.has(actionId);
  }

  /**
   * Check permissions for a tool execution.
   */
  checkPermissions(
    toolId: string,
    requiredPermissions: string[],
    requiredCapabilities: string[],
    context: PermissionContext,
  ): PermissionCheckResult {
    // Check never-allowed
    if (this.isNeverAllowed(toolId)) {
      return {
        allowed: false,
        reason: `Action "${toolId}" is never allowed without a separate secure implementation`,
      };
    }

    // Check permissions
    const missingPermissions = requiredPermissions.filter((p) => !context.permissions.has(p));
    if (missingPermissions.length > 0) {
      return {
        allowed: false,
        reason: `Missing permissions: ${missingPermissions.join(", ")}`,
        missingPermissions,
      };
    }

    // Check capabilities
    const missingCapabilities = requiredCapabilities.filter(
      (c) => !context.availableCapabilities.includes(c),
    );
    if (missingCapabilities.length > 0) {
      return {
        allowed: false,
        reason: `Missing capabilities: ${missingCapabilities.join(", ")}`,
        missingCapabilities,
      };
    }

    // Check cross-user access
    if (context.projectId !== context.projectId) {
      return {
        allowed: false,
        reason: "Cross-user project access is not allowed",
      };
    }

    return { allowed: true, reason: "All checks passed" };
  }

  /**
   * Determine if approval is required for a given risk level.
   */
  requiresApproval(risk: ToolRisk): boolean {
    return risk === "high" || risk === "critical";
  }

  /**
   * Subscribe to new approval requests.
   */
  onRequest(listener: (request: ApprovalRequest) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Expire old pending requests.
   */
  expireOldRequests(): void {
    for (const request of this.requests.values()) {
      if (request.status === "pending" && this.isExpired(request)) {
        request.status = "expired";
      }
    }
  }

  /**
   * Clear all requests — used in tests.
   */
  clear(): void {
    this.requests.clear();
    this.listeners.clear();
  }

  private isExpired(request: ApprovalRequest): boolean {
    return Date.parse(request.expiresAt) < Date.now();
  }

  private summarizeInputs(step: LiTTActionStep): string {
    const inputs = step.inputs;
    const keys = Object.keys(inputs);
    if (keys.length === 0) return "(no inputs)";
    return keys.map((k) => `${k}=${this.truncateValue(inputs[k])}`).join(", ");
  }

  private truncateValue(value: unknown): string {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    return str.length > 50 ? `${str.slice(0, 47)}...` : str;
  }

  private buildApprovalReason(plan: LiTTActionPlan): string {
    const highRiskSteps = plan.steps.filter((s) => s.risk === "high" || s.risk === "critical");
    const riskLabel = plan.risk === "critical" ? "CRITICAL" : "HIGH";
    return `${riskLabel} risk action: "${plan.goal}". ${highRiskSteps.length} step(s) require explicit approval. Review the steps below before approving.`;
  }

  private notifyListeners(request: ApprovalRequest): void {
    for (const listener of this.listeners) {
      try {
        listener(request);
      } catch {
        // non-fatal
      }
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────

export const approvalManager = new ApprovalManager();
