import { describe, it, expect } from "vitest";
import {
  AFTER_RUN_PREFIX,
  isAfterRunCheckpoint,
  latestRunCheckpoints,
  postRunCheckpointLabel,
} from "./checkpoint-pairs";

const ck = (label: string, gitSha: string, createdAt: string) => ({ label, gitSha, createdAt });

describe("run checkpoints", () => {
  it("labels the post-run checkpoint with the request", () => {
    const label = postRunCheckpointLabel("Add an HTML comment   after <body>");
    expect(label).toBe(`${AFTER_RUN_PREFIX}Add an HTML comment after <body>`);
    expect(isAfterRunCheckpoint(label)).toBe(true);
    expect(postRunCheckpointLabel("")).toBe(`${AFTER_RUN_PREFIX}changes applied`);
  });

  it("pairs the latest after-checkpoint with the before-checkpoint preceding it", () => {
    const list = [
      ck("Pre-agent-loop: first", "a1", "2026-09-28T10:00:00Z"),
      ck(`${AFTER_RUN_PREFIX}first`, "a2", "2026-09-28T10:01:00Z"),
      ck("Pre-agent-loop: second", "b1", "2026-09-28T11:00:00Z"),
      ck(`${AFTER_RUN_PREFIX}second`, "b2", "2026-09-28T11:01:00Z"),
      ck("Manual save", "m1", "2026-09-28T09:00:00Z"),
    ];
    // Order-independent (API returns newest first; test shuffled).
    const { before, after } = latestRunCheckpoints([list[2], list[0], list[4], list[3], list[1]]);
    expect(after?.gitSha).toBe("b2");
    expect(before?.gitSha).toBe("b1");
  });

  it("still returns a revert target for runs recorded before after-checkpoints existed", () => {
    const { before, after } = latestRunCheckpoints([ck("Pre-agent-loop: old", "o1", "2026-09-01T00:00:00Z")]);
    expect(after).toBeNull();
    expect(before?.gitSha).toBe("o1");
  });

  it("empty list → nothing", () => {
    expect(latestRunCheckpoints([])).toEqual({ before: null, after: null });
  });
});
