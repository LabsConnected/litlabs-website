import "server-only";

import type { CapabilityFamily, CapabilityPlan } from "./capability-planner";
import type { ToolHealthReport } from "./tool-health";

/**
 * LiTT Run Observability — Part J of the Tool Orchestrator fix.
 *
 * For every run, record internally:
 * - goal
 * - capabilities selected (required/useful)
 * - tools offered to the model
 * - tools actually called (with success/failure)
 * - tool failures + fallbacks
 * - approvals (requested/granted/denied)
 * - verification evidence
 *
 * This makes it obvious why LiTT did or did not use web / images /
 * browser / terminal on any given run. Normal users never see the raw
 * record — the Activity UI shows friendly labels (Researching, Generating
 * images, Editing files, Running checks, Checking preview).
 */

export interface ToolCallRecord {
  toolId: string;
  success: boolean;
  /** Short human-readable summary (no secrets). */
  summary: string;
  mutating: boolean;
  latencyMs?: number;
  /** When the call failed, the error class (never the raw message). */
  errorClass?: string;
}

export interface ApprovalRecord {
  toolId: string;
  decision: "granted" | "denied" | "pending";
  at: string; // ISO timestamp
}

export interface FallbackRecord {
  fromToolId: string;
  toAlternative: string;
  reason: string;
}

export interface RunObservability {
  runId: string;
  startedAt: string; // ISO timestamp
  goal: string;
  agentMode: string;
  /** Capability plan derived before execution (Part A). */
  capabilityPlan?: {
    required: CapabilityFamily[];
    useful: CapabilityFamily[];
    isReferenceMatch: boolean;
    needsVisualVerification: boolean;
  };
  /** Tool IDs offered to the model after permission + health filtering. */
  toolsOffered: string[];
  /** Per-tool health at offer time. */
  toolHealth?: ToolHealthReport[];
  /** Tools the model actually called, in order. */
  toolsCalled: ToolCallRecord[];
  /** Fallbacks taken when a tool was unavailable/failed. */
  fallbacks: FallbackRecord[];
  /** Approvals requested during the run. */
  approvals: ApprovalRecord[];
  /** Verification evidence recorded (preview URLs, screenshots, checks). */
  verificationEvidence: Array<{ kind: string; detail: string; at: string }>;
  endedAt?: string;
  outcome?: "completed" | "failed" | "cancelled" | "awaiting_approval";
}

/** Friendly Activity-UI label for a tool ID. */
export function friendlyActivityLabel(toolId: string): string {
  if (toolId === "web.search" || toolId === "web.fetch") return "Researching";
  if (toolId === "image.generate") return "Generating images";
  if (toolId === "terminal.execute") return "Running checks";
  if (toolId === "project.deploy" || toolId === "deploy.execute") return "Deploying";
  if (toolId.startsWith("browser.")) return "Checking preview";
  if (toolId.startsWith("file") || toolId.startsWith("project.")) return "Editing files";
  if (toolId.startsWith("memory.")) return "Recalling context";
  if (toolId.startsWith("git.")) return "Updating version control";
  return "Working";
}

export function startRunObservability(init: {
  runId: string;
  goal: string;
  agentMode: string;
  capabilityPlan?: CapabilityPlan;
}): RunObservability {
  return {
    runId: init.runId,
    startedAt: new Date().toISOString(),
    goal: init.goal,
    agentMode: init.agentMode,
    capabilityPlan: init.capabilityPlan
      ? {
          required: init.capabilityPlan.requiredCapabilities,
          useful: init.capabilityPlan.usefulCapabilities,
          isReferenceMatch: init.capabilityPlan.isReferenceMatch,
          needsVisualVerification: init.capabilityPlan.needsVisualVerification,
        }
      : undefined,
    toolsOffered: [],
    toolsCalled: [],
    fallbacks: [],
    approvals: [],
    verificationEvidence: [],
  };
}

export function recordToolsOffered(
  obs: RunObservability,
  toolIds: string[],
  health?: ToolHealthReport[],
): void {
  obs.toolsOffered = [...toolIds];
  if (health) obs.toolHealth = [...health];
}

export function recordToolCall(obs: RunObservability, call: ToolCallRecord): void {
  obs.toolsCalled.push(call);
}

export function recordFallback(obs: RunObservability, fb: FallbackRecord): void {
  obs.fallbacks.push(fb);
}

export function recordApproval(
  obs: RunObservability,
  toolId: string,
  decision: ApprovalRecord["decision"],
): void {
  obs.approvals.push({ toolId, decision, at: new Date().toISOString() });
}

export function recordVerificationEvidence(
  obs: RunObservability,
  kind: string,
  detail: string,
): void {
  obs.verificationEvidence.push({ kind, detail, at: new Date().toISOString() });
}

export function finishRunObservability(
  obs: RunObservability,
  outcome: RunObservability["outcome"],
): RunObservability {
  return { ...obs, endedAt: new Date().toISOString(), outcome };
}

/**
 * Compact diagnostic summary: which planned capabilities were actually
 * exercised. Useful for logs and for answering "why didn't LiTT use X?".
 */
export function summarizeCapabilityCoverage(obs: RunObservability): string {
  const called = new Set(obs.toolsCalled.map((c) => c.toolId));
  const plan = obs.capabilityPlan;
  if (!plan) return "no capability plan recorded";
  const lines: string[] = [];
  const exercised = (fam: CapabilityFamily): boolean => {
    const prefix: Record<CapabilityFamily, string[]> = {
      project_inspection: ["project.scan", "project.read_context", "files.list", "files.read"],
      filesystem: ["files.write", "files.patch", "project.insert_asset"],
      web_search: ["web.search"],
      web_fetch: ["web.fetch"],
      image_generation: ["image.generate"],
      terminal: ["terminal.execute"],
      preview: ["preview"],
      browser: ["browser."],
      deployment: ["project.deploy", "deploy.execute"],
      memory: ["memory."],
      git: ["git."],
    };
    return (prefix[fam] ?? []).some((p) =>
      [...called].some((id) => id === p || id.startsWith(p)),
    );
  };
  for (const fam of [...plan.required, ...plan.useful]) {
    lines.push(`${fam}: ${exercised(fam) ? "exercised" : "NOT exercised"}`);
  }
  return lines.join("; ");
}
