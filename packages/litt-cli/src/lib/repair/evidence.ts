import type { CommandEvidence, RepairJob } from "./contracts.js";

export interface ReproductionEvaluation {
  reproduced: boolean;
  reason: string;
}

export function evaluateReproduction(
  evidence: CommandEvidence,
  expectation: RepairJob["reproduction"]["expectedFailure"],
): ReproductionEvaluation {
  if (evidence.status === "spawn-error") {
    return { reproduced: false, reason: "The executable could not be started" };
  }
  if (evidence.status === "timeout" || evidence.status === "cancelled") {
    return { reproduced: false, reason: "The command did not finish naturally" };
  }
  if (evidence.exitCode === null || evidence.exitCode === 0) {
    return { reproduced: false, reason: "The reproduction command did not fail" };
  }

  const haystack = selectOutput(evidence, expectation.stream);
  if (!haystack.includes(expectation.includes)) {
    return {
      reproduced: false,
      reason: "The failure output did not contain the expected evidence",
    };
  }
  return { reproduced: true, reason: "Expected failure reproduced" };
}

function selectOutput(
  evidence: CommandEvidence,
  stream: RepairJob["reproduction"]["expectedFailure"]["stream"],
): string {
  if (stream === "stdout") return evidence.stdout;
  if (stream === "stderr") return evidence.stderr;
  return evidence.stdout + "\n" + evidence.stderr;
}
