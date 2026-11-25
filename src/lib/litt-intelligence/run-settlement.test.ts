import { describe, it, expect } from "vitest";
import { primaryFailureReason } from "./run-settlement";

/**
 * ACC-05 item 1 — a failed run must carry its real reason to the work
 * log. The loop already records every failure it observes
 * (failureContributors, modelFailed, failedHonestly); this helper
 * picks the ONE primary reason the transcript reports, in observation
 * order, instead of the generic "no work completed" the user saw in
 * Acceptance Run 1 on 8935b2a9.
 */
describe("primaryFailureReason (ACC-05)", () => {
  it("prefers the first recorded contributor, naming the tool for a tool failure", () => {
    const reason = primaryFailureReason({
      failureContributors: [
        { kind: "tool_failure", toolId: "files.write", detail: "workspace transport unavailable" },
        { kind: "model_routes", detail: "provider timeout" },
      ],
      modelFailed: "provider timeout",
    });
    expect(reason).toContain("files.write");
    expect(reason).toContain("workspace transport unavailable");
  });

  it("falls back to modelFailed, then failedHonestly", () => {
    expect(primaryFailureReason({ modelFailed: "All tool-calling models failed" })).toBe("All tool-calling models failed");
    expect(primaryFailureReason({ failedHonestly: "The model never emitted the gated tool call" })).toBe("The model never emitted the gated tool call");
    expect(primaryFailureReason({ failureContributors: [{ kind: "honest_failure", detail: "honest detail" }] })).toBe("honest detail");
  });

  it("returns null when the run recorded no failure", () => {
    expect(primaryFailureReason({})).toBeNull();
    expect(primaryFailureReason({ failureContributors: [] })).toBeNull();
    expect(primaryFailureReason(null)).toBeNull();
    expect(primaryFailureReason(undefined)).toBeNull();
  });

  it("keeps the reason complete on a single line — no mid-sentence truncation (ACC-06a item 3)", () => {
    // Acceptance Run 1 on 8cd7728c: the failure reason shown to the
    // user was cut mid-sentence at 200 chars. Reasons render
    // completely now; only whitespace is normalized to one line.
    const long = `first line\n${"x".repeat(400)} and the final word matters.`;
    const reason = primaryFailureReason({ modelFailed: long });
    expect(reason).not.toContain("\n");
    expect(reason).toBe(`first line ${"x".repeat(400)} and the final word matters.`);
  });
});
