/**
 * Browser job state machine — transition legality, display states.
 *
 * The machine is the truthfulness backbone of the Studio browser job
 * card: the badge a user sees comes from here, and the DB mutations in
 * browser-jobs.ts enforce it atomically. A terminal job can never be
 * revived; a job can never skip a state.
 */
import { describe, it, expect } from "vitest";
import {
  JOB_STATE_TRANSITIONS,
  canTransition,
  legalSourcesFor,
  isTerminalStatus,
  describeJobState,
} from "../browser-job-states";
import type { JobStatus } from "../browser-jobs";

const ALL: JobStatus[] = [
  "queued",
  "running",
  "awaiting_approval",
  "approved",
  "completed",
  "failed",
  "cancelled",
];

describe("JOB_STATE_TRANSITIONS", () => {
  it("covers every known status exactly once", () => {
    expect(Object.keys(JOB_STATE_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it("terminal states have no outgoing transitions (immutable)", () => {
    for (const s of ["completed", "failed", "cancelled"] as JobStatus[]) {
      expect(JOB_STATE_TRANSITIONS[s]).toEqual([]);
      expect(isTerminalStatus(s)).toBe(true);
    }
  });

  it("non-terminal states are not terminal", () => {
    for (const s of ["queued", "running", "awaiting_approval", "approved"] as JobStatus[]) {
      expect(isTerminalStatus(s)).toBe(false);
    }
  });
});

describe("canTransition", () => {
  it("allows the documented happy path", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "completed")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
  });

  it("allows the approval loop", () => {
    expect(canTransition("running", "awaiting_approval")).toBe(true);
    expect(canTransition("awaiting_approval", "approved")).toBe(true);
    expect(canTransition("approved", "running")).toBe(true);
    expect(canTransition("approved", "completed")).toBe(true);
    expect(canTransition("approved", "failed")).toBe(true);
  });

  it("allows cancellation from queued and awaiting_approval only", () => {
    expect(canTransition("queued", "cancelled")).toBe(true);
    expect(canTransition("awaiting_approval", "cancelled")).toBe(true);
    expect(canTransition("running", "cancelled")).toBe(false);
    expect(canTransition("approved", "cancelled")).toBe(false);
  });

  it("rejects reviving a terminal job", () => {
    for (const terminal of ["completed", "failed", "cancelled"] as JobStatus[]) {
      for (const next of ALL) {
        expect(canTransition(terminal, next)).toBe(false);
      }
    }
  });

  it("rejects skipping states", () => {
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("queued", "awaiting_approval")).toBe(false);
    expect(canTransition("running", "approved")).toBe(false);
    expect(canTransition("awaiting_approval", "running")).toBe(false);
    expect(canTransition("awaiting_approval", "completed")).toBe(false);
  });
});

describe("legalSourcesFor", () => {
  it("completion only comes from running or approved", () => {
    expect(legalSourcesFor("completed").sort()).toEqual(["approved", "running"]);
  });

  it("failure never comes from a terminal state (or awaiting_approval — rejection is cancel)", () => {
    const sources = legalSourcesFor("failed");
    expect(sources).toContain("running");
    expect(sources).toContain("approved");
    expect(sources).not.toContain("queued");
    expect(sources).not.toContain("awaiting_approval");
    expect(sources).not.toContain("completed");
    expect(sources).not.toContain("failed");
    expect(sources).not.toContain("cancelled");
  });
});

describe("describeJobState", () => {
  it("labels every status truthfully — success only on completed", () => {
    expect(describeJobState("queued").label).toBe("Queued");
    expect(describeJobState("running").label).toBe("Running");
    expect(describeJobState("awaiting_approval").label).toBe("Waiting for approval");
    expect(describeJobState("approved").label).toBe("Approved — resuming");
    expect(describeJobState("completed").label).toBe("Succeeded");
    expect(describeJobState("failed").label).toBe("Failed");
    expect(describeJobState("cancelled").label).toBe("Cancelled");
  });

  it("marks activity and terminality consistently with the transition table", () => {
    for (const s of ALL) {
      const d = describeJobState(s);
      expect(d.terminal).toBe(isTerminalStatus(s));
      expect(d.active).toBe(!isTerminalStatus(s));
    }
  });
});
