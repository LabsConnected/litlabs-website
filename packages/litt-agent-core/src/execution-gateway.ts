/**
 * ExecutionGateway — the ONE canonical execution authority for LiTT.
 *
 * Every execution surface (model agent loop, CLI agent loop, Studio,
 * voice) must route through this gateway. It enforces:
 *
 *   1. Identity verification (actor is who they claim)
 *   2. Grant verification (capability grant is valid, signed, unexpired)
 *   3. Policy decision (PLAN/ACT/AUTO mode + capability classification)
 *   4. Approval enforcement (human-in-the-loop for elevated/dangerous)
 *   5. Credential lease (credentials are materialized, not leaked)
 *   6. Dispatch to ToolRegistry (only after all checks pass)
 *
 * Architecture:
 *
 *   Model Agent Loop
 *   CLI Agent Loop
 *   Studio
 *   Voice
 *        ↓
 *   ExecutionGateway.execute()
 *        ↓
 *   Identity → Grant → Policy → Approval → Credential
 *        ↓
 *   ToolRegistry (or CommandExecutor for shell commands)
 *        ↓
 *   Handler
 *        ↓
 *   ShellExecutor / provider
 *
 * Security invariants:
 *   - ToolRegistry.execute() is NOT directly callable from agent/model paths
 *   - The gateway is the only entry point for untrusted execution
 *   - For shell commands (project.run), the gateway routes through
 *     CommandExecutor → runCommand() (the hardened boundary with
 *     capability classification, approval, path safety, env filtering)
 *   - For other tools, the gateway enforces policy/approval before
 *     dispatching to the tool handler
 *   - A forged grant cannot bypass the gateway
 *   - AUTO mode cannot silently bypass approval
 *   - PLAN mode rejects all mutations
 *   - Failed tool calls do not corrupt the gateway state
 */

import type {
  ToolResult,
  ToolContext,
  ShellExecutor,
  RuntimeEvent,
  RuntimeEventEmitter,
  StreamChunk,
  ToolStatus,
  ToolMetadata,
} from "./types.js";
import type { ToolRegistry } from "./tools.js";
import type { RuntimeStore } from "./state.js";
import type { CommandExecutor, CommandExecutorOptions } from "./command-executor.js";
import {
  classifyCommand,
  redactSecrets,
  type MissionMode,
  type RiskAssessment,
  type RiskLevel,
  type CapabilityTier,
  type ApprovalProvider as ExecutionApprovalProvider,
} from "./execution.js";
import {
  RuntimeApprovalProvider,
  toVerifiedApproval,
  type ApprovalContext,
  type ApprovalDecision,
  type VerifiedApproval,
} from "./contracts/approval-runtime.js";
import type { ApprovalRequestInput } from "./contracts/approval.js";
import {
  GrantVerifier,
  toVerifiedCapabilityGrant,
  type VerificationContext,
} from "./contracts/grant-verifier.js";
import type { CapabilityGrant, VerifiedCapabilityGrant } from "./contracts/capability.js";
import type { PolicyEffect, ActionRisk, Environment } from "./contracts/policy.js";
import type { ExecutionMode, InteractionMode, RuntimeIdentity, RunIdentity, IdentityContext } from "./contracts/identity.js";
import type { CredentialLease, CredentialBroker, CredentialRequest } from "./contracts/credential.js";

// ─── Types ────────────────────────────────────────────────────────

/** Who is requesting the execution. */
export interface ExecutionIdentity {
  /** Tenant/organization ID */
  tenantId: string;
  /** User ID of the human or service */
  userId: string;
  /** Actor ID (may differ from userId for service actors) */
  actorId: string;
  /** Whether this is a trusted internal caller or an untrusted model/agent */
  trusted: boolean;
  /** Interaction mode (interactive vs headless) */
  interaction: InteractionMode;
}

/** What is being executed. */
export interface ExecutionRequest {
  /** The tool ID to execute (e.g. "project.run", "project.check") */
  toolId: string;
  /** Tool inputs */
  inputs: Record<string, unknown>;
  /** Working directory */
  cwd: string;
  /** Mission mode (PLAN/ACT/AUTO) */
  mode: MissionMode;
  /** Identity of the caller */
  identity: ExecutionIdentity;
  /** Optional capability grant (for grant-verified execution) */
  grant?: CapabilityGrant | null;
  /** Optional run ID for correlation */
  runId?: string;
  /** Optional tool call ID for correlation */
  toolCallId?: string;
  /** Optional timeout in milliseconds */
  timeoutMs?: number;
  /** Optional stream callback */
  onStream?: (chunk: StreamChunk) => void;
}

/** The result of a gateway execution. */
export interface GatewayResult {
  /** The tool result */
  result: ToolResult;
  /** The policy effect that was applied */
  policyEffect: PolicyEffect;
  /** The risk assessment (for shell commands) */
  risk: RiskAssessment | null;
  /** Whether approval was required and obtained */
  approved: boolean;
  /** Whether a grant was verified */
  grantVerified: boolean;
  /** The run ID */
  runId: string;
  /** The tool call ID */
  toolCallId: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Why the execution was denied, if it was */
  denialReason: string | null;
  /** The capsule that authorized this execution (null if denied before capsule creation) */
  capsule: GatewayExecutionCapsule | null;
}

/**
 * GatewayExecutionCapsule — the authority container for a single tool execution.
 *
 * Binds together:
 *   - RuntimeIdentity (who)
 *   - VerifiedCapabilityGrant (what they're allowed to do)
 *   - VerifiedApproval (human consent, when required)
 *   - CredentialLeases (scoped credential access, no raw secrets)
 *
 * The capsule contains **authority references**, never raw credential material.
 * Secrets are materialized only at the execution boundary via CredentialMaterializer.
 *
 * The capsule is:
 *   - Created by ExecutionGateway after all checks pass
 *   - Verified before dispatch
 *   - Single-use (one capsule per tool call)
 *   - Time-bounded (expiresAt)
 *   - Identity-bound (cannot be transferred)
 */
export interface GatewayExecutionCapsule {
  /** Unique capsule ID */
  capsuleId: string;

  /** The runtime identity of the caller */
  identity: ExecutionIdentity;

  /** The verified capability grant (cryptographically verified via SEC-3) */
  grant: VerifiedCapabilityGrant | null;

  /** The verified human approval (when policy required it) */
  approval: VerifiedApproval | null;

  /** Credential leases bound to this capsule (no raw secrets) */
  credentialLeases: CredentialLease[];

  /** Run ID for correlation */
  runId: string;
  /** Tool call ID for correlation */
  toolCallId: string;

  /** The capability/tool being executed */
  capability: string;
  /** Execution mode */
  mode: MissionMode;

  /** Working directory */
  cwd: string;
  /** Creation timestamp (epoch ms) */
  createdAt: number;
  /** Expiry timestamp (epoch ms) — capsule is invalid after this */
  expiresAt: number;
}

/** Options for constructing the gateway. */
export interface ExecutionGatewayOptions {
  /** The tool registry (defines available tools) */
  tools: ToolRegistry;
  /** The shared ShellExecutor (same instance as CommandExecutor) */
  shell: ShellExecutor;
  /** The CommandExecutor for hardened shell command execution */
  executor: CommandExecutor;
  /** The shared RuntimeStore for lifecycle events */
  store?: RuntimeStore | null;
  /** Optional event emitter */
  emitter?: RuntimeEventEmitter | null;
  /** The approval provider (SEC-4) */
  approvalProvider?: RuntimeApprovalProvider;
  /** The grant verifier (SEC-3) */
  grantVerifier?: GrantVerifier;
  /** Project ID */
  projectId?: string;
  /**
   * Optional human approval callback.
   * When the gateway needs human approval, it calls this.
   * The callback must return true to approve, false to deny.
   * If not provided, pending approvals are denied (fail closed).
   */
  onApprovalRequired?: ((request: ExecutionRequest, risk: RiskAssessment | null) => Promise<boolean>) | null;
  /**
   * Optional credential broker (SEC-5).
   * When provided, the gateway resolves credential leases for tools
   * that declare credential requirements (via metadata.requiresCredentials).
   * When not provided, tools requiring credentials are denied.
   */
  credentialBroker?: CredentialBroker | null;
}

// ─── ExecutionGateway ─────────────────────────────────────────────

export class ExecutionGateway {
  private readonly _tools: ToolRegistry;
  private readonly _shell: ShellExecutor;
  private readonly _executor: CommandExecutor;
  private readonly _store: RuntimeStore | null;
  private readonly _emitter: RuntimeEventEmitter | null;
  private readonly _approvalProvider: RuntimeApprovalProvider;
  private readonly _grantVerifier: GrantVerifier | null;
  private readonly _projectId: string;
  private readonly _onApprovalRequired: ((request: ExecutionRequest, risk: RiskAssessment | null) => Promise<boolean>) | null;
  private readonly _credentialBroker: CredentialBroker | null;

  constructor(options: ExecutionGatewayOptions) {
    this._tools = options.tools;
    this._shell = options.shell;
    this._executor = options.executor;
    this._store = options.store ?? null;
    this._emitter = options.emitter ?? null;
    this._approvalProvider = options.approvalProvider ?? new RuntimeApprovalProvider();
    this._grantVerifier = options.grantVerifier ?? null;
    this._projectId = options.projectId ?? "default";
    this._onApprovalRequired = options.onApprovalRequired ?? null;
    this._credentialBroker = options.credentialBroker ?? null;
  }

  /**
   * The ONE canonical execution path.
   *
   * All agent/model/CLI/Studio/voice execution must go through this method.
   * It enforces identity, grant, policy, approval, and credential checks
   * before dispatching to the tool handler.
   *
   * For shell commands (project.run), it routes through CommandExecutor
   * → runCommand() (the hardened boundary with capability classification,
   * approval, path safety, env filtering, secret redaction).
   *
   * For other tools, it enforces policy/approval before dispatching
   * through the tool handler.
   */
  async execute(request: ExecutionRequest): Promise<GatewayResult> {
    const t0 = Date.now();
    const runId = request.runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const toolCallId = request.toolCallId ?? `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Emit gateway execution start
    this.emit({
      type: "litt_event",
      subtype: "gateway_execute",
      ts: t0,
      runId,
      toolCallId,
      data: { toolId: request.toolId, mode: request.mode, actorId: request.identity.actorId },
    });

    // ─── 1. Look up the tool ───────────────────────────────────
    const entry = this._tools.get(request.toolId);
    if (!entry) {
      return this.deny(runId, toolCallId, t0, `Unknown tool: ${request.toolId}`, null, false, false);
    }

    const metadata = entry.metadata;

    // ─── 2. Grant verification (if a grant was provided) ───────
    let grantVerified = false;
    let verifiedGrant: VerifiedCapabilityGrant | null = null;
    if (request.grant && this._grantVerifier) {
      const verification = this._grantVerifier.verify(
        request.grant,
        this.buildGrantVerificationContext(request),
      );
      if (verification.status !== "verified") {
        return this.deny(
          runId, toolCallId, t0,
          `Grant verification failed: ${verification.status}`,
          null, false, false,
        );
      }
      grantVerified = true;
      try {
        verifiedGrant = toVerifiedCapabilityGrant(verification);
      } catch {
        return this.deny(
          runId, toolCallId, t0,
          "Grant promotion failed",
          null, false, false,
        );
      }
    }

    // ─── 3. Risk classification ────────────────────────────────
    // For project.run, classify the actual command being run
    // For other tools, use the tool's metadata to determine risk
    let risk: RiskAssessment | null = null;
    let isShellCommand = false;

    if (request.toolId === "project.run") {
      const command = typeof request.inputs.command === "string" ? request.inputs.command : "";
      const args = Array.isArray(request.inputs.args)
        ? request.inputs.args.filter((a): a is string => typeof a === "string")
        : [];
      if (!command) {
        return this.deny(runId, toolCallId, t0, "Missing required input: command", null, false, grantVerified);
      }
      risk = classifyCommand(command, args, request.cwd);
      isShellCommand = true;
    }

    // ─── 4. Policy decision ────────────────────────────────────
    const policyEffect = this.evaluatePolicy(request, metadata, risk, grantVerified);

    if (policyEffect === "deny") {
      const reason = this.buildDenialReason(request, metadata, risk);
      return this.deny(runId, toolCallId, t0, reason, risk, false, grantVerified);
    }

    // ─── 4b. Identity trust enforcement (allow path) ──────────
    // An untrusted identity (model/agent) cannot claim elevated or
    // destructive capabilities without a verified grant. This check
    // handles the "allow" path — where policy says no approval needed.
    // The "require_approval" path is handled at step 5c (post-approval)
    // because human approval is necessary but not sufficient for
    // untrusted dangerous work.
    if (policyEffect === "allow" && !request.identity.trusted && !grantVerified) {
      const requestedTier = this.getCapabilityTier(request, metadata);
      if (requestedTier === "arbitrary_code" || requestedTier === "destructive" || requestedTier === "external_action") {
        return this.deny(
          runId, toolCallId, t0,
          `Untrusted identity cannot execute ${requestedTier} capability without a verified grant`,
          risk, false, false,
        );
      }
    }

    // ─── 5. Approval enforcement ───────────────────────────────
    // The gateway OWNS the full SEC-4 approval flow:
    //   requestApproval() → onApprovalRequired() → decide() → verifyApproval() → VerifiedApproval
    // No boolean substitute. No caller saying "trust me, I approved it."
    let approved = false;
    let verifiedApproval: VerifiedApproval | null = null;

    if (policyEffect === "require_approval") {
      const approvalResult = await this.requestApproval(request, runId, toolCallId, risk, metadata);
      if (!approvalResult) {
        return this.deny(
          runId, toolCallId, t0,
          "Approval denied or not available",
          risk, false, grantVerified,
          "require_approval",
        );
      }
      // approvalResult is a VerifiedApproval — the cryptographic proof
      verifiedApproval = approvalResult;
      approved = true;
    } else if (policyEffect === "allow") {
      approved = true;
    }

    // ─── 5b. Invariant: require_approval MUST produce a VerifiedApproval ─
    // No boolean substitute can bypass this. If policy required approval
    // but we don't have a VerifiedApproval object, deny immediately.
    if (policyEffect === "require_approval" && !verifiedApproval) {
      return this.deny(
        runId, toolCallId, t0,
        "Policy required approval but no VerifiedApproval was produced",
        risk, false, grantVerified,
        "require_approval",
      );
    }

    // ─── 5c. Post-approval trust enforcement ──────────────────
    // Even if a human approved the action, an untrusted identity
    // (model/agent) CANNOT execute dangerous, destructive, or
    // external_action capabilities without a verified grant.
    //
    // Human approval is necessary but NOT sufficient for untrusted
    // dangerous work. The grant represents a prior, considered
    // delegation that the principal is allowed to perform this class
    // of action. Without it, the human is rubber-stamping something
    // an untrusted agent requested — which is not safe authority.
    //
    // This runs AFTER approval so we know the human consented, but
    // BEFORE capsule creation so the capsule never authorizes it.
    //
    // NOTE: "dangerous" is NOT a CapabilityTier — getCapabilityTier()
    // normalizes risk.level "dangerous" to either "destructive" or
    // "external_action". So checking those two tiers covers ALL
    // dangerous capabilities. Do not add "dangerous" here — it would
    // be dead code. If getCapabilityTier() is ever changed to return
    // a new tier for dangerous commands, update this check too.
    if (!request.identity.trusted && !grantVerified) {
      const requestedTier = this.getCapabilityTier(request, metadata);
      if (requestedTier === "destructive" || requestedTier === "external_action") {
        return this.deny(
          runId, toolCallId, t0,
          `Untrusted identity cannot execute ${requestedTier} capability without a verified grant, even with human approval`,
          risk, approved, false,
        );
      }
    }

    // ─── 5c. Credential lease resolution (SEC-5) ───────────────
    // If the tool declares credential requirements, resolve leases
    // BEFORE capsule creation. A credential-required tool with zero
    // valid leases is denied. The leases are attached to the capsule.
    const credentialLeases: CredentialLease[] = [];
    if (metadata.requiresCredentials && metadata.requiresCredentials.length > 0) {
      if (!this._credentialBroker) {
        return this.deny(
          runId, toolCallId, t0,
          "Tool requires credentials but no credential broker is configured",
          risk, approved, grantVerified,
        );
      }
      if (!verifiedGrant) {
        return this.deny(
          runId, toolCallId, t0,
          "Tool requires credentials but no verified grant was provided",
          risk, approved, grantVerified,
        );
      }
      for (const req of metadata.requiresCredentials) {
        const credentialRequest: CredentialRequest = {
          provider: req.provider,
          runId,
          actorId: request.identity.actorId,
          capabilityGrantId: verifiedGrant.grant.grantId,
          scopes: req.scopes,
          resourceScope: [`workspace:${this._projectId}`],
          audience: req.audience,
          durationSeconds: 300, // 5-minute default lease
          projectId: this._projectId,
        };
        try {
          const runtimeIdentity = this.buildRuntimeIdentity(request, runId);
          const resolution = await this._credentialBroker.resolve(
            runtimeIdentity,
            verifiedGrant,
            credentialRequest,
          );
          if (resolution.status === "denied") {
            return this.deny(
              runId, toolCallId, t0,
              `Credential lease denied for ${req.provider}: ${resolution.reason}`,
              risk, approved, grantVerified,
            );
          }
          credentialLeases.push(resolution.lease);
        } catch (err) {
          return this.deny(
            runId, toolCallId, t0,
            `Credential broker error for ${req.provider}: ${err instanceof Error ? err.message : String(err)}`,
            risk, approved, grantVerified,
          );
        }
      }
    }

    // ─── 6. Create GatewayExecutionCapsule ────────────────────
    // The capsule binds all authority references. It contains NO raw
    // credential material — only lease references.
    const capsule = this.createCapsule(
      request,
      runId,
      toolCallId,
      verifiedGrant,
      verifiedApproval,
      credentialLeases,
    );

    // ─── 7. Verify capsule before dispatch ─────────────────────
    // This is the final gate. Even if all prior checks passed,
    // the capsule verification catches any inconsistency.
    const capsuleVerification = this.verifyCapsule(capsule, request, policyEffect);
    if (!capsuleVerification.valid) {
      return this.deny(
        runId, toolCallId, t0,
        `Capsule verification failed: ${capsuleVerification.reason}`,
        risk, approved, grantVerified,
      );
    }

    // Emit capsule authorized event
    this.emit({
      type: "litt_event",
      subtype: "capsule_authorized",
      ts: Date.now(),
      runId,
      toolCallId,
      data: {
        capsuleId: capsule.capsuleId,
        capability: capsule.capability,
        mode: capsule.mode,
        grantVerified,
        approved,
      },
    });

    // ─── 8. Dispatch (only after capsule is verified) ──────────
    let result: ToolResult;

    if (isShellCommand) {
      // Route through CommandExecutor → runCommand() (hardened boundary)
      // This ensures capability classification, path safety, env filtering,
      // and secret redaction are all applied
      const command = typeof request.inputs.command === "string" ? request.inputs.command : "";
      const args = Array.isArray(request.inputs.args)
        ? request.inputs.args.filter((a): a is string => typeof a === "string")
        : [];

      const execOptions: CommandExecutorOptions = {
        cwd: request.cwd,
        mode: request.mode,
        runId,
        toolCallId,
        label: `project.run: ${command}`,
        timeoutMs: request.timeoutMs,
        onStream: request.onStream,
      };

      const execResult = await this._executor.execute(command, args, execOptions);
      result = execResult.result;
    } else {
      // Dispatch through the tool handler (after policy/approval checks)
      const ctx: ToolContext = {
        cwd: request.cwd,
        projectId: this._projectId,
        userId: request.identity.userId,
        shell: this._shell,
      };

      try {
        result = await entry.handler(ctx, request.inputs);
      } catch (err) {
        result = {
          status: "failed",
          success: false,
          message: `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
          data: {},
        };
      }
    }

    const durationMs = Date.now() - t0;

    // Emit gateway execution result
    this.emit({
      type: "litt_event",
      subtype: "gateway_result",
      ts: Date.now(),
      runId,
      toolCallId,
      data: {
        toolId: request.toolId,
        status: result.status,
        success: result.success,
        durationMs,
        policyEffect,
        approved,
        grantVerified,
        capsuleId: capsule.capsuleId,
      },
    });

    return {
      result,
      policyEffect,
      risk,
      approved,
      grantVerified,
      runId,
      toolCallId,
      durationMs,
      denialReason: null,
      capsule,
    };
  }

  // ─── Capsule creation and verification ───────────────────────────

  /**
   * Create a GatewayExecutionCapsule binding all authority references.
   *
   * The capsule is the single authority container for one tool execution.
   * It contains NO raw credential material — only lease references.
   */
  private createCapsule(
    request: ExecutionRequest,
    runId: string,
    toolCallId: string,
    grant: VerifiedCapabilityGrant | null,
    approval: VerifiedApproval | null,
    credentialLeases: CredentialLease[],
  ): GatewayExecutionCapsule {
    const now = Date.now();
    const capsuleTtlMs = 60_000; // capsules expire after 60 seconds

    return {
      capsuleId: `cap_${now}_${Math.random().toString(36).slice(2, 10)}`,
      identity: request.identity,
      grant,
      approval,
      credentialLeases,
      runId,
      toolCallId,
      capability: request.toolId,
      mode: request.mode,
      cwd: request.cwd,
      createdAt: now,
      expiresAt: now + capsuleTtlMs,
    };
  }

  /**
   * Verify a GatewayExecutionCapsule before dispatch.
   *
   * This is the final gate. It checks:
   *   1. Capsule is not expired
   *   2. Capsule identity matches the request identity
   *   3. Capsule runId matches the request runId
   *   4. Capsule capability matches the request toolId
   *   5. Capsule mode matches the request mode
   *   6. If grant is present, grant identity matches capsule identity
   *   7. If approval is present, approval is still valid
   */
  private verifyCapsule(
    capsule: GatewayExecutionCapsule,
    request: ExecutionRequest,
    policyEffect: PolicyEffect,
  ): { valid: boolean; reason: string | null } {
    // 1. Expiry check
    if (Date.now() > capsule.expiresAt) {
      return { valid: false, reason: "capsule_expired" };
    }

    // 2. Identity match
    if (capsule.identity.actorId !== request.identity.actorId) {
      return { valid: false, reason: "capsule_identity_mismatch" };
    }
    if (capsule.identity.tenantId !== request.identity.tenantId) {
      return { valid: false, reason: "capsule_tenant_mismatch" };
    }

    // 3. Run match — only check if the request explicitly provides a runId
    // (when runId is auto-generated by the gateway, it's always consistent)
    if (request.runId && capsule.runId !== request.runId) {
      return { valid: false, reason: "capsule_run_mismatch" };
    }

    // 4. Capability match
    if (capsule.capability !== request.toolId) {
      return { valid: false, reason: "capsule_capability_mismatch" };
    }

    // 5. Mode match
    if (capsule.mode !== request.mode) {
      return { valid: false, reason: "capsule_mode_mismatch" };
    }

    // 6. Grant identity match (if grant present)
    if (capsule.grant) {
      const g = capsule.grant;
      if (g.grant.actorId !== capsule.identity.actorId) {
        return { valid: false, reason: "capsule_grant_actor_mismatch" };
      }
      if (g.grant.tenantId !== capsule.identity.tenantId) {
        return { valid: false, reason: "capsule_grant_tenant_mismatch" };
      }
    }

    // 7. Approval validity — if policy required approval, the capsule
    //    MUST have a VerifiedApproval. No boolean substitute accepted.
    if (policyEffect === "require_approval" && !capsule.approval) {
      return { valid: false, reason: "capsule_missing_required_approval" };
    }

    // 8. If approval is present, verify it's still valid
    if (capsule.approval) {
      // VerifiedApproval.status is always "valid" (promoted via toVerifiedApproval)
      if (capsule.approval.status !== "valid") {
        return { valid: false, reason: "capsule_approval_not_valid" };
      }
      // expiresAt is on the inner ApprovalRecord, not on VerifiedApproval
      const approvalExpiry = capsule.approval.record.expiresAt
        ? Date.parse(capsule.approval.record.expiresAt)
        : NaN;
      if (Number.isNaN(approvalExpiry) || Date.now() > approvalExpiry) {
        return { valid: false, reason: "capsule_approval_expired" };
      }
    }

    return { valid: true, reason: null };
  }

  // ─── Policy evaluation ──────────────────────────────────────────

  /**
   * Evaluate the policy for an execution request.
   *
   * Canonical policy (defined once, enforced everywhere):
   *
   *   PLAN:
   *     Never mutate. All mutations → deny.
   *
   *   ACT:
   *     Safe      = execute (allow)
   *     Elevated  = human approval (require_approval)
   *     Dangerous = deny / explicit exceptional approval (require_approval)
   *
   *   AUTO:
   *     Safe      = execute (allow)
   *     Elevated  = execute only if previously delegated by a valid scoped
   *                 grant (allow if grantVerified, else require_approval)
   *     Dangerous = deny (AUTO never manufactures human approval)
   *
   * AUTO must never manufacture human approval.
   * AUTO must never auto-approve dangerous actions.
   *
   * Returns:
   *   "allow" — proceed without asking
   *   "deny" — reject, no amount of approval can override
   *   "require_approval" — ask the user; if headless, deny
   */
  private evaluatePolicy(
    request: ExecutionRequest,
    metadata: ToolMetadata,
    risk: RiskAssessment | null,
    grantVerified: boolean,
  ): PolicyEffect {
    // PLAN mode: reject all mutations
    if (request.mode === "plan" && (metadata.mutating || (risk?.mutating ?? false))) {
      return "deny";
    }

    // For shell commands, use the risk assessment
    if (risk) {
      if (risk.level === "dangerous") {
        // Dangerous commands:
        //   PLAN  → deny (already handled if mutating)
        //   ACT   → require_approval (explicit exceptional approval)
        //   AUTO  → deny (AUTO never manufactures human approval for dangerous)
        if (request.mode === "auto") {
          return "deny";
        }
        return "require_approval";
      }

      if (risk.level === "elevated") {
        // Elevated commands:
        //   PLAN  → deny (already handled if mutating)
        //   ACT   → require_approval (human approval)
        //   AUTO  → allow only if grantVerified (delegated by valid scoped grant)
        //           otherwise require_approval (but AUTO+headless → deny via SEC-4)
        if (request.mode === "auto") {
          if (grantVerified) {
            return "allow";
          }
          // Without a verified grant, AUTO cannot self-approve elevated
          // SEC-4 will deny this in headless mode
          return "require_approval";
        }
        if (request.mode === "act") {
          return "require_approval";
        }
        // PLAN mode already handled above
        return "allow";
      }

      // Safe commands — allow in all modes
      return "allow";
    }

    // For non-shell tools, use the tool's metadata
    if (metadata.mutating) {
      if (request.mode === "plan") {
        return "deny"; // PLAN never mutates
      }
      if (request.mode === "auto") {
        // AUTO: mutating tools allowed only if grantVerified
        if (grantVerified) {
          return "allow";
        }
        return "require_approval";
      }
      // ACT: mutating tools require approval
      return "require_approval";
    }

    // Read-only tools — allow in all modes
    return "allow";
  }

  // ─── Approval ───────────────────────────────────────────────────

  /**
   * Request approval for an elevated/dangerous action.
   * Returns a VerifiedApproval if approved, null if denied/pending.
   */
  private async requestApproval(
    request: ExecutionRequest,
    runId: string,
    toolCallId: string,
    risk: RiskAssessment | null,
    metadata: ToolMetadata,
  ): Promise<VerifiedApproval | null> {
    const action = risk
      ? `${request.inputs.command} ${(request.inputs.args as string[] ?? []).join(" ")}`
      : request.toolId;

    const approvalInput: ApprovalRequestInput = {
      tenantId: request.identity.tenantId,
      userId: request.identity.userId,
      runId,
      projectId: this._projectId,
      toolId: request.toolId,
      operation: {
        tenantId: request.identity.tenantId,
        userId: request.identity.userId,
        actorId: request.identity.actorId,
        runId,
        toolId: request.toolId,
        action,
        resourceScope: [`workspace:${this._projectId}`],
        environment: "development" as Environment,
        normalizedInput: request.inputs,
      },
      risk: (risk?.level === "dangerous" ? "critical" : "high") as ActionRisk,
      scope: "once",
    };

    const approvalContext: ApprovalContext = {
      executionMode: request.mode as ExecutionMode,
      interaction: request.identity.interaction,
      tenantId: request.identity.tenantId,
    };

    const record = await this._approvalProvider.requestApproval(approvalInput, approvalContext);

    if (record.status === "denied") {
      return null;
    }

    if (record.status === "pending") {
      // Ask the human via the callback if available.
      // Pass the authoritative runId/toolCallId (which may have been
      // generated by the gateway) so the UI shows correct correlation IDs.
      if (this._onApprovalRequired) {
        const approvalRequest: ExecutionRequest = {
          ...request,
          runId,
          toolCallId,
        };
        const humanApproved = await this._onApprovalRequired(approvalRequest, risk);
        const decision: ApprovalDecision = {
          approvalId: record.approvalId,
          decision: humanApproved ? "approve" : "deny",
          approverActorId: request.identity.actorId,
          approverUserId: request.identity.userId,
        };
        const decided = this._approvalProvider.decide(decision);
        if (decided.status !== "approved") {
          return null;
        }
        // Fall through to the approved path below
        // (re-fetch the record as approved)
      } else {
        // No human callback — fail closed
        return null;
      }
    }

    if (record.status === "approved" || (this._onApprovalRequired && record.status === "pending")) {
      // Re-fetch the record after decision, or use the already-approved record
      const finalRecord = record.status === "approved"
        ? record
        : this._approvalProvider.getDecided(record.approvalId);
      if (!finalRecord || finalRecord.status !== "approved") {
        return null;
      }

      // Verify the approval cryptographically, then promote to VerifiedApproval
      try {
        const verification = this._approvalProvider.verifyApproval(
          finalRecord,
          approvalInput.operation,
          {
            tenantId: request.identity.tenantId,
            userId: request.identity.userId,
            runId,
          },
        );
        if (verification.status === "valid") {
          return toVerifiedApproval(verification);
        }
        return null;
      } catch {
        // If promotion fails, fail closed
        return null;
      }
    }

    return null;
  }

  // ─── Grant verification ─────────────────────────────────────────

  private buildGrantVerificationContext(request: ExecutionRequest): VerificationContext {
    return {
      tenantId: request.identity.tenantId,
      userId: request.identity.userId,
      runId: request.runId ?? "",
      actorId: request.identity.actorId,
      projectId: this._projectId,
      workspaceId: null,
      requiredCapability: request.toolId,
      executionMode: request.mode as ExecutionMode,
    };
  }

  // ─── Runtime identity construction ───────────────────────────────

  /**
   * Build a RuntimeIdentity from an ExecutionIdentity for the credential broker.
   * The broker requires the full RuntimeIdentity (run + identity context).
   */
  private buildRuntimeIdentity(request: ExecutionRequest, runId: string): RuntimeIdentity {
    const run: RunIdentity = {
      runId,
      tenantId: request.identity.tenantId,
      userId: request.identity.userId,
      conversationId: null,
      projectId: this._projectId,
      missionId: null,
      executionMode: request.mode as ExecutionMode,
      interaction: request.identity.interaction,
      createdAt: new Date().toISOString(),
    };
    const identity: IdentityContext = {
      principalId: request.identity.userId,
      principalType: request.identity.trusted ? "service" : "user",
      sessionId: null,
      tenantId: request.identity.tenantId,
      workspaceId: null,
      projectId: this._projectId,
      authenticationStrength: "standard",
      establishedAt: new Date().toISOString(),
    };
    return { run, identity };
  }

  // ─── Denial helper ──────────────────────────────────────────────

  private deny(
    runId: string,
    toolCallId: string,
    t0: number,
    reason: string,
    risk: RiskAssessment | null,
    approved: boolean,
    grantVerified: boolean,
    policyEffect: PolicyEffect = "deny",
  ): GatewayResult {
    const durationMs = Date.now() - t0;

    this.emit({
      type: "litt_event",
      subtype: "gateway_denied",
      ts: Date.now(),
      runId,
      toolCallId,
      data: { reason, risk: risk?.level ?? null },
    });

    return {
      result: {
        status: "failed",
        success: false,
        message: reason,
        data: { denied: true, reason },
      },
      policyEffect,
      risk,
      approved,
      grantVerified,
      runId,
      toolCallId,
      durationMs,
      denialReason: reason,
      capsule: null,
    };
  }

  // ─── Denial reason builder ──────────────────────────────────────

  private buildDenialReason(
    request: ExecutionRequest,
    metadata: ToolMetadata,
    risk: RiskAssessment | null,
  ): string {
    if (request.mode === "plan" && (metadata.mutating || (risk?.mutating ?? false))) {
      return `PLAN mode rejects ${risk?.capability ?? "mutating"} command`;
    }
    if (risk?.level === "dangerous") {
      return `Dangerous command (${risk.capability}) denied — requires approval`;
    }
    if (risk?.level === "elevated" && request.mode === "act") {
      return `Elevated command (${risk.capability}) requires approval in ACT mode`;
    }
    return "Policy denied execution";
  }

  // ─── Capability tier resolution ──────────────────────────────────

  /**
   * Resolve the capability tier for an execution request.
   *
   * For shell commands (project.run), the tier comes from the risk
   * assessment's capability field. For other tools, it's derived from
   * the tool metadata (mutating → workspace_edit, read-only → read_only).
   */
  private getCapabilityTier(
    request: ExecutionRequest,
    metadata: ToolMetadata,
  ): CapabilityTier {
    if (request.toolId === "project.run") {
      const command = typeof request.inputs.command === "string" ? request.inputs.command : "";
      const args = Array.isArray(request.inputs.args)
        ? request.inputs.args.filter((a): a is string => typeof a === "string")
        : [];
      const risk = classifyCommand(command, args, request.cwd);
      // Map risk level to capability tier
      if (risk.level === "dangerous") {
        // Dangerous commands are external_action or destructive
        if (risk.capability.includes("rm") || risk.capability.includes("del") || risk.capability.includes("format")) {
          return "destructive";
        }
        return "external_action";
      }
      if (risk.level === "elevated") {
        return "arbitrary_code";
      }
      return "read_only";
    }
    // Non-shell tools
    if (metadata.mutating) return "workspace_edit";
    return "read_only";
  }

  // ─── Event emission ─────────────────────────────────────────────

  private emit(event: RuntimeEvent): void {
    if (this._emitter) {
      try {
        this._emitter(event);
      } catch {
        // emitter errors don't crash the gateway
      }
    }
    // The store has its own emitter — gateway events go through the
    // gateway's emitter, which can be the same emitter the store uses.
  }

  // ─── Introspection ──────────────────────────────────────────────

  /** Get the tool registry (for listing available tools) */
  getTools(): ToolRegistry {
    return this._tools;
  }

  /** Get the approval provider */
  getApprovalProvider(): RuntimeApprovalProvider {
    return this._approvalProvider;
  }

  /**
   * Submit an approval decision from a human.
   * This is called by the CLI/Studio when a human approves/denies.
   */
  decideApproval(decision: ApprovalDecision): void {
    this._approvalProvider.decide(decision);
  }
}

// ─── Factory ──────────────────────────────────────────────────────

export function createExecutionGateway(options: ExecutionGatewayOptions): ExecutionGateway {
  return new ExecutionGateway(options);
}
