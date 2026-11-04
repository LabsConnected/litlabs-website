import { describe, expect, it } from "vitest";
import { validateRepairJob } from "../lib/repair/validation.js";

const validJob = {
  version: 1,
  incident: "CLI returns the wrong exit code for invalid input.",
  reproduction: {
    command: { command: "node", args: ["failure.cjs"] },
    expectedFailure: { stream: "stderr", includes: "expected failure" },
  },
  regression: {
    path: "src/__tests__/failure.test.ts",
    command: { command: "pnpm", args: ["exec", "vitest", "run", "src/__tests__/failure.test.ts"] },
  },
  editablePaths: ["src", "tests"],
  checks: [{
    name: "regression",
    kind: "focused",
    command: { command: "pnpm", args: ["exec", "vitest", "run", "src/__tests__/failure.test.ts"] },
  }],
};

describe("repair job contract", () => {
  it("accepts a bounded argv-based job", () => {
    const result = validateRepairJob(validJob);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reproduction.command.timeoutMs).toBe(120_000);
    expect(result.value.modelPolicy.allowEscalation).toBe(false);
  });

  it.each([
    ["unknown schema", { ...validJob, version: 2 }],
    ["missing checks", { ...validJob, checks: [] }],
    ["path traversal", { ...validJob, editablePaths: ["../outside"] }],
    ["absolute Windows path", { ...validJob, editablePaths: ["C:\\outside"] }],
    ["shell command", {
      ...validJob,
      reproduction: {
        ...validJob.reproduction,
        command: { command: "pnpm test && del *", args: [] },
      },
    }],
  ])("rejects %s", (_name, input) => {
    const result = validateRepairJob(input);
    expect(result.ok).toBe(false);
  });

  it("rejects cloud pins in offline mode", () => {
    const result = validateRepairJob({
      ...validJob,
      modelPolicy: {
        pinnedModel: "gpt-6.1-sol",
        allowedModels: ["gpt-6.1-sol"],
        allowEscalation: false,
        offline: true,
      },
    });
    expect(result.ok).toBe(false);
  });
});
