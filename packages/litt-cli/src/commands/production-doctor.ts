/**
 * litt production doctor — verify all production gates.
 *
 * Checks: git, Railway, production health, Stripe, pricing, webhook,
 * catalog, studio readiness, payment readiness.
 *
 * Never prints secret values.
 */

import { ok, fail, warn, header, c } from "../lib/utils.js";
import {
  runAllChecks,
  summarizeChecks,
  type CheckGroup,
  type CheckResult,
} from "../lib/production-checks.js";

export async function productionDoctorCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");

  header("LiTT Production Doctor");

  const groups = await runAllChecks();
  const summary = summarizeChecks(groups);

  if (json) {
    console.log(JSON.stringify({ groups, summary }, null, 2));
    return summary.verdict === "pass" ? 0 : 1;
  }

  // Display results grouped by category
  for (const group of groups) {
    console.log(`\n${c.bold}${group.name}${c.reset}`);
    for (const result of group.results) {
      printResult(result);
    }
  }

  // Summary
  console.log(`\n${c.gray}${"─".repeat(40)}${c.reset}`);
  console.log(
    `${c.bold}Production: ${summary.verdict === "pass" ? c.green + "READY" : summary.verdict === "warn" ? c.yellow + "DEGRADED" : c.red + "NOT READY"}${c.reset}`,
  );

  if (summary.failed > 0) {
    console.log(`${c.dim}  ${summary.passed} passed · ${summary.failed} failed · ${summary.warnings} warnings${c.reset}`);
    if (summary.firstFailure) {
      console.log(`\n${c.yellow}NEXT:${c.reset} ${summary.firstFailure.fix ?? "Fix the first failing check."}`);
      console.log(`${c.dim}  Run: litt production finish${c.reset}`);
    }
  } else if (summary.warnings > 0) {
    console.log(`${c.dim}  ${summary.passed} passed · ${summary.warnings} warnings${c.reset}`);
  } else {
    console.log(`${c.dim}  ${summary.passed} checks all passed${c.reset}`);
  }

  return summary.verdict === "pass" ? 0 : 1;
}

function printResult(result: CheckResult): void {
  const icon =
    result.status === "pass" ? `${c.green}✓${c.reset}` :
    result.status === "fail" ? `${c.red}✗${c.reset}` :
    result.status === "warn" ? `${c.yellow}!${c.reset}` :
    result.status === "blocked" ? `${c.red}●${c.reset}` :
    `${c.gray}○${c.reset}`;
  const detail = result.detail ? ` ${c.dim}— ${result.detail}${c.reset}` : "";
  console.log(`  ${icon} ${result.label}${detail}`);
  if (result.fix && result.status !== "pass") {
    console.log(`    ${c.dim}Fix: ${result.fix}${c.reset}`);
  }
}
