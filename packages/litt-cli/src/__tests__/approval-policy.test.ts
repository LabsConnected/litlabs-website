/**
 * Regression tests for the policy-aware approval handler.
 *
 * Proves:
 *   read tool                  → allowed
 *   safe scoped edit           → allowed in ACT
 *   dangerous shell command    → denied
 *   database reset             → denied
 *   force push                 → denied
 *   explicit --yes/approval    → only then permitted where policy allows
 */

import { describe, it, expect } from "vitest";
import { createPolicyApproval } from "../lib/approval-policy.js";
import type { RiskAssessment } from "@litt/agent-core";

function makeRisk(
  level: RiskAssessment["level"],
  capability: RiskAssessment["capability"],
  overrides: Partial<RiskAssessment> = {},
): RiskAssessment {
  return {
    level,
    capability,
    reason: "test",
    mutating: level !== "safe",
    ...overrides,
  };
}

describe("createPolicyApproval", () => {
  const handler = createPolicyApproval();

  it("read tool (safe, read_only) → allowed", async () => {
    const risk = makeRisk("safe", "read_only");
    const approved = await handler({}, risk);
    expect(approved).toBe(true);
  });

  it("safe scoped edit (elevated, workspace_edit) → allowed in ACT", async () => {
    const risk = makeRisk("elevated", "workspace_edit");
    const approved = await handler({}, risk);
    expect(approved).toBe(true);
  });

  it("arbitrary code (elevated, arbitrary_code) → allowed in ACT", async () => {
    const risk = makeRisk("elevated", "arbitrary_code");
    const approved = await handler({}, risk);
    expect(approved).toBe(true);
  });

  it("dangerous shell command (dangerous, destructive) → denied", async () => {
    // rm -rf, del, format, kill, etc.
    const risk = makeRisk("dangerous", "destructive", {
      reason: 'Command "rm" is classified as destructive',
    });
    const approved = await handler({}, risk);
    expect(approved).toBe(false);
  });

  it("database reset (dangerous, destructive) → denied", async () => {
    // Simulates a database reset command classified as destructive
    const risk = makeRisk("dangerous", "destructive", {
      reason: "Database reset is destructive",
    });
    const approved = await handler({}, risk);
    expect(approved).toBe(false);
  });

  it("force push (dangerous, external_action) → denied", async () => {
    // git push --force is external_action (affects systems outside workspace)
    const risk = makeRisk("dangerous", "external_action", {
      reason: 'Command "git" with "push" is external_action',
    });
    const approved = await handler({}, risk);
    expect(approved).toBe(false);
  });

  it("null risk assessment → denied (fail closed)", async () => {
    const approved = await handler({}, null);
    expect(approved).toBe(false);
  });

  it("unknown risk level → denied (fail closed)", async () => {
    const risk = makeRisk("safe" as RiskAssessment["level"], "read_only");
    // Simulate an unknown level by casting
    const unknownRisk = { ...risk, level: "unknown" as unknown as RiskAssessment["level"] };
    const approved = await handler({}, unknownRisk);
    expect(approved).toBe(false);
  });
});

describe("createPolicyApproval with --yes flag", () => {
  const handler = createPolicyApproval({ explicitYes: true });

  it("read tool (safe) → still allowed with --yes", async () => {
    const risk = makeRisk("safe", "read_only");
    const approved = await handler({}, risk);
    expect(approved).toBe(true);
  });

  it("elevated edit → still allowed with --yes", async () => {
    const risk = makeRisk("elevated", "workspace_edit");
    const approved = await handler({}, risk);
    expect(approved).toBe(true);
  });

  it("external_action (git push) → allowed with --yes", async () => {
    const risk = makeRisk("dangerous", "external_action");
    const approved = await handler({}, risk);
    expect(approved).toBe(true);
  });

  it("destructive (rm -rf) → STILL denied even with --yes", async () => {
    // --yes never allows truly destructive commands
    const risk = makeRisk("dangerous", "destructive");
    const approved = await handler({}, risk);
    expect(approved).toBe(false);
  });
});
