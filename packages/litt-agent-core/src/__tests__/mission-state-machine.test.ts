/**
 * Phase 1 Tests — Mission State Machine
 *
 * Validates that state transitions are correctly enforced.
 */

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isValidMissionTransition,
  isValidStepTransition,
  validateMissionTransition,
  validateStepTransition,
  deriveStepStatus,
  deriveMissionStatus,
} from "../missions/mission-state-machine.js";

describe("Mission State Machine — Valid Mission Transitions", () => {
  it("planning → working is allowed", () => {
    assert.equal(isValidMissionTransition("planning", "working"), true);
  });

  it("planning → cancelled is allowed", () => {
    assert.equal(isValidMissionTransition("planning", "cancelled"), true);
  });

  it("working → verifying is allowed", () => {
    assert.equal(isValidMissionTransition("working", "verifying"), true);
  });

  it("working → blocked is allowed", () => {
    assert.equal(isValidMissionTransition("working", "blocked"), true);
  });

  it("working → cancelled is allowed", () => {
    assert.equal(isValidMissionTransition("working", "cancelled"), true);
  });

  it("verifying → working is allowed (on failure)", () => {
    assert.equal(isValidMissionTransition("verifying", "working"), true);
  });

  it("verifying → complete is allowed (on pass)", () => {
    assert.equal(isValidMissionTransition("verifying", "complete"), true);
  });
});

describe("Mission State Machine — Invalid Mission Transitions", () => {
  it("complete → working is NOT allowed (terminal)", () => {
    assert.equal(isValidMissionTransition("complete", "working"), false);
  });

  it("cancelled → working is NOT allowed (terminal)", () => {
    assert.equal(isValidMissionTransition("cancelled", "working"), false);
  });

  it("failed → working is NOT allowed (terminal)", () => {
    assert.equal(isValidMissionTransition("failed", "working"), false);
  });

  it("planning → complete is NOT allowed", () => {
    assert.equal(isValidMissionTransition("planning", "complete"), false);
  });
});

describe("Mission State Machine — Valid Step Transitions", () => {
  it("pending → working is allowed", () => {
    assert.equal(isValidStepTransition("pending", "working"), true);
  });

  it("pending → skipped is allowed", () => {
    assert.equal(isValidStepTransition("pending", "skipped"), true);
  });

  it("pending → failed is allowed", () => {
    assert.equal(isValidStepTransition("pending", "failed"), true);
  });

  it("working → verifying is allowed", () => {
    assert.equal(isValidStepTransition("working", "verifying"), true);
  });

  it("verifying → passed is allowed", () => {
    assert.equal(isValidStepTransition("verifying", "passed"), true);
  });

  it("verifying → failed is allowed", () => {
    assert.equal(isValidStepTransition("verifying", "failed"), true);
  });
});

describe("Mission State Machine — Invalid Step Transitions", () => {
  it("passed → working is NOT allowed (terminal)", () => {
    assert.equal(isValidStepTransition("passed", "working"), false);
  });

  it("skipped → working is NOT allowed (terminal)", () => {
    assert.equal(isValidStepTransition("skipped", "working"), false);
  });
});

describe("Mission State Machine — validateMissionTransition", () => {
  it("returns allowed: true for valid transitions", () => {
    const result = validateMissionTransition("planning", "working");
    assert.equal(result.allowed, true);
  });

  it("returns allowed: false with reason for invalid transitions", () => {
    const result = validateMissionTransition("complete", "working");
    assert.equal(result.allowed, false);
    assert.ok(result.reason?.includes("terminal"));
  });

  it("returns suggestions for invalid transitions", () => {
    const result = validateMissionTransition("planning", "complete");
    assert.equal(result.allowed, false);
    assert.ok(result.suggestions?.includes("'working'"));
  });
});

describe("Mission State Machine — deriveStepStatus", () => {
  it("returns 'passed' when verification passes", () => {
    assert.equal(deriveStepStatus(true), "passed");
  });

  it("returns 'failed' when verification fails", () => {
    assert.equal(deriveStepStatus(false), "failed");
  });

  it("returns 'blocked' when approval is required", () => {
    assert.equal(deriveStepStatus(true, true), "blocked");
  });
});

describe("Mission State Machine — deriveMissionStatus", () => {
  it("returns 'complete' when all steps complete", () => {
    assert.equal(
      deriveMissionStatus(false, false, true, false, false),
      "complete"
    );
  });

  it("returns 'working' when there are active steps", () => {
    assert.equal(
      deriveMissionStatus(true, false, false, false, false),
      "working"
    );
  });

  it("returns 'failed' when there are failures", () => {
    assert.equal(
      deriveMissionStatus(false, false, false, true, false),
      "failed"
    );
  });

  it("returns 'blocked' when approval is required", () => {
    assert.equal(
      deriveMissionStatus(false, false, false, false, true),
      "blocked"
    );
  });

  it("returns 'planning' when no active steps", () => {
    assert.equal(
      deriveMissionStatus(false, false, false, false, false),
      "planning"
    );
  });
});