import { describe, expect, it } from "vitest";
import { createCommandPolicy } from "../lib/repair/command-policy.js";
import type { RepairJob } from "../lib/repair/contracts.js";

const command = {
  command: "pnpm",
  args: ["test"],
  timeoutMs: 120_000,
  maxOutputBytes: 131_072,
};

const job: RepairJob = {
  version: 1,
  incident: "A known failure needs a safe regression repair.",
  reproduction: {
    command,
    expectedFailure: { stream: "any", includes: "failed" },
  },
  regression: { path: "tests/failure.test.ts", command },
  editablePaths: ["src", "tests"],
  checks: [{ name: "focused", command, kind: "focused", required: true }],
  modelPolicy: {
    pinnedModel: null,
    allowedModels: [],
    allowEscalation: false,
    offline: false,
  },
};

describe("repair command policy", () => {
  it("allows only exact frozen command definitions", () => {
    const policy = createCommandPolicy(job);
    expect(policy.isAllowed(command)).toBe(true);
    expect(policy.isAllowed({ ...command, args: ["publish"] })).toBe(false);
    expect(policy.isAllowed({ ...command, timeoutMs: 600_000 })).toBe(false);
  });
});
