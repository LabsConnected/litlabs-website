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
 *   build → at least one mutating tool call whose success is VERIFIED by
 *           persisted workspace state: a read-back that confirms the
 *           claimed bytes landed, or the checkpoint diff showing the
 *           declared file actually changed
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
  /**
   * Workspace-relative file paths the call declared it would affect
   * (files.write path, files.rename newPath, …). Absent for tools whose
   * side effects are not declared on the call (terminal.execute, deploys):
   * for those, any real workspace change is the only corroboration possible.
   */
  paths?: string[];
  /**
   * Read-back verification of the claimed mutation, taken by re-reading
   * the workspace AFTER the tool reported success:
   *   true  — the claimed change is really persisted (written content
   *           matches, patch applied, deletion confirmed, rename landed)
   *   false — the claim was contradicted by what is actually on disk
   *   absent — not checked or not checkable for this tool
   *
   * This is the only evidence channel that works on gitless (static)
   * workspaces, where no checkpoint diff can ever be produced.
   */
  persisted?: boolean;
}

export interface DeploymentEvidence {
  started: boolean;
  succeeded: boolean;
  url: string | null;
  /** The live URL was actually fetched and verified, not merely returned. */
  urlVerified: boolean;
}

/**
 * What the workspace itself says, compared against the checkpoint taken
 * before the run's first mutation.
 *
 * Tool success flags describe what the model was TOLD happened. Only this
 * describes what is actually on disk. A tool that wrote bytes and then
 * returned failure leaves `changed: true` with no successful mutation, and
 * the run must not claim nothing happened.
 */
export type WorkspaceChangeStatus =
  /** The diff ran and found differences from the checkpoint. */
  | "changed"
  /** The diff ran and found none. */
  | "unchanged"
  /**
   * The comparison could not be made — no checkpoint, unreachable
   * workspace, or a failed diff. This is NOT "unchanged": claiming the
   * workspace is untouched because we failed to look is the exact false
   * negative this evidence exists to prevent.
   */
  | "unknown";

export interface WorkspaceChangeEvidence {
  status: WorkspaceChangeStatus;
  /** Paths that differ, when the diff could enumerate them. */
  files?: string[];
  /** The actual unified diff from the workspace, never model-authored. */
  diff?: string;
  /** File-level line counts derived from the unified diff. */
  additions?: number;
  deletions?: number;
  /** The checkpoint the comparison was made against. */
  checkpointSha?: string;
  /** Whether restoring that checkpoint is still possible. */
  rollbackAvailable?: boolean;
  /** Why the status is "unknown" — surfaced for support, never a claim. */
  unknownReason?: string;
}

export interface ExecutionEvidence {
  toolCalls: ToolCallEvidence[];
  deployment?: DeploymentEvidence | null;
  /**
   * Absent when no checkpoint existed (no mutation was ever attempted) or
   * the diff could not be taken. Absence is NOT proof that nothing changed,
   * so it never licenses a "nothing was changed" claim on its own.
   */
  workspaceChange?: WorkspaceChangeEvidence | null;
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
  /**
   * What the workspace itself says. "unknown" when no comparison was
   * possible — which is never the same as "unchanged".
   */
  workspaceChange?: WorkspaceChangeStatus;
  /** Paths that differ, when known. */
  changedFiles?: string[];
  /** Checkpoint the comparison was made against. */
  checkpointSha?: string;
  /** Whether restoring that checkpoint is still possible. */
  rollbackAvailable?: boolean;
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

/** Surface workspace-diff facts on the verdict for the UI to render. */
function changeFields(change: WorkspaceChangeEvidence | null) {
  if (!change) return { workspaceChange: "unknown" as const };
  return {
    workspaceChange: change.status,
    changedFiles: change.files,
    checkpointSha: change.checkpointSha,
    rollbackAvailable: change.rollbackAvailable,
  };
}

/**
 * Normalize a file path for comparison between a tool's declared inputs and
 * the paths the workspace diff enumerates: forward slashes, no leading "./"
 * or "/", collapsed separators, no trailing slash.
 */
function normalizeEvidencePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

/**
 * Mutating tools whose success can never produce workspace-file evidence —
 * their mutation surface is the tool boundary itself: a preview process,
 * a remote browser session, a memory record, a generated image, a
 * deployment pipeline. For these, tool-reported success IS the
 * verification channel: there is no file claim to read back, and a
 * legitimately-unchanged workspace diff cannot contradict them (a
 * preview.start produces no diff by design).
 *
 * Deliberately absent: terminal.execute, git.commit, and every file tool.
 * Their success does NOT prove a workspace change — an exit-0 command
 * that wrote nothing is the canonical false completion this evidence
 * exists to catch — so they keep the file-evidence requirement and must
 * never be added here.
 */
const BOUNDARY_VERIFIED_MUTATORS = new Set([
  "preview.start",
  "preview.stop",
  "preview.open",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.press",
  "browser.upload",
  "browser.download",
  "browser.close",
  "memory.store",
  "image.generate",
  "project.deploy",
  "deploy.execute",
  "deploy",
  "deploy.run",
  "deployment.create",
  "deployment.deploy",
  "vercel.deploy",
  "railway.deploy",
  "cloudflare.deploy",
]);

/**
 * Do any of the claim's declared paths appear in the diff? A declared
 * directory also matches a changed file inside it — git diffs enumerate
 * files, never the directories that contain them.
 */
function declaredPathMatched(declared: string[], changedFiles: Set<string>): boolean {
  for (const p of declared) {
    if (changedFiles.has(p)) return true;
    for (const f of changedFiles) {
      if (f.startsWith(`${p}/`)) return true;
    }
  }
  return false;
}

/**
 * Did this claimed successful mutation actually persist in the workspace?
 *
 * A read-back confirmation is the strongest signal — it names the exact
 * file and content. A contradicted read-back vetoes the claim outright:
 * a file reported written but read back with different content did not
 * persist as claimed, no matter what the diff says. Failing that, a call
 * that declares its target paths is verified only when the diff names at
 * least one of them; a call that declares none (terminal.execute and other
 * tools whose side effects are not enumerable from inputs) is corroborated
 * by any verified workspace change at all. Boundary mutators (preview.*,
 * browser.*, deploys, …) are verified by their own success — file
 * evidence is a category error for them.
 */
function mutationIsVerified(call: ToolCallEvidence, change: WorkspaceChangeEvidence | null): boolean {
  if (call.persisted === false) return false;
  if (call.persisted === true) return true;
  if (BOUNDARY_VERIFIED_MUTATORS.has(call.toolId)) return true;
  const declared = (call.paths ?? []).map(normalizeEvidencePath);
  if (change?.status !== "changed") return false;
  if (declared.length === 0) return true;
  const changedFiles = new Set((change.files ?? []).map(normalizeEvidencePath));
  return declaredPathMatched(declared, changedFiles);
}

/**
 * Does the evidence POSITIVELY say this claim did not persist?
 *
 *   - a read-back that found the workspace contradicting the claim
 *   - a verified-unchanged diff under a claim that required file evidence
 *   - a changed diff naming files — but none the claim declared it wrote
 *
 * Anything weaker (no diff, a check that could not run) is merely
 * unverifiable, not contradicted — absence of evidence is not evidence
 * of absence. Boundary mutators are never contradicted by the diff:
 * their success semantics are not file persistence.
 */
function mutationIsContradicted(call: ToolCallEvidence, change: WorkspaceChangeEvidence | null): boolean {
  if (call.persisted === false) return true;
  if (BOUNDARY_VERIFIED_MUTATORS.has(call.toolId)) return false;
  if (change?.status === "unchanged") return true;
  if (change?.status === "changed") {
    const declared = (call.paths ?? []).map(normalizeEvidencePath);
    // Undeclared-side-effect tools are corroborated by any real change,
    // so only a verified-unchanged diff can contradict them.
    if (declared.length === 0) return false;
    const changedFiles = new Set((change.files ?? []).map(normalizeEvidencePath));
    return !declaredPathMatched(declared, changedFiles);
  }
  return false;
}

/** The missing deployment evidence for a ship requirement — empty when satisfied. */
function deploymentGapMissing(deployment: DeploymentEvidence | null): string[] {
  if (!deployment || !deployment.started) return ["deployment"];
  if (!deployment.succeeded) return ["successful deployment"];
  if (!deployment.url || !deployment.urlVerified) return ["verified live URL"];
  return [];
}

/** " (2 files)" / " (index.html)" — empty when the diff could not name them. */
function fileSummary(change: WorkspaceChangeEvidence): string {
  const files = change.files ?? [];
  if (files.length === 0) return "";
  if (files.length === 1) return ` (${files[0]})`;
  return ` (${files.length} files)`;
}

/**
 * Judge completion from evidence alone.
 *
 * Every verdict carries the workspace-diff facts, on success and failure
 * alike, so no caller can render a completion state that contradicts what is
 * actually persisted.
 */
export function evaluateCompletion(
  requirement: WorkRequirement,
  evidence: ExecutionEvidence,
): CompletionVerdict {
  return {
    ...evaluateCompletionState(requirement, evidence),
    ...changeFields(evidence.workspaceChange ?? null),
  };
}

function evaluateCompletionState(
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

    // Tool flags say no mutation SUCCEEDED. They do not say the workspace
    // is untouched: a tool can write bytes and then fail, and a run can be
    // cancelled after a write lands. Only the checkpoint diff settles it,
    // so "nothing was changed" is claimed ONLY when the diff confirms it.
    const change = evidence.workspaceChange ?? null;

    if (change?.status === "changed") {
      return {
        ...base,
        ...changeFields(change),
        state: "failed",
        missing,
        reason: failedMutations > 0
          ? `No mutating tool call succeeded (${failedMutations} failed), but the workspace was changed${fileSummary(change)}. The run failed after making changes.`
          : `No mutating tool call reported success, but the workspace was changed${fileSummary(change)}. The run failed after making changes.`,
      };
    }

    // The diff is only evidence of "untouched" when it was actually taken.
    // Without it we say what we know — no successful mutation — and do not
    // assert anything about the workspace.
    const verifiedUnchanged = change?.status === "unchanged";

    if (failedMutations > 0) {
      return {
        ...base,
        ...changeFields(change),
        state: "failed",
        missing,
        reason: verifiedUnchanged
          ? `No mutating tool call succeeded (${failedMutations} failed) — the run failed before making changes.`
          : `No mutating tool call succeeded (${failedMutations} failed).`,
      };
    }

    return {
      ...base,
      ...changeFields(change),
      state: "not_started",
      missing,
      reason: attemptedMutations > 0
        ? verifiedUnchanged
          ? "No mutating tool call returned a successful result — the run failed before making changes."
          : "No mutating tool call returned a successful result."
        : verifiedUnchanged
          ? "No mutating tool call was made — nothing was changed."
          : "No mutating tool call was made.",
    };
  }

  // ── Mutation required, and a tool self-reported success — but that
  // report alone is not proof. A tool can return success:true/mutating:
  // true having written nothing (an exit-0 command whose output never
  // reached disk is the canonical case; it is exactly the "echo hello >
  // index.html, no shell, nothing written" shape, just on a different
  // transport). "Complete" therefore requires at least one claimed
  // mutation VERIFIED against what is really persisted — a read-back that
  // confirms the claimed bytes landed, or the baseline checkpoint diff
  // naming a file the call declared. The three failure shapes below are
  // deliberately distinct:
  //
  //   contradicted  — a read-back or a verified-unchanged diff positively
  //                   says the claimed change did not persist → failed
  //   unattributable — the diff shows changes, but in none of the files
  //                   the run declared it was writing → failed
  //   unverifiable  — neither the diff nor a read-back could check the
  //                   claim (no checkpoint, unreachable workspace,
  //                   provisioning still settling) → partial, never
  //                   "complete": a generation result must not be reported
  //                   successful on an unverifiable workspace.
  //
  // The requirement is evaluated PER CLAIM, not per run: one verified
  // mutation must not mask another claim the workspace contradicts or
  // cannot confirm. A non-verified claim is excused only when a LATER
  // verified claim covers the same declared path — a rewrite that landed
  // after it superseded the earlier attempt, so the persisted end state
  // is what was asked for. Undeclared claims cannot be superseded.
  if (requirement.mutation && successfulMutations > 0) {
    const change = evidence.workspaceChange ?? null;
    const claimedMutations = toolCalls.filter((c) => c.mutating && c.success === true);
    const verified = claimedMutations.map((c) => mutationIsVerified(c, change));

    // A non-verified claim is superseded only when EVERY path it
    // declared is covered by a later verified claim. A multi-path claim
    // (e.g. a rename declaring old and new) cannot be excused by a later
    // write that covers just one side — the uncovered half may have
    // silently not landed. Claims that declared no paths can never be
    // superseded (there is nothing to cover).
    const openClaims = claimedMutations.filter((c, i) => {
      if (verified[i]) return false;
      const declared = (c.paths ?? []).map(normalizeEvidencePath);
      if (declared.length === 0) return true;
      const superseded = declared.every((p) =>
        claimedMutations.some(
          (v, j) =>
            j > i &&
            verified[j] &&
            (v.paths ?? [])
              .map(normalizeEvidencePath)
              .some((vp) => vp === p || vp.startsWith(`${p}/`)),
        ),
      );
      return !superseded;
    });
    const contradictedClaims = openClaims.filter((c) => mutationIsContradicted(c, change));
    const unverifiableClaims = openClaims.filter((c) => !mutationIsContradicted(c, change));

    if (contradictedClaims.length > 0) {
      const deniedByReadBack = contradictedClaims.find((c) => c.persisted === false);
      if (deniedByReadBack) {
        missing.push("the reported mutation to actually persist");
        return {
          ...base,
          ...changeFields(change),
          state: "failed",
          missing,
          reason:
            `A tool reported a successful mutation, but re-reading the workspace did not find the claimed change` +
            `${deniedByReadBack.paths?.length ? ` (${deniedByReadBack.paths.map(normalizeEvidencePath).join(", ")})` : ""}. ` +
            `The reported success is not supported by the actual workspace state.`,
        };
      }

      if (change?.status === "unchanged") {
        missing.push("workspace change matching the reported mutation");
        return {
          ...base,
          ...changeFields(change),
          state: "failed",
          missing,
          reason: `A tool reported a successful mutation, but the workspace diff shows no changes. ` +
            `The reported success is not supported by the actual workspace state.`,
        };
      }

      // Reachable only under a "changed" diff: the claims still open
      // declared target paths and none of them appear in it.
      missing.push("workspace change in a file the run declared it was writing");
      return {
        ...base,
        ...changeFields(change),
        state: "failed",
        missing,
        reason:
          `A tool reported a successful mutation and the workspace changed${fileSummary(change!)}, ` +
          `but not in any file the run declared it was writing. The reported success is not ` +
          `corroborated by the actual workspace state.`,
      };
    }

    if (unverifiableClaims.length > 0) {
      // The comparison could not be made at all, or the claim's own
      // check could not run. Absence of evidence is not evidence of
      // absence — but it is never proof of success either, so the run
      // stays short of "complete" and says why. Deployment gaps are
      // reported first — a ship request missing BOTH must name the
      // deployment the user actually asked for.
      const deploymentGaps = requirement.deployment
        ? deploymentGapMissing(evidence.deployment ?? null)
        : [];
      missing.push(...deploymentGaps);
      missing.push("verified workspace change matching the reported mutation");
      return {
        ...base,
        ...changeFields(change),
        state: "partial",
        missing,
        reason:
          `A tool reported a successful mutation, but the workspace could not be checked to confirm ` +
          `the change persisted` +
          `${change?.unknownReason ? ` (${change.unknownReason})` : ""}.`,
      };
    }
  }

  // ── Deployment required ──
  if (requirement.deployment) {
    const gaps = deploymentGapMissing(evidence.deployment ?? null);
    if (gaps.length > 0) {
      missing.push(...gaps);
      return {
        ...base,
        state: "partial",
        missing,
        reason:
          gaps[0] === "deployment"
            ? "Files were changed but no deployment was started."
            : gaps[0] === "successful deployment"
              ? "A deployment started but did not succeed."
              : "The deployment succeeded but its live URL was not verified.",
      };
    }
  }

  return {
    ...base,
    state: "complete",
    missing,
    reason: requirement.deployment
      ? `${completedSteps} of ${totalSteps} step(s) succeeded and the live URL was verified.`
      : `${completedSteps} of ${totalSteps} step(s) succeeded, including a verified mutation.`,
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
