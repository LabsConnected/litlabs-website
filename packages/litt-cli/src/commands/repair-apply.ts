/**
 * Apply + validate stages of the repair pipeline.
 *
 * Invariant: once a patch is on disk, every exit path — failed check, thrown
 * error, SIGINT — either restores the snapshots or says plainly that it could
 * not. "Workspace restored" is only ever written after a restore succeeded.
 */
import { requestRepairApproval } from "../lib/repair/approve.js";
import { commandKey } from "../lib/repair/command-policy.js";
import type { CommandEvidence } from "../lib/repair/contracts.js";
import { evaluateReproduction } from "../lib/repair/evidence.js";
import { applyContextPatches, type ContextPatch } from "../lib/repair/patch.js";
import { finish, persist, policyRunner, type PipelineContext } from "../lib/repair/pipeline-context.js";
import {
  loadSnapshots,
  persistSnapshots,
  repairSnapshotPath,
  restoreSnapshots,
  snapshotPatchTargets,
  type FileSnapshot,
} from "../lib/repair/snapshot.js";
import {
  captureWorkspaceManifest,
  findUnrelatedChanges,
  loadManifest,
  persistManifest,
  repairManifestPath,
  type WorkspaceManifest,
} from "../lib/repair/workspace-manifest.js";

const EXIT_FAILED_RESTORED = 4;
const EXIT_UNPROVEN = 5;

const passed = (evidence: CommandEvidence): boolean => evidence.status === "success" && evidence.exitCode === 0;

export async function applyAndVerify(ctx: PipelineContext, patches: ContextPatch[]): Promise<number> {
  const { report, job } = ctx;
  const approval = await requestRepairApproval({
    assumeYes: ctx.assumeYes,
    isTTY: ctx.deps.isTTY ? ctx.deps.isTTY() : Boolean(process.stdout.isTTY),
    rootCause: report.rootCause ?? "not established",
    patches,
  });
  if (approval === "unavailable") {
    report.stage = "partially-verified";
    report.blockReason = "approval";
    report.remainingRisks.push(
      "Approval required — resume with: litt repair resume --run " + report.runId + " --job <job> --yes",
    );
    return finish(ctx, 3);
  }
  if (approval === "declined") {
    report.stage = "cancelled";
    report.remainingRisks.push("Operator declined the proposed patch");
    return finish(ctx, 1);
  }

  report.stage = "patching";
  await persist(ctx);
  const before = await captureWorkspaceManifest(ctx.cwd);
  const snapshots = await snapshotPatchTargets(ctx.cwd, patches);
  // Persisted BEFORE the first write so a crash mid-validation stays recoverable.
  await persistSnapshots(repairSnapshotPath(ctx.outputPath), snapshots);
  await persistManifest(repairManifestPath(ctx.outputPath), before);
  try {
    report.filesChanged = await applyContextPatches(ctx.cwd, patches, job.editablePaths);
  } catch (error) {
    return failAndRestore(ctx, snapshots, "Patch application failed: " + describe(error));
  }
  await persist(ctx);
  return validateAndVerify(ctx, snapshots, before);
}

/** Resume path: patches are already on disk, so recover the persisted rollback state. */
export async function resumeValidation(ctx: PipelineContext): Promise<number> {
  const snapshots = await loadSnapshots(repairSnapshotPath(ctx.outputPath));
  const before = await loadManifest(repairManifestPath(ctx.outputPath));
  if (!snapshots) {
    ctx.report.remainingRisks.push(
      "Rollback snapshots are missing for this run — a failed check cannot be undone automatically",
    );
  }
  return validateAndVerify(ctx, snapshots, before);
}

async function validateAndVerify(
  ctx: PipelineContext,
  snapshots: FileSnapshot[] | null,
  before: WorkspaceManifest | null,
): Promise<number> {
  try {
    return await runValidation(ctx, snapshots, before);
  } catch (error) {
    return failAndRestore(ctx, snapshots, "Validation aborted unexpectedly: " + describe(error));
  }
}

async function runValidation(
  ctx: PipelineContext,
  snapshots: FileSnapshot[] | null,
  before: WorkspaceManifest | null,
): Promise<number> {
  const run = policyRunner(ctx);
  const { report, job } = ctx;
  const fail = (message: string): Promise<number> => failAndRestore(ctx, snapshots, message);

  report.stage = "focused-validation";
  await persist(ctx);
  const focused = job.checks.filter((check) => check.kind === "focused");
  for (const check of focused) {
    const evidence = await run(check.command, `focused: ${check.name}`);
    report.focusedTests.push(evidence);
    await persist(ctx);
    if (check.required && !passed(evidence)) return fail(`Focused check "${check.name}" failed`);
  }

  const regressionKey = commandKey(job.regression.command);
  if (!focused.some((check) => commandKey(check.command) === regressionKey)) {
    const evidence = await run(job.regression.command, "regression green check");
    report.focusedTests.push(evidence);
    await persist(ctx);
    if (!passed(evidence)) return fail("The declared regression command did not pass after patching");
  }

  report.stage = "full-validation";
  await persist(ctx);
  for (const check of job.checks.filter((candidate) => candidate.kind !== "focused")) {
    const evidence = await run(check.command, `${check.kind}: ${check.name}`);
    report.fullChecks.push(evidence);
    await persist(ctx);
    if (check.required && !passed(evidence)) return fail(`Required check "${check.name}" failed`);
  }

  report.stage = "independent-verification";
  await persist(ctx);
  const verify = await run(job.reproduction.command, "independent re-reproduction");
  report.independentVerification.push(verify);
  if (evaluateReproduction(verify, job.reproduction.expectedFailure).reproduced) {
    return fail("The original failure still reproduces after patching");
  }
  if (verify.exitCode !== 0) {
    report.remainingRisks.push(
      "Original failure signature is gone, but the reproduction command still exits non-zero — inspect before releasing",
    );
  }
  return conclude(ctx, before);
}

/** COMPLETE requires proof the regression test was red first and nothing unrelated moved. */
async function conclude(ctx: PipelineContext, before: WorkspaceManifest | null): Promise<number> {
  const { report } = ctx;
  const wasGreen = report.regressionRed !== null && passed(report.regressionRed);
  if (before) {
    const after = await captureWorkspaceManifest(ctx.cwd);
    report.unrelatedChanges = findUnrelatedChanges(before, after, report.filesChanged);
  } else {
    report.remainingRisks.push("Unrelated-change detection unavailable: no pre-patch manifest was recorded");
  }

  if (report.unrelatedChanges.length > 0) {
    report.remainingRisks.push("Files changed outside the approved patch: " + report.unrelatedChanges.join(", "));
  }
  if (wasGreen) {
    report.remainingRisks.push("Regression command was already green before patching — it does not prove this fix");
  }
  if (wasGreen || report.unrelatedChanges.length > 0 || !before) {
    report.stage = "partially-verified";
    report.blockReason = report.unrelatedChanges.length > 0 ? "unrelated-changes" : "regression-coverage";
    return finish(ctx, EXIT_UNPROVEN);
  }
  report.stage = "complete";
  return finish(ctx, 0);
}

async function failAndRestore(
  ctx: PipelineContext,
  snapshots: FileSnapshot[] | null,
  reason: string,
): Promise<number> {
  const { report } = ctx;
  let restoreNote: string;
  if (!snapshots) {
    restoreNote = "NO ROLLBACK POSSIBLE — snapshots unavailable, inspect: " + report.filesChanged.join(", ");
  } else {
    const outcome = await restoreSnapshots(ctx.cwd, snapshots);
    restoreNote = outcome.failed.length === 0
      ? "workspace restored (changes rolled back)"
      : "RESTORE INCOMPLETE — manual action needed for: "
        + outcome.failed.map((failure) => `${failure.path} (${failure.error})`).join("; ");
  }
  report.stage = "failed";
  report.blockReason = ctx.signal?.aborted ? "interrupted" : "validation";
  report.remainingRisks.push(`${reason} — ${restoreNote}`);
  return finish(ctx, EXIT_FAILED_RESTORED);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
