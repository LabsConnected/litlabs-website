import { describe, it, expect } from "vitest";
import { primaryFailureReason, settleRunOutcome } from "./run-settlement";

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

describe("settleRunOutcome — P0 R3 referenced-asset existence", () => {
  // A run whose deliverable verifiably landed: a successful mutating
  // tool call and a verified workspace change.
  const landed = {
    cancelled: false,
    toolCalls: [{ toolId: "files.write", success: true, summary: "index.html written", mutating: true }],
    qualityVerdictOk: null,
    workspaceChange: { status: "changed" as const },
  };

  it("settles completed when no referenced asset is missing", () => {
    expect(settleRunOutcome({ ...landed }).outcome).toBe("completed");
    expect(settleRunOutcome({ ...landed, missingAssetRefs: [] }).outcome).toBe("completed");
  });

  it("cannot settle as success while a referenced local asset is missing", () => {
    const s = settleRunOutcome({ ...landed, missingAssetRefs: ["fonts/main.woff2"] });
    expect(s.outcome).toBe("failed");
    expect(s.completedWithWarning).toBeUndefined();
    expect(s.failureContributors).toContainEqual(
      expect.objectContaining({ kind: "missing_assets" }),
    );
    // …and the missing file is the primary reason the transcript reports.
    expect(primaryFailureReason({ failureContributors: s.failureContributors })).toContain(
      "fonts/main.woff2",
    );
  });

  it("missing assets defeat even the completed-with-warning upgrade", () => {
    const s = settleRunOutcome({
      ...landed,
      modelFailed: "NO_BUILD_CAPABLE_MODEL",
      missingAssetRefs: ["assets/images/hero.jpg"],
    });
    expect(s.outcome).toBe("failed");
    expect(s.completedWithWarning).toBeUndefined();
  });

  it("cancellation still wins, with the missing assets recorded as a contributor", () => {
    const s = settleRunOutcome({
      ...landed,
      cancelled: true,
      missingAssetRefs: ["assets/images/hero.jpg"],
    });
    expect(s.outcome).toBe("cancelled");
    expect(s.failureContributors.some((c) => c.kind === "missing_assets")).toBe(true);
  });
});

describe("settleRunOutcome — milestone-aware settlement (coordination fix)", () => {
  // The same landed build as the R3 block: mutation succeeded, the
  // workspace verifiably changed, the quality gate passed/absent.
  const landed = {
    cancelled: false,
    toolCalls: [{ toolId: "files.write", success: true, summary: "index.html written", mutating: true }],
    qualityVerdictOk: null,
    workspaceChange: { status: "changed" as const },
  };

  it("a build-scope run that was never asked to publish settles completed without any deployment", () => {
    // ACC-10: builds do not deploy unasked — and are not failed for
    // not deploying. No deployment fields at all (the pre-fix shape)
    // and an explicit not-required both settle on the build evidence.
    expect(settleRunOutcome({ ...landed }).outcome).toBe("completed");
    const s = settleRunOutcome({ ...landed, deploymentRequired: false, deploymentVerified: false });
    expect(s.outcome).toBe("completed");
    expect(s.failureContributors.some((c) => c.kind === "deployment_missing")).toBe(false);
  });

  it("a publish-implied run without verified deployment evidence cannot settle as success", () => {
    const s = settleRunOutcome({ ...landed, deploymentRequired: true, deploymentVerified: false });
    expect(s.outcome).toBe("failed");
    expect(s.completedWithWarning).toBeUndefined();
    expect(s.failureContributors).toContainEqual(
      expect.objectContaining({ kind: "deployment_missing" }),
    );
    // …and the unmet publish milestone is the primary reported reason.
    expect(primaryFailureReason({ failureContributors: s.failureContributors })).toContain(
      "publish milestone",
    );
  });

  it("a publish-implied run WITH verified deployment evidence settles completed", () => {
    const s = settleRunOutcome({ ...landed, deploymentRequired: true, deploymentVerified: true });
    expect(s.outcome).toBe("completed");
    expect(s.failureContributors.some((c) => c.kind === "deployment_missing")).toBe(false);
  });

  it("a missing deployment defeats even the completed-with-warning upgrade", () => {
    const s = settleRunOutcome({
      ...landed,
      modelFailed: "NO_BUILD_CAPABLE_MODEL",
      deploymentRequired: true,
      deploymentVerified: false,
    });
    expect(s.outcome).toBe("failed");
    expect(s.completedWithWarning).toBeUndefined();
  });

  it("cancellation still wins, with the missing deployment recorded as a contributor", () => {
    const s = settleRunOutcome({
      ...landed,
      cancelled: true,
      deploymentRequired: true,
      deploymentVerified: false,
    });
    expect(s.outcome).toBe("cancelled");
    expect(s.failureContributors.some((c) => c.kind === "deployment_missing")).toBe(true);
  });
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
