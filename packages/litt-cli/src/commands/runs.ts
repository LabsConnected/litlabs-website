/**
 * litt runs — List recent persisted runs (P0-5).
 *
 * Shows run ID, status, age, duration, and task summary.
 * Reads from ~/.litt/runs/*.json via the RunStore.
 */

import { header, ok, fail, c, label, value } from "../lib/utils.js";
import { listRuns, formatRunListEntry, timeAgo } from "../lib/run-store.js";

export async function runsCommand(): Promise<number> {
  header("Recent Runs");

  const runs = listRuns();
  if (runs.length === 0) {
    ok("No persisted runs found.");
    console.log(`${c.dim}  Runs are saved automatically when a Plan or audit completes.${c.reset}`);
    return 0;
  }

  console.log(`${c.dim}  ${"RUN ID".padEnd(36)}${"STATUS".padEnd(12)}${"AGE".padEnd(8)}${"DURATION".padEnd(10)}TASK${c.reset}`);
  console.log(`${c.dim}  ${"-".repeat(36)}${"-".repeat(12)}${"-".repeat(8)}${"-".repeat(10)}${"-".repeat(30)}${c.reset}`);

  for (const run of runs) {
    const statusColor = run.status === "success" ? c.green
      : run.status === "failed" ? c.red
      : run.status === "running" ? c.yellow
      : c.dim;
    console.log(
      `  ${c.gray}${run.runId.padEnd(36)}${c.reset}` +
      `${statusColor}${run.status.padEnd(12)}${c.reset}` +
      `${c.dim}${timeAgo(run.startedAt).padEnd(8)}${c.reset}` +
      `${c.dim}${(run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "—").padEnd(10)}${c.reset}` +
      `${run.task.length > 50 ? run.task.slice(0, 49) + "…" : run.task}`,
    );
  }

  console.log("");
  console.log(`${c.dim}  ${runs.length} run${runs.length === 1 ? "" : "s"} persisted${c.reset}`);
  console.log(`${c.dim}  View a run:     litt run <id>${c.reset}`);
  console.log(`${c.dim}  View result:    litt run result <id>${c.reset}`);
  console.log(`${c.dim}  View logs:      litt run logs <id>${c.reset}`);

  return 0;
}
