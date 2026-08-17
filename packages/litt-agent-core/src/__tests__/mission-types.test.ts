/**
 * Phase 1 Tests — Mission Types
 *
 * Validates that mission domain types work correctly.
 */

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateMissionId,
  generateStepId,
  generateEvidenceId,
  generateCheckpointId,
  createDefaultRetryBudget,
} from "../index.js";

describe("Mission Types — ID Generation", () => {
  it("generateMissionId returns a unique mission ID", () => {
    const id1 = generateMissionId();
    const id2 = generateMissionId();
    assert.notEqual(id1, id2);
    assert.ok(id1.startsWith("mission_"));
  });

  it("generateStepId returns a unique step ID", () => {
    const id1 = generateStepId();
    const id2 = generateStepId();
    assert.notEqual(id1, id2);
    assert.ok(id1.startsWith("step_"));
  });

  it("generateEvidenceId returns a unique evidence ID", () => {
    const id1 = generateEvidenceId();
    const id2 = generateEvidenceId();
    assert.notEqual(id1, id2);
    assert.ok(id1.startsWith("evidence_"));
  });

  it("generateCheckpointId returns a unique checkpoint ID", () => {
    const id1 = generateCheckpointId();
    const id2 = generateCheckpointId();
    assert.notEqual(id1, id2);
    assert.ok(id1.startsWith("checkpoint_"));
  });
});

describe("Mission Types — Retry Budget", () => {
  it("createDefaultRetryBudget returns sensible defaults", () => {
    const budget = createDefaultRetryBudget();
    assert.equal(budget.modelRetries, 2);
    assert.equal(budget.repairAttempts, 3);
    assert.equal(budget.toolRetries, 3);
    assert.equal(budget.providerFailureThreshold, 5);
  });
});