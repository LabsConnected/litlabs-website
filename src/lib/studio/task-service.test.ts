import { describe, expect, it, vi } from "vitest";
import { deriveStudioTaskStatus, readWithGrace } from "./task-service";

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

describe("readWithGrace — read-after-write retry", () => {
  // Regression: POST /api/studio/tasks intermittently 403'd when the task
  // POST raced the just-created project/conversation row. The ownership
  // read now retries briefly instead of rejecting outright.

  it("returns the first successful read without retrying", async () => {
    const read = vi.fn(async () => ({ id: "p1" }));
    await expect(readWithGrace(read)).resolves.toEqual({ id: "p1" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retries until a late-arriving row becomes visible", async () => {
    let calls = 0;
    const read = vi.fn(async () => (++calls >= 3 ? { id: "p1" } : null));
    await expect(readWithGrace(read)).resolves.toEqual({ id: "p1" });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("gives up after the bounded grace window — no infinite wait", async () => {
    const read = vi.fn(async () => null);
    await expect(readWithGrace(read)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(4); // initial + 3 retries
  });
});
