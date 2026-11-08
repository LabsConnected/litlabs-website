import { describe, expect, it } from "vitest";
import { createRepairReport, formatRepairReport } from "../lib/repair/report.js";
import type { RepairJob } from "../lib/repair/contracts.js";

const job: RepairJob = {
  version: 1,
  incident: "The CLI returns the wrong exit code.",
  reproduction: {
    command: { command: "node", args: [], timeoutMs: 1_000, maxOutputBytes: 4_096 },
    expectedFailure: { stream: "any", includes: "wrong" },
  },
  regression: {
    path: "tests/failure.test.ts",
    command: { command: "node", args: [], timeoutMs: 1_000, maxOutputBytes: 4_096 },
  },
  editablePaths: ["src"],
  checks: [{
    name: "focused",
    kind: "focused",
    required: true,
    command: { command: "node", args: [], timeoutMs: 1_000, maxOutputBytes: 4_096 },
  }],
  modelPolicy: {
    pinnedModel: null,
    allowedModels: [],
    allowEscalation: false,
    offline: false,
  },
};

describe("repair reports", () => {
  it("does not imply checks ran in a fresh report", () => {
    const formatted = formatRepairReport(createRepairReport(job, "repair-test"));
    expect(formatted).toContain("Status: PREFLIGHT");
    expect(formatted).toContain("Focused tests: NOT RUN");
    expect(formatted).toContain("Independent verification: NOT RUN");
  });
});
