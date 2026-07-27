/**
 * LiTT Principles — Deterministic Enforcement
 *
 * The Constitution (docs/litt/00-constitution/principles.md) defines the
 * immutable DNA. This module enforces those principles in code, not just
 * prompt text. The Kernel calls these helpers before executing actions.
 *
 * Principles enforced:
 *   1. Truth over confidence — reject unverified capability claims
 *   2. Intent over interface — route by intent, not by tool selection
 *   3. Projects over chats — don't gate general knowledge on Project setup
 *   4. Verify before acting — require verified capabilities for execution
 *   5. Require approval for destructive/costly/public/irreversible actions
 *   6. Never fake readiness — capability state must come from real probes
 */

import type {
  CapabilityRecord,
  CapabilityState,
  LiTTControlDecision,
  ActionRisk,
} from "./types";

// ─── Principle 1 & 6: Truth over confidence / Never fake readiness ──

/**
 * Returns true only if a capability is verified-ready.
 * "unknown", "connecting", "limited", "degraded" are NOT ready.
 * This is the single function that determines whether a capability
 * can be relied upon for execution.
 */
export function isCapabilityReady(
  capability: CapabilityRecord | undefined,
): capability is CapabilityRecord & { state: "ready" } {
  if (!capability) return false;
  if (capability.state !== "ready") return false;
  // Reject expired capabilities
  if (capability.expiresAt) {
    const expiry = Date.parse(capability.expiresAt);
    if (!Number.isNaN(expiry) && expiry < Date.now()) return false;
  }
  return true;
}

/**
 * Returns the verified capability state for a given ID.
 * Falls back to "unknown" — NEVER to "ready" — when not found.
 *
 * This is the anti-inference rule: absence of evidence is not evidence
 * of readiness.
 */
export function getCapabilityState(
  capabilities: CapabilityRecord[],
  id: string,
): CapabilityState {
  const record = capabilities.find((c) => c.id === id);
  if (!record) return "unknown";
  // Re-check expiry at read time
  if (record.expiresAt) {
    const expiry = Date.parse(record.expiresAt);
    if (!Number.isNaN(expiry) && expiry < Date.now()) return "unknown";
  }
  return record.state;
}

/**
 * Asserts that all required capabilities are verified-ready.
 * Returns the first missing or unverified capability, or null if all OK.
 *
 * Used by the Kernel before execution: if any required capability is not
 * ready, the action is blocked (not silently downgraded).
 */
export function verifyRequiredCapabilities(
  capabilities: CapabilityRecord[],
  requiredIds: string[],
): { ok: true } | { ok: false; missing: string; reason: string } {
  for (const id of requiredIds) {
    const record = capabilities.find((c) => c.id === id);
    if (!record) {
      return {
        ok: false,
        missing: id,
        reason: `Capability "${id}" is not registered. State is unknown, not ready.`,
      };
    }
    if (!isCapabilityReady(record)) {
      return {
        ok: false,
        missing: id,
        reason: `Capability "${id}" is in state "${record.state}", not "ready".`,
      };
    }
    // Check dependencies
    for (const depId of record.dependencies) {
      const dep = capabilities.find((c) => c.id === depId);
      if (!isCapabilityReady(dep)) {
        return {
          ok: false,
          missing: depId,
          reason: `Capability "${id}" depends on "${depId}" which is not ready.`,
        };
      }
    }
  }
  return { ok: true };
}

// ─── Principle 3: Projects over chats ───────────────────────────

/**
 * Determines whether a request requires Project context.
 *
 * General knowledge, casual conversation, and creative ideation do NOT
 * require a Project. File edits, deployments, and project-scoped work DO.
 *
 * This is the anti-gating rule: don't force Project setup for "what is
 * a black hole?"
 */
export function requiresProjectContext(
  decision: LiTTControlDecision,
  hasActiveProject: boolean,
): { required: boolean; satisfied: boolean; reason: string } {
  const { requiresProject } = decision.routing;
  if (!requiresProject) {
    return { required: false, satisfied: true, reason: "Request does not require a Project." };
  }
  if (hasActiveProject) {
    return { required: true, satisfied: true, reason: "Active Project found." };
  }
  return {
    required: true,
    satisfied: false,
    reason: "Request requires a Project but none is active. Ask the user to create or select a Project.",
  };
}

// ─── Principle 5: Require approval ──────────────────────────────

/**
 * Determines whether an action requires explicit user approval before
 * execution, based on risk level.
 *
 *   low      → no approval (general chat, reading, suggesting)
 *   medium   → no approval, but record decision
 *   high     → approval required (file writes, deployments, public posts)
 *   critical → approval required + full reflection (destructive, irreversible)
 */
export function requiresApproval(risk: ActionRisk): boolean {
  return risk === "high" || risk === "critical";
}

/**
 * Classifies the risk of an action based on the control decision.
 *
 * Heuristics (deterministic, not LLM-judged):
 *   - Deployment, public publishing, payments → critical
 *   - File writes, project changes, irreversible mutations → high
 *   - Tool calls, capability probes, canvas mutations → medium
 *   - Reading, answering, suggesting → low
 */
export function classifyRisk(decision: LiTTControlDecision): ActionRisk {
  const { mode, requiresExecution } = decision.routing;
  const { verificationRequired } = decision.epistemics;

  // Ship mode (deployment) is always at least high
  if (mode === "ship") {
    return "critical";
  }

  // Build mode with execution = file writes
  if (mode === "build" && requiresExecution) {
    return "high";
  }

  // Review mode with verification = security audits
  if (mode === "review" && verificationRequired) {
    return "high";
  }

  // Create/build with execution but no project = medium
  if (requiresExecution) {
    return "medium";
  }

  // Default: low (answering, suggesting, teaching)
  return "low";
}

// ─── Principle: Reflection policy ───────────────────────────────

/**
 * Determines the reflection policy based on risk and mode.
 *
 *   none  → trivial requests (casual chat, greetings)
 *   light → normal requests (did I answer? is it clear?)
 *   full  → high-risk requests (deployment, security, financial, destructive)
 */
export function determineReflectionPolicy(decision: LiTTControlDecision): "none" | "light" | "full" {
  const risk = classifyRisk(decision);
  if (risk === "critical") return "full";
  if (risk === "high") return "full";
  if (risk === "medium") return "light";
  return "light"; // even low-risk gets light reflection (did I answer?)
}

// ─── Principle: Truth class enforcement ─────────────────────────

/**
 * Maps a confidence level to the appropriate language behavior.
 * See docs/litt/ — section 8 (Truth and Confidence).
 *
 *   90–100: State clearly with evidence.
 *   70–89:  "The evidence indicates..."
 *   50–69:  "The most likely explanation is..."
 *   25–49:  "One possibility is..., but evidence is limited."
 *   0–24:   State unknown, search, use a tool, or ask.
 */
export function confidenceToHedge(confidence: number): string {
  if (confidence >= 0.9) return "";
  if (confidence >= 0.7) return "The evidence indicates";
  if (confidence >= 0.5) return "The most likely explanation is";
  if (confidence >= 0.25) return "One possibility is";
  return "I don't have enough information to answer confidently";
}

/**
 * Returns true if a claim's confidence is too low to state as fact.
 * Used to block "verified_fact" claims when confidence is below threshold.
 */
export function isConfidenceSufficientForTruthClass(
  confidence: number,
  truthClass: "verified_fact" | "reported_fact" | "reasoned_inference" | "estimate" | "opinion" | "unknown",
): boolean {
  switch (truthClass) {
    case "verified_fact":
      return confidence >= 0.9;
    case "reported_fact":
      return confidence >= 0.7;
    case "reasoned_inference":
      return confidence >= 0.5;
    case "estimate":
      return confidence >= 0.25;
    case "opinion":
      return true; // opinions don't require confidence
    case "unknown":
      return false; // unknown is never "sufficient"
  }
}
