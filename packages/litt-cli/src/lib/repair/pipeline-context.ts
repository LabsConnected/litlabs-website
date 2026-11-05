import { resolve } from "node:path";
import { createCommandPolicy } from "./command-policy.js";
import { runEvidenceCommand } from "./command-runner.js";
import type { CommandEvidence, RepairJob, RepairReport } from "./contracts.js";
import type { resolveRepairProvider } from "./provider.js";
import { formatRepairReport, writeRepairReport } from "./report.js";

export interface PipelineContext {
  cwd: string;
  job: RepairJob;
  report: RepairReport;
  outputPath: string;
  assumeYes: boolean;
  deps: RepairPipelineDeps;
  /** Aborted on SIGINT so an interrupted run rolls back instead of dying mid-patch. */
  signal?: AbortSignal;
}

/** Injectable seams for tests — the real defaults hit live providers/TTY. */
export interface RepairPipelineDeps {
  resolveProvider?: typeof resolveRepairProvider;
  isTTY?: () => boolean;
  signal?: AbortSignal;
}

export function policyRunner(ctx: PipelineContext) {
  const policy = createCommandPolicy(ctx.job);
  return async (command: RepairJob["reproduction"]["command"], name: string): Promise<CommandEvidence> => {
    if (!policy.isAllowed(command)) {
      throw new Error(`Command not permitted by this repair job: ${name}`);
    }
    return runEvidenceCommand(command, { cwd: ctx.cwd, name, signal: ctx.signal });
  };
}

export async function persist(ctx: PipelineContext): Promise<void> {
  await writeRepairReport(ctx.outputPath, ctx.report);
}

export async function finish(ctx: PipelineContext, exitCode: number): Promise<number> {
  await persist(ctx);
  console.log(formatRepairReport(ctx.report));
  console.log("Evidence: " + resolve(ctx.outputPath));
  return exitCode;
}
