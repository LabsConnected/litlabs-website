import { describe, it, expect } from "vitest";
import { latestRunOutcome, latestRunActivity, projectLastRun } from "./last-run-outcome";
import type { ChatMessage } from "../stores/useStudioAgentStore";

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return { role: "assistant", content: "x", ...overrides } as ChatMessage;
}

describe("latestRunOutcome", () => {
  it("returns null for an empty conversation", () => {
    expect(latestRunOutcome([])).toBeNull();
  });

  it("returns null when only user messages exist", () => {
    expect(latestRunOutcome([msg({ role: "user" })])).toBeNull();
  });

  it("returns failed when the latest settled assistant message failed", () => {
    expect(
      latestRunOutcome([msg({ role: "user" }), msg({ status: "failed" })]),
    ).toBe("failed");
  });

  it("a later completed run supersedes an earlier failure", () => {
    expect(
      latestRunOutcome([msg({ status: "failed" }), msg({ status: "completed" })]),
    ).toBe("completed");
  });

  it("a later failure supersedes an earlier completion", () => {
    expect(
      latestRunOutcome([msg({ status: "completed" }), msg({ status: "failed" })]),
    ).toBe("failed");
  });

  it("ignores a still-streaming message and reports the last settled outcome", () => {
    expect(
      latestRunOutcome([msg({ status: "failed" }), msg({ status: "streaming" })]),
    ).toBe("failed");
  });
});

describe("latestRunActivity", () => {
  it("returns null when no message carries execution evidence", () => {
    expect(
      latestRunActivity([msg({ status: "completed", content: "chat reply" })]),
    ).toBeNull();
  });

  it("returns the failed run's recorded activity", () => {
    const records = [
      { toolId: "read_file", success: true, summary: "Read package.json" },
      { toolId: "run_build", success: false, summary: "Build failed" },
    ];
    const result = latestRunActivity([
      msg({ role: "user" }),
      msg({ status: "failed", toolActivity: records }),
    ]);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("failed");
    expect(result!.records).toEqual(records);
  });

  it("prefers the most recent run's activity over an older run's", () => {
    const older = [{ toolId: "a", summary: "old step" }];
    const newer = [{ toolId: "b", summary: "new step" }];
    const result = latestRunActivity([
      msg({ status: "completed", toolActivity: older }),
      msg({ status: "failed", toolActivity: newer }),
    ]);
    expect(result!.records).toEqual(newer);
    expect(result!.outcome).toBe("failed");
  });
});

describe("projectLastRun — project-level fallback across conversations", () => {
  it("returns null when no conversation has a settled run", () => {
    expect(projectLastRun([[], undefined, [msg({ role: "user" })]])).toBeNull();
  });

  it("the current conversation's own outcome wins over other conversations", () => {
    const result = projectLastRun([
      [msg({ status: "completed" })],
      [msg({ status: "failed", content: "older failure" })],
    ]);
    expect(result).toEqual({ outcome: "completed", failureNote: null });
  });

  it("falls back to the project's last run when the open conversation is fresh", () => {
    // Larry's case: SUDSY's only build failed in another conversation;
    // the open conversation is new/empty. Project truth must say failed.
    const result = projectLastRun([
      [],
      [msg({ role: "user" }), msg({ status: "failed", content: "All routes were unavailable." })],
    ]);
    expect(result).toEqual({ outcome: "failed", failureNote: "All routes were unavailable." });
  });

  it("skips unsettled (streaming) runs while looking for the project's last run", () => {
    const result = projectLastRun([
      [msg({ status: "streaming" })],
      [msg({ status: "completed" })],
    ]);
    expect(result).toEqual({ outcome: "completed", failureNote: null });
  });

  it("a later completed run in a more recent conversation supersedes an older failure", () => {
    const result = projectLastRun([
      [],
      [msg({ status: "completed" })],
      [msg({ status: "failed", content: "old failure" })],
    ]);
    expect(result).toEqual({ outcome: "completed", failureNote: null });
  });

  it("failureNote is whitespace-collapsed and bounded", () => {
    const long = `Failed.\n\n${"x".repeat(400)}`;
    const result = projectLastRun([[msg({ status: "failed", content: long })]]);
    expect(result?.outcome).toBe("failed");
    expect(result?.failureNote).not.toContain("\n");
    expect(result!.failureNote!.length).toBeLessThanOrEqual(240);
    expect(result?.failureNote).toContain("Failed.");
  });

  it("failureNote is null when the failed message carries no explanation", () => {
    const result = projectLastRun([[msg({ status: "failed", content: "   " })]]);
    expect(result).toEqual({ outcome: "failed", failureNote: null });
  });
});
