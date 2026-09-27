import { describe, expect, it } from "vitest";
import { deriveStudioTaskStatus } from "./task-service";

describe("deriveStudioTaskStatus", () => {
  it.each([
    ["queued", "working"],
    ["starting", "working"],
    ["working", "working"],
    ["paused", "waiting_approval"],
    ["waiting_for_user", "waiting_approval"],
  ])("projects %s ActionRun state to %s", (actionStatus, expected) => {
    expect(deriveStudioTaskStatus("ready", {}, actionStatus)).toBe(expected);
  });

  it("never maps a completed ActionRun to Complete without verification", () => {
    expect(deriveStudioTaskStatus("ready", {}, "completed")).toBe("needs_verification");
    expect(deriveStudioTaskStatus("ready", { verified: false }, "completed")).toBe("needs_verification");
  });

  it("maps a completed ActionRun to Complete only with explicit verification evidence", () => {
    expect(deriveStudioTaskStatus("ready", { verified: true }, "completed")).toBe("complete");
  });

  it("preserves failure truth and an existing needs-verification state", () => {
    expect(deriveStudioTaskStatus("ready", {}, "failed")).toBe("failed");
    expect(deriveStudioTaskStatus("needs_verification", {}, "failed")).toBe("needs_verification");
  });
});
