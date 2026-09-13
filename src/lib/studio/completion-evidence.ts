/**
 * Truthful completion semantics.
 *
 * A work item may be called complete ONLY when evidence shows the requested
 * work actually happened. A conversational acknowledgement is never
 * evidence of completion.
 *
 * Before this module, the Studio work log counted
 * `message.actions?.length ?? 1`, so a text-only reply to a build request
 * rendered as "1 of 1 steps complete" — no tool call, no file mutation, no
 * build, no deployment. The `actions` array holds *proposed* canvas actions
 * the user can click, which is the opposite of completed work.
 *
 * Evidence required, by request kind:
 *   build → at least one mutating tool call with a successful result
 *   ship  → the above, plus a deployment that started, succeeded, and whose
 *           live URL was verified
 */

/** What a request demands before it can be called done. */
export interface WorkRequirement {
  /** At least one successful mutating tool call is required. */
  mutation: boolean;
  /** A deployment with a verified live URL is required. */
  deployment: boolean;
}

export type CompletionState =
  /** No work was requested — a conversation, so there is no work log. */
  | "conversational"
  /** Work was required and no qualifying action was taken. */
  | "not_started"
  /** Some required evidence is present, some is missing. */
  | "partial"
  /** Every requirement is satisfied by evidence. */
  | "complete"
  /** The work was attempted and failed. */
  | "failed";

export interface ToolCallEvidence {
  toolId: string;
  /** undefined while the call is in flight — absence of a result is not success. */
  success?: boolean;
  /** Whether this tool mutates state (files, git, external services). */
  mutating: boolean;
}

export interface DeploymentEvidence {
  started: boolean;
  succeeded: boolean;
  url: string | null;
  /** The live URL was actually fetched and verified, not merely returned. */
  urlVerified: boolean;
}

export interface ExecutionEvidence {
  toolCalls: ToolCallEvidence[];
  deployment?: DeploymentEvidence | null;
}

export interface CompletionVerdict {
  state: CompletionState;
  /** Tool calls that returned a successful result. */
  completedSteps: number;
  /** Tool calls attempted. */
  totalSteps: number;
  /** Evidence the requirement demands that is absent. */
  missing: string[];
  /** Human-readable justification for the verdict. */
  reason: string;
}

/**
 * Derive the evidence requirement from the kernel's routing mode.
 *
 * `ship` covers deploy/publish/release requests; `build` covers
 * implementation and file edits. Every other mode is conversational and
 * demands no execution evidence.
 */
export function requirementForMode(mode: string): WorkRequirement {
  if (mode === "ship") return { mutation: true, deployment: true };
  if (mode === "build") return { mutation: true, deployment: false };
  return { mutation: false, deployment: false };
}

/** Judge completion from evidence alone. */
export function evaluateCompletion(
  requirement: WorkRequirement,
  evidence: ExecutionEvidence,
): CompletionVerdict {
  const toolCalls = evidence.toolCalls ?? [];
  const totalSteps = toolCalls.length;
  const completedSteps = toolCalls.filter((c) => c.success === true).length;
  const missing: string[] = [];

  const successfulMutations = toolCalls.filter((c) => c.mutating && c.success === true).length;
  const attemptedMutations = toolCalls.filter((c) => c.mutating).length;
  const failedMutations = toolCalls.filter((c) => c.mutating && c.success === false).length;

  const base = { completedSteps, totalSteps };

  // ── No execution requirement: a conversation, or incidental tool use ──
  if (!requirement.mutation && !requirement.deployment) {
    if (totalSteps === 0) {
      return {
        ...base,
        state: "conversational",
        missing,
        reason: "No execution was requested — conversational exchange.",
      };
    }
    const anyFailed = toolCalls.some((c) => c.success === false);
    return {
      ...base,
      state: anyFailed && completedSteps === 0 ? "failed" : "complete",
      missing,
      reason: `${completedSteps} of ${totalSteps} tool call(s) succeeded.`,
    };
  }

  // ── Mutation required ──
  if (requirement.mutation && successfulMutations === 0) {
    missing.push("mutating tool call");
    missing.push("file mutation");
    if (requirement.deployment) missing.push("deployment");

    // A mutation was attempted and failed — that is a failure, not an
    // untouched task.
    if (failedMutations > 0) {
      return {
        ...base,
        state: "failed",
        missing,
        reason: `No mutating tool call succeeded (${failedMutations} failed) — nothing was changed.`,
      };
    }

    return {
      ...base,
      state: "not_started",
      missing,
      reason: attemptedMutations > 0
        ? "No mutating tool call returned a successful result — nothing was changed."
        : "No mutating tool call was made — nothing was changed.",
    };
  }

  // ── Deployment required ──
  if (requirement.deployment) {
    const deployment = evidence.deployment ?? null;
    if (!deployment || !deployment.started) {
      missing.push("deployment");
      return {
        ...base,
        state: "partial",
        missing,
        reason: "Files were changed but no deployment was started.",
      };
    }
    if (!deployment.succeeded) {
      missing.push("successful deployment");
      return {
        ...base,
        state: "partial",
        missing,
        reason: "A deployment started but did not succeed.",
      };
    }
    if (!deployment.url || !deployment.urlVerified) {
      missing.push("verified live URL");
      return {
        ...base,
        state: "partial",
        missing,
        reason: "The deployment succeeded but its live URL was not verified.",
      };
    }
  }

  return {
    ...base,
    state: "complete",
    missing,
    reason: requirement.deployment
      ? `${completedSteps} of ${totalSteps} step(s) succeeded and the live URL was verified.`
      : `${completedSteps} of ${totalSteps} step(s) succeeded, including a file mutation.`,
  };
}

/**
 * The work-log line for a verdict, or `null` when no work log should be
 * rendered at all (a conversational exchange has no work to log).
 */
export function workLogLabel(verdict: CompletionVerdict): string | null {
  switch (verdict.state) {
    case "conversational":
      return null;
    case "not_started":
      return "No action taken — work not started";
    case "failed":
      return verdict.totalSteps > 0
        ? `0 of ${verdict.totalSteps} steps complete — failed`
        : "Failed — no work completed";
    case "partial": {
      const missing = verdict.missing[0] ? ` · ${verdict.missing[0]} missing` : "";
      return `${verdict.completedSteps} of ${verdict.totalSteps} steps complete${missing}`;
    }
    case "complete":
      return `${verdict.completedSteps} of ${verdict.totalSteps} steps complete`;
  }
}

/**
 * Tool ids that actually perform a deployment.
 *
 * `project.deploy` is the real V1 capability: it collects the workspace's
 * static output, publishes it, and fetches the resulting public URL before
 * returning success.
 */
const DEPLOY_TOOL_IDS = new Set([
  "project.deploy",
  "deploy",
  "deploy.run",
  "deployment.create",
  "deployment.deploy",
  "vercel.deploy",
  "railway.deploy",
  "cloudflare.deploy",
]);

/**
 * Deploy tools that verify the live URL themselves before reporting success.
 *
 * For these, a successful result already means the URL was fetched, so no
 * separate verification call is required. Every other deploy tool still
 * needs an explicit check afterwards.
 */
const SELF_VERIFYING_DEPLOY_TOOLS = new Set(["project.deploy"]);

/** Tool ids that can verify a live URL actually serves. */
const URL_VERIFY_TOOL_IDS = new Set([
  "browser.navigate",
  "browser.snapshot",
  "web.fetch",
  "browser_test",
]);

/**
 * Derive deployment evidence from a tool log.
 *
 * Deliberately conservative: a live URL counts as verified only when a
 * verification tool ran successfully AFTER a successful deploy. Returns null
 * when no deployment was attempted — which keeps a deploy request honestly
 * "partial" rather than complete.
 *
 * Note: the V2 agent loop currently exposes no deployment tool, so this
 * returns null for every run until one is added.
 */
export function deploymentEvidenceFrom(
  toolCalls: Array<{ toolId: string; success: boolean }>,
): DeploymentEvidence | null {
  const deployIndex = toolCalls.findIndex((c) => DEPLOY_TOOL_IDS.has(c.toolId));
  if (deployIndex === -1) return null;

  const deployCall = toolCalls[deployIndex];
  const selfVerifying = SELF_VERIFYING_DEPLOY_TOOLS.has(deployCall.toolId);
  const verifiedAfter = toolCalls
    .slice(deployIndex + 1)
    .some((c) => URL_VERIFY_TOOL_IDS.has(c.toolId) && c.success);

  return {
    started: true,
    succeeded: deployCall.success,
    // A self-verifying deploy tool fetched the URL as part of succeeding, so
    // its success carries the URL. There is no separate url value to record
    // here — the tool result holds it.
    url: deployCall.success && selfVerifying ? "verified-by-tool" : null,
    urlVerified: deployCall.success && (selfVerifying || verifiedAfter),
  };
}
