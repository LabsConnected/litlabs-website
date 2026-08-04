/**
 * LiTT Kernel — Orchestrator
 *
 * The Kernel is the single entry point for request routing. It:
 *   1. Classifies intent (intent-router)
 *   2. Resolves context (context-resolver)
 *   3. Looks up mode defaults (mode-router)
 *   4. Checks capabilities (capability-registry + principles)
 *   5. Classifies risk and determines approval/reflection (principles)
 *   6. Composes a control decision
 *   7. Emits events (event-bus)
 *
 * The Kernel does NOT call the LLM — it returns a control decision
 * that the caller uses to build the prompt (via prompt-composer) and
 * execute the request.
 */

import type {
  LiTTControlDecision,
  CapabilityRecord,
  IntentClassification,
} from "./types";
import { classifyIntent } from "./intent-router";
import { getModeDefaults } from "./mode-router";
import { resolveContext } from "./context-resolver";
import {
  classifyRisk,
  requiresApproval,
  determineReflectionPolicy,
  requiresProjectContext,
  verifyRequiredCapabilities,
} from "./principles";
import { emitDecisionCreated, emitApprovalRequired, emitActionBlocked } from "./event-bus";

// ─── Kernel input ───────────────────────────────────────────────

export interface KernelRequest {
  message: string;
  userId: string | null;
  conversationId: string | null;
  projectId: string | null;
  missionId: string | null;
  canvasId: string | null;
  capabilities: CapabilityRecord[];
}

// ─── Kernel result ──────────────────────────────────────────────

export type KernelResult =
  | { ok: true; decision: LiTTControlDecision; systemPrompt: string }
  | { ok: false; decision: LiTTControlDecision; reason: string; systemPrompt: string };

// ─── Main entry point ───────────────────────────────────────────

/**
 * Routes a request through the Kernel and returns a control decision.
 *
 * The caller (e.g., /api/gemini/chat) uses the result to:
 *   - build the LLM prompt (via composeSystemPrompt)
 *   - decide whether to proceed or ask for approval
 *   - log the decision for audit
 */
export function routeKernel(request: KernelRequest): KernelResult {
  // 1. Classify intent
  const intent: IntentClassification = classifyIntent(request.message);

  // 2. Resolve context
  const _context = resolveContext({
    userId: request.userId,
    conversationId: request.conversationId,
    projectId: request.projectId,
    missionId: request.missionId,
    canvasId: request.canvasId,
    capabilities: request.capabilities,
  });

  // 3. Look up mode defaults
  const modeDefaults = getModeDefaults(intent.mode);

  // 4. Build the control decision
  const requestId = `kern_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const decision: LiTTControlDecision = {
    requestId,
    createdAt: new Date().toISOString(),
    routing: {
      mode: intent.mode,
      domains: intent.domains,
      requiresProject: intent.requiresProject,
      requiresCurrentInformation: intent.requiresCurrentInformation,
      requiresPrivateData: intent.requiresPrivateData,
      requiresExecution: intent.requiresExecution,
    },
    epistemics: {
      expectedTruthClasses: intent.requiresCurrentInformation
        ? ["reported_fact", "reasoned_inference"]
        : ["reasoned_inference", "opinion"],
      minimumConfidence: modeDefaults.defaultBudget.minimumQuality,
      verificationRequired: intent.mode === "ship" || intent.mode === "review",
    },
    context: {
      sourceTypes: intent.requiresProject
        ? ["conversation", "project", "capability"]
        : ["conversation", "capability"],
      conversationId: request.conversationId ?? "",
      memoryIds: [],
      projectId: request.projectId ?? undefined,
      missionId: request.missionId ?? undefined,
      canvasId: request.canvasId ?? undefined,
      connectorIds: request.capabilities
        .filter((c) => c.state === "ready")
        .map((c) => c.id),
    },
    execution: {
      skillIds: modeDefaults.defaultSkills,
      capabilityIds: modeDefaults.defaultTools,
      modelProfileId: modeDefaults.defaultModelProfile,
      toolIds: modeDefaults.defaultTools,
      budget: modeDefaults.defaultBudget,
    },
    planning: {
      required: intent.mode === "build" || intent.mode === "ship" || intent.mode === "review",
      specialistRoles: modeDefaults.defaultSpecialists,
      parallelAllowed: modeDefaults.parallelAllowed,
    },
    governance: {
      risk: "low", // set below after classification
      approvalRequired: false, // set below
      reflection: "light", // set below
    },
  };

  // 5. Classify risk and set governance
  decision.governance.risk = classifyRisk(decision);
  decision.governance.approvalRequired = requiresApproval(decision.governance.risk);
  decision.governance.reflection = determineReflectionPolicy(decision);

  // 6. Check project context (Principle 3)
  const projectCheck = requiresProjectContext(decision, request.projectId !== null);
  if (projectCheck.required && !projectCheck.satisfied) {
    // Don't block — let the LLM respond, but flag that a project is needed.
    // The mode guidance in the prompt will tell the LLM to ask the user.
    emitApprovalRequired(decision, projectCheck.reason);
  }

  // 7. Verify required capabilities (Principle 1 & 6)
  if (intent.requiresExecution) {
    const capCheck = verifyRequiredCapabilities(request.capabilities, modeDefaults.defaultTools);
    if (!capCheck.ok) {
      // Block execution — but still allow the LLM to explain why.
      emitActionBlocked(decision, capCheck.reason);
      // Return ok=false but with the decision so the caller can explain
      return {
        ok: false,
        decision,
        reason: `Cannot execute: ${capCheck.reason}`,
        systemPrompt: "", // caller composes with composeSystemPrompt
      };
    }
  }

  // 8. Emit decision event
  emitDecisionCreated(decision);

  return {
    ok: true,
    decision,
    systemPrompt: "", // caller composes with composeSystemPrompt
  };
}
