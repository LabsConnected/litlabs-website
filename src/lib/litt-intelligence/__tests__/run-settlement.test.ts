/**
 * Round 11, Fix 2 — completion-aware run settlement.
 *
 * The proof's fact pattern (2026-11-16, main fcd7a3c5): an approved
 * image generation succeeded and saved into the project, the quality
 * gate passed — then a redundant image.saveAsset call failed, the
 * workspace verification came back unknown, and the closing model
 * call exhausted its routes. The old outcome expression
 * (modelFailed || failedHonestly → failed) marked the whole run
 * failed and blamed the routes for the request.
 *
 * These tests pin the settlement rule: deliverable done + only the
 * wrap-up model call failed ⇒ completed-with-warning, with EVERY
 * failure contributor recorded; anything less ⇒ still failed.
 */
import { describe, it, expect } from "vitest";
import {
  settleRunOutcome,
  type RunSettlementInput,
} from "../run-settlement";

const ROUTES_FAILURE =
  "All tool-calling models failed. Attempts: gemini-2.5-flash(http_429), openrouter(registry)";

/** The proof's tool log: generation landed, the redundant save failed. */
const PROOF_TOOL_CALLS: RunSettlementInput["toolCalls"] = [
  {
    toolId: "image.generate",
    success: true,
    summary: "Image generated and saved to project (public/assets/images/a-lion-mwjuqfd3.jpeg)",
    mutating: true,
  },
  {
    toolId: "image.saveAsset",
    success: false,
    summary:
      'Cannot save "pollinations_1794869122578": not a known result id and not a public URL. Generate first or pass the resultId.',
    mutating: true,
  },
];

const PROOF_INPUT: RunSettlementInput = {
  cancelled: false,
  modelFailed: ROUTES_FAILURE,
  toolCalls: PROOF_TOOL_CALLS,
  qualityVerdictOk: true,
  workspaceChange: {
    status: "unknown",
    unknownReason: "No pre-mutation checkpoint was recorded to compare against.",
  },
};

describe("settleRunOutcome — the proof's fact pattern", () => {
  it("settles completed-with-warning when the deliverable landed and only the wrap-up call failed on routes", () => {
    const s = settleRunOutcome(PROOF_INPUT);
    expect(s.outcome).toBe("completed");
    expect(s.completedWithWarning).toBeDefined();
    // Larry's bar (2026-11-20): the visible text is a short completion
    // line only — no internal steps, no run narration. The step that
    // failed is named in the record (contributors), not in the chat.
    expect(s.completedWithWarning).toMatch(/request is complete/i);
    expect(s.completedWithWarning).not.toMatch(/closing summary/i);
    expect(s.completedWithWarning).not.toMatch(/quality gate/i);
    expect(s.completedWithWarning).not.toMatch(/workspace change/i);
    expect(s.completedWithWarning).not.toMatch(/couldn't complete this request/i);
  });

  it("records ALL failure contributors, not just the route failure", () => {
    const s = settleRunOutcome(PROOF_INPUT);
    const kinds = s.failureContributors.map((c) => c.kind);
    expect(kinds).toContain("model_routes");
    expect(kinds).toContain("verification_unknown");
    const toolFailures = s.failureContributors.filter((c) => c.kind === "tool_failure");
    expect(toolFailures).toHaveLength(1);
    expect(toolFailures[0].toolId).toBe("image.saveAsset");
    expect(toolFailures[0].detail).toMatch(/not a known result id/);
    const verification = s.failureContributors.find((c) => c.kind === "verification_unknown");
    expect(verification?.detail).toMatch(/No pre-mutation checkpoint/);
  });
});

describe("settleRunOutcome — the upgrade is narrow", () => {
  it("no successful mutation + routes failure ⇒ failed", () => {
    const s = settleRunOutcome({
      ...PROOF_INPUT,
      toolCalls: [PROOF_TOOL_CALLS[1]],
    });
    expect(s.outcome).toBe("failed");
    expect(s.completedWithWarning).toBeUndefined();
  });

  it("quality gate failed + routes failure ⇒ failed even with a landed mutation", () => {
    const s = settleRunOutcome({ ...PROOF_INPUT, qualityVerdictOk: false });
    expect(s.outcome).toBe("failed");
    expect(s.completedWithWarning).toBeUndefined();
  });

  it("an honest loop failure is never upgraded by a landed mutation", () => {
    const s = settleRunOutcome({
      ...PROOF_INPUT,
      failedHonestly: "The build produced no successful file-writing operation, so it is not complete.",
    });
    expect(s.outcome).toBe("failed");
    expect(s.completedWithWarning).toBeUndefined();
    expect(s.failureContributors.map((c) => c.kind)).toContain("honest_failure");
  });

  it("cancelled stays cancelled and still records contributors", () => {
    const s = settleRunOutcome({ ...PROOF_INPUT, cancelled: true });
    expect(s.outcome).toBe("cancelled");
    expect(s.completedWithWarning).toBeUndefined();
    expect(s.failureContributors.length).toBeGreaterThan(0);
  });

  it("no gate ran (qualityVerdictOk null): a landed mutation still earns the warning settlement", () => {
    const s = settleRunOutcome({ ...PROOF_INPUT, qualityVerdictOk: null });
    expect(s.outcome).toBe("completed");
    expect(s.completedWithWarning).toBeDefined();
    expect(s.completedWithWarning).not.toMatch(/quality gate/i);
  });

  it("a clean run completes with no warning and no contributors", () => {
    const s = settleRunOutcome({
      cancelled: false,
      toolCalls: [PROOF_TOOL_CALLS[0]],
      qualityVerdictOk: true,
      workspaceChange: { status: "changed", files: ["public/assets/images/a-lion-mwjuqfd3.jpeg"] },
    });
    expect(s.outcome).toBe("completed");
    expect(s.completedWithWarning).toBeUndefined();
    expect(s.failureContributors).toEqual([]);
  });

  it("routes failure with NO work done is a plain failure with the contributor recorded", () => {
    const s = settleRunOutcome({
      cancelled: false,
      modelFailed: ROUTES_FAILURE,
      toolCalls: [],
      qualityVerdictOk: null,
    });
    expect(s.outcome).toBe("failed");
    expect(s.failureContributors).toEqual([
      { kind: "model_routes", detail: ROUTES_FAILURE },
    ]);
  });
});

describe("settleRunOutcome — user-facing honesty (2026-11-19 incident)", () => {
  it("never leaks the raw provider error into the closing text", () => {
    const s = settleRunOutcome(PROOF_INPUT);
    expect(s.completedWithWarning).toBeDefined();
    expect(s.completedWithWarning).not.toContain("gemini-2.5-flash");
    expect(s.completedWithWarning).not.toContain("http_429");
    expect(s.completedWithWarning).not.toContain("openrouter");
    // The technical detail is preserved for logs/debug via contributors.
    expect(s.failureContributors).toContainEqual({ kind: "model_routes", detail: ROUTES_FAILURE });
  });

  it("keeps verified-work detail OUT of the user text (record only)", () => {
    const s = settleRunOutcome({
      ...PROOF_INPUT,
      workspaceChange: { status: "changed", files: ["public/assets/images/bike.png", "index.html"] },
    });
    // No file lists, diff claims, or change counts in the chat text —
    // a media request must not be framed as a code change. The
    // evidence stays available to the run record via the settlement
    // inputs/contributors, not via the visible message.
    expect(s.completedWithWarning).not.toContain("bike.png");
    expect(s.completedWithWarning).not.toContain("workspace diff");
    expect(s.completedWithWarning).not.toMatch(/workspace change\(s\)/);
  });

  it("a verified-unchanged workspace can NOT settle as complete", () => {
    const s = settleRunOutcome({
      ...PROOF_INPUT,
      workspaceChange: { status: "unchanged" },
    });
    expect(s.outcome).toBe("failed");
    expect(s.completedWithWarning).toBeUndefined();
  });
});
