import { randomUUID } from "node:crypto";
import type { RuntimeSession } from "../lib/runtime-session.js";
import type { RepairJob } from "../lib/repair/contracts.js";
import { diagnoseFailure } from "../lib/repair/diagnose.js";
import { evaluateReproduction } from "../lib/repair/evidence.js";
import type { ContextPatch } from "../lib/repair/patch.js";
import {
  finish,
  persist,
  policyRunner,
  type PipelineContext,
  type RepairPipelineDeps,
} from "../lib/repair/pipeline-context.js";
import { resolveRepairProvider } from "../lib/repair/provider.js";
import {
  createRepairReport,
  digestRepairJob,
  formatRepairReport,
  readRepairReport,
  repairReportPath,
} from "../lib/repair/report.js";
import { loadRepairJob } from "../lib/repair/validation.js";
import { resolveExistingWorkspacePath } from "../lib/repair/workspace-policy.js";
import { applyAndVerify, resumeValidation } from "./repair-apply.js";

export type { RepairPipelineDeps } from "../lib/repair/pipeline-context.js";

const HELP = [
  "LiTT autonomous repair",
  "",
  "Usage:",
  "  litt repair start  --job <repair-job.json> [--yes]",
  "  litt repair resume --run <repair-runId> --job <repair-job.json> [--yes]",
  "  litt repair --help",
  "",
  "A repair job declares the exact reproduction, regression command, editable",
  "paths, validation commands, and model-routing policy. The pipeline:",
  "  reproduce → regression-red → diagnose → approve → patch →",
  "  focused checks → full checks → independent re-reproduction → report",
  "",
  "Nothing is applied without approval. --yes pre-authorizes the apply step",
  "(required non-interactively). Without it a run parks at partially-verified",
  "and `litt repair resume --run <id> --yes` continues exactly where it stopped.",
  "Ctrl+C during validation rolls the patch back before exiting.",
  "",
  "Exit codes: 0 complete · 1 blocked/cancelled · 2 usage/config ·",
  "            3 parked (awaiting approval or provider) · 4 failed+restored ·",
  "            5 applied but unproven (regression not red first, or unrelated changes)",
].join("\n");

export async function repairCommand(
  args: string[],
  session?: RuntimeSession,
  _context?: unknown,
  deps: RepairPipelineDeps = {},
): Promise<number> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const action = args[0];
  if (action !== "start" && action !== "resume") {
    console.error("Unknown repair action. Run 'litt repair --help'.");
    return 2;
  }
  const jobArgument = optionValue(args, "--job");
  if (!jobArgument) {
    console.error("Missing required option: --job <repair-job.json>");
    return 2;
  }

  const interrupt = new AbortController();
  const onInterrupt = (): void => interrupt.abort();
  process.once("SIGINT", onInterrupt);
  try {
    return await dispatchAction({
      action,
      args,
      jobArgument,
      cwd: session?.getCwd() ?? process.cwd(),
      assumeYes: args.includes("--yes") || args.includes("-y"),
      deps,
      signal: deps.signal ?? interrupt.signal,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}

interface DispatchRequest {
  action: "start" | "resume";
  args: string[];
  jobArgument: string;
  cwd: string;
  assumeYes: boolean;
  deps: RepairPipelineDeps;
  signal: AbortSignal;
}

async function dispatchAction(request: DispatchRequest): Promise<number> {
  const { cwd, assumeYes, deps, signal } = request;
  const jobPath = await resolveExistingWorkspacePath(cwd, request.jobArgument);
  const loaded = await loadRepairJob(jobPath);
  if (!loaded.ok) {
    console.error(loaded.error);
    return 2;
  }

  if (request.action === "start") {
    const report = createRepairReport(loaded.value, "repair-" + randomUUID());
    const ctx: PipelineContext = {
      cwd, job: loaded.value, report, outputPath: repairReportPath(cwd, report.runId), assumeYes, deps, signal,
    };
    return runStartPipeline(ctx);
  }

  const runId = optionValue(request.args, "--run");
  if (!runId) {
    console.error("Missing required option: --run <repair-runId>");
    return 2;
  }
  if (!/^[\w-]+$/.test(runId)) {
    console.error("Invalid run id — path characters are not allowed");
    return 2;
  }
  const outputPath = repairReportPath(cwd, runId);
  const prior = await readRepairReport(outputPath);
  if (!prior) {
    console.error(`No resumable repair report at ${outputPath}`);
    return 2;
  }
  if (prior.stage === "complete" || prior.stage === "cancelled") {
    console.log(formatRepairReport(prior));
    return prior.stage === "complete" ? 0 : 1;
  }
  if (prior.jobDigest && prior.jobDigest !== digestRepairJob(loaded.value)) {
    console.error(
      "Refusing to resume: the job file differs from the one this run started with. " +
        "A changed job could widen editable paths or commands. Start a new run instead.",
    );
    return 2;
  }
  return resumePipeline({ cwd, job: loaded.value, report: prior, outputPath, assumeYes, deps, signal });
}

// ─── start: reproduce → regression-red → diagnose → propose ────────

async function runStartPipeline(ctx: PipelineContext): Promise<number> {
  const run = policyRunner(ctx);
  const { report, job } = ctx;
  await persist(ctx);

  report.stage = "reproducing";
  await persist(ctx);
  report.reproduction = await run(job.reproduction.command, "original failure");
  const evaluation = evaluateReproduction(report.reproduction, job.reproduction.expectedFailure);
  if (!evaluation.reproduced) {
    report.stage = "blocked";
    report.blockReason = "reproduction";
    report.remainingRisks.push("Could not reproduce: " + evaluation.reason);
    return finish(ctx, 1);
  }

  report.stage = "regression-red";
  await persist(ctx);
  report.regressionRed = await run(job.regression.command, "regression red check");
  if (report.regressionRed.status === "success" && report.regressionRed.exitCode === 0) {
    report.remainingRisks.push(
      "Regression command was already green before patching — it may not cover this failure",
    );
  }
  return diagnoseAndApply(ctx);
}

/** Shared by start and by resume-after-provider-block: diagnose, persist the proposal, then apply. */
async function diagnoseAndApply(ctx: PipelineContext): Promise<number> {
  const { report, job } = ctx;
  if (!report.reproduction) {
    report.stage = "blocked";
    report.remainingRisks.push("Cannot diagnose: no reproduction evidence recorded");
    return finish(ctx, 1);
  }
  report.stage = "diagnosing";
  await persist(ctx);
  const providerOutcome = await (ctx.deps.resolveProvider ?? resolveRepairProvider)(job);
  if (!providerOutcome.ok) {
    report.stage = "blocked";
    report.blockReason = providerOutcome.reason;
    report.remainingRisks.push(providerOutcome.error);
    return finish(ctx, 3);
  }
  const diagnosis = await diagnoseFailure(ctx.cwd, job, report.reproduction, providerOutcome.handle, ctx.signal);
  if (!diagnosis.ok) {
    report.stage = "blocked";
    report.blockReason = "proposal";
    report.remainingRisks.push(diagnosis.error);
    return finish(ctx, 1);
  }
  report.rootCause = diagnosis.diagnosis.rootCause;
  report.diagnosis = {
    rootCause: diagnosis.diagnosis.rootCause,
    model: diagnosis.diagnosis.model,
    providerId: diagnosis.diagnosis.providerId,
  };
  report.proposedPatches = diagnosis.diagnosis.patches;
  await persist(ctx);
  return applyAndVerify(ctx, diagnosis.diagnosis.patches);
}

// ─── resume: pick up wherever the persisted report stopped ─────────

async function resumePipeline(ctx: PipelineContext): Promise<number> {
  const { report } = ctx;
  if (report.filesChanged.length > 0) {
    // Crashed mid-validation — patches already applied, re-run checks with the persisted rollback state.
    return resumeValidation(ctx);
  }
  if (Array.isArray(report.proposedPatches) && report.proposedPatches.length > 0) {
    // Diagnosis persisted — skip straight to approval + apply.
    return applyAndVerify(ctx, report.proposedPatches as ContextPatch[]);
  }
  const providerBlocked = report.blockReason === "billing"
    || report.blockReason === "no-provider"
    || report.blockReason === "offline";
  if (providerBlocked) return diagnoseAndApply(ctx);

  report.stage = "blocked";
  report.remainingRisks.push("Nothing resumable in this report — start a fresh run");
  return finish(ctx, 1);
}

function optionValue(args: string[], option: string): string | null {
  const index = args.indexOf(option);
  if (index < 0 || index === args.length - 1) return null;
  return args[index + 1];
}

export type { RepairJob };
