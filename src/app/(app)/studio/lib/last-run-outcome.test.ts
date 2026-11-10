import { describe, it, expect } from "vitest";
import { latestRunOutcome, latestRunActivity } from "./last-run-outcome";
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
