import { describe, it, expect } from "vitest";

/**
 * Truthful completion semantics — regression tests.
 *
 * Production evidence (Ember Roast V1 Acceptance, static workspace):
 * LiTT answered a build request conversationally, called no tool, mutated
 * no file, deployed nothing — and the Studio transcript displayed
 * "Work log · 1 of 1 steps complete".
 *
 * Root cause: the work log was derived from `message.actions?.length ?? 1`
 * (StudioTranscript.tsx) and from message *stream* status "completed"
 * (messages/route.ts), neither of which is execution evidence. A
 * conversational acknowledgement therefore rendered as completed work.
 *
 * Rule under test: a work item may be called complete ONLY when evidence
 * shows the requested work actually happened.
 */

import {
  requirementForMode,
  evaluateCompletion,
  workLogLabel,
  deploymentEvidenceFrom,
  type ExecutionEvidence,
} from "./completion-evidence";

const NO_EVIDENCE: ExecutionEvidence = { toolCalls: [] };

describe("requirementForMode", () => {
  it("requires a mutation for build requests", () => {
    expect(requirementForMode("build")).toEqual({ mutation: true, deployment: false });
  });

  it("requires a mutation AND a verified deployment for ship requests", () => {
    expect(requirementForMode("ship")).toEqual({ mutation: true, deployment: true });
  });

  it("requires nothing for conversational modes", () => {
    for (const mode of ["think", "learn", "status", "research"]) {
      expect(requirementForMode(mode)).toEqual({ mutation: false, deployment: false });
    }
  });
});

/* ── Case A: build requested, model returned text only ──────────── */

describe("A. build request with a text-only model response", () => {
  const req = requirementForMode("build");

  it("is NOT complete", () => {
    const verdict = evaluateCompletion(req, NO_EVIDENCE);
    expect(verdict.state).not.toBe("complete");
  });

  it("reports not_started with zero completed steps", () => {
    const verdict = evaluateCompletion(req, NO_EVIDENCE);
    expect(verdict.state).toBe("not_started");
    expect(verdict.completedSteps).toBe(0);
  });

  it("names the missing evidence", () => {
    const verdict = evaluateCompletion(req, NO_EVIDENCE);
    expect(verdict.missing).toContain("mutating tool call");
  });

  it("never renders a '1 of 1 steps complete' work log", () => {
    const label = workLogLabel(evaluateCompletion(req, NO_EVIDENCE));
    expect(label).not.toMatch(/1 of 1 steps complete/);
    expect(label).toMatch(/no action taken/i);
  });

  it("stays not_started when only read-only tools ran", () => {
    const verdict = evaluateCompletion(req, {
      toolCalls: [
        { toolId: "inspect_project_files", success: true, mutating: false },
        { toolId: "read_file", success: true, mutating: false },
      ],
    });
    expect(verdict.state).toBe("not_started");
    expect(verdict.missing).toContain("mutating tool call");
  });
});

/* ── Case C: mutation completes only on a successful tool result ── */

describe("C. a mutating tool call completes the step only after a successful result", () => {
  const req = requirementForMode("build");

  it("is not complete while the mutating call has no result yet", () => {
    const verdict = evaluateCompletion(req, {
      toolCalls: [{ toolId: "edit_file", success: undefined, mutating: true }],
    });
    expect(verdict.state).not.toBe("complete");
  });

  it("is not complete when the mutating call failed", () => {
    const verdict = evaluateCompletion(req, {
      toolCalls: [{ toolId: "edit_file", success: false, mutating: true }],
    });
    expect(verdict.state).toBe("failed");
    expect(verdict.completedSteps).toBe(0);
  });

  it("is complete once the mutating call returns success", () => {
    const verdict = evaluateCompletion(req, {
      toolCalls: [{ toolId: "edit_file", success: true, mutating: true }],
    });
    expect(verdict.state).toBe("complete");
    expect(verdict.completedSteps).toBe(1);
    expect(verdict.totalSteps).toBe(1);
  });
});

/* ── Case D: deploy requested, files built, deploy never happened ── */

describe("D. deploy requested but never performed", () => {
  const req = requirementForMode("ship");

  it("remains partial when files were written but no deployment started", () => {
    const verdict = evaluateCompletion(req, {
      toolCalls: [{ toolId: "edit_file", success: true, mutating: true }],
    });
    expect(verdict.state).toBe("partial");
    expect(verdict.missing).toContain("deployment");
  });

  it("remains partial when deployment started but did not succeed", () => {
    const verdict = evaluateCompletion(req, {
      toolCalls: [{ toolId: "edit_file", success: true, mutating: true }],
      deployment: { started: true, succeeded: false, url: null, urlVerified: false },
    });
    expect(verdict.state).toBe("partial");
    expect(verdict.missing).toContain("successful deployment");
  });

  it("remains partial when deployment succeeded but the live URL is unverified", () => {
    const verdict = evaluateCompletion(req, {
      toolCalls: [{ toolId: "edit_file", success: true, mutating: true }],
      deployment: { started: true, succeeded: true, url: "https://ember.example", urlVerified: false },
    });
    expect(verdict.state).toBe("partial");
    expect(verdict.missing).toContain("verified live URL");
  });

  it("is complete only with a verified live URL", () => {
    const verdict = evaluateCompletion(req, {
      toolCalls: [{ toolId: "edit_file", success: true, mutating: true }],
      deployment: { started: true, succeeded: true, url: "https://ember.example", urlVerified: true },
    });
    expect(verdict.state).toBe("complete");
  });

  it("does not let a deployment stand in for missing file work", () => {
    const verdict = evaluateCompletion(req, {
      toolCalls: [],
      deployment: { started: true, succeeded: true, url: "https://ember.example", urlVerified: true },
    });
    expect(verdict.state).not.toBe("complete");
    expect(verdict.missing).toContain("mutating tool call");
  });
});

/* ── Case F: plain text from the provider is not a successful mission ── */

describe("F. provider produced plain text but took no required action", () => {
  it("does not call a build mission successful", () => {
    const verdict = evaluateCompletion(requirementForMode("build"), NO_EVIDENCE);
    expect(verdict.state).not.toBe("complete");
    expect(verdict.reason).toMatch(/no mutating tool call/i);
  });

  it("does not call a ship mission successful", () => {
    const verdict = evaluateCompletion(requirementForMode("ship"), NO_EVIDENCE);
    expect(verdict.state).not.toBe("complete");
  });

  it("treats a conversational request with no tools as conversational, not completed work", () => {
    const verdict = evaluateCompletion(requirementForMode("think"), NO_EVIDENCE);
    expect(verdict.state).toBe("conversational");
    expect(workLogLabel(verdict)).toBeNull();
  });

  it("does not fabricate a work log for the observed 'We gooed' exchange", () => {
    // "We gooed" classified as think/requiresExecution:false in production.
    const verdict = evaluateCompletion(requirementForMode("think"), NO_EVIDENCE);
    expect(workLogLabel(verdict)).toBeNull();
  });
});

/* ── Label rendering ────────────────────────────────────────────── */

describe("workLogLabel", () => {
  it("counts only successful steps", () => {
    const verdict = evaluateCompletion(requirementForMode("build"), {
      toolCalls: [
        { toolId: "read_file", success: true, mutating: false },
        { toolId: "edit_file", success: true, mutating: true },
        { toolId: "run_command", success: false, mutating: false },
      ],
    });
    expect(verdict.completedSteps).toBe(2);
    expect(verdict.totalSteps).toBe(3);
    expect(workLogLabel(verdict)).toBe("2 of 3 steps complete");
  });

  it("states what is missing when partial", () => {
    const verdict = evaluateCompletion(requirementForMode("ship"), {
      toolCalls: [{ toolId: "edit_file", success: true, mutating: true }],
    });
    expect(workLogLabel(verdict)).toBe("1 of 1 steps complete · deployment missing");
  });
});

/* ── Deployment evidence extraction ─────────────────────────────── */

describe("deploymentEvidenceFrom", () => {
  it("returns null when no deployment tool ran", () => {
    expect(deploymentEvidenceFrom([
      { toolId: "files.write", success: true },
      { toolId: "preview.open", success: true },
    ])).toBeNull();
  });

  it("does not treat opening a preview as a deployment", () => {
    // Preview readiness is not a deployment.
    const verdict = evaluateCompletion(requirementForMode("ship"), {
      toolCalls: [
        { toolId: "files.write", success: true, mutating: true },
        { toolId: "preview.open", success: true, mutating: false },
      ],
      deployment: deploymentEvidenceFrom([
        { toolId: "files.write", success: true },
        { toolId: "preview.open", success: true },
      ]),
    });
    expect(verdict.state).toBe("partial");
    expect(verdict.missing).toContain("deployment");
  });

  it("marks a deployment started but unverified without a follow-up check", () => {
    expect(deploymentEvidenceFrom([{ toolId: "deploy", success: true }])).toEqual({
      started: true, succeeded: true, url: null, urlVerified: false,
    });
  });

  it("marks the URL verified only when a check succeeded after the deploy", () => {
    expect(deploymentEvidenceFrom([
      { toolId: "deploy", success: true },
      { toolId: "browser.navigate", success: true },
    ])).toEqual({ started: true, succeeded: true, url: null, urlVerified: true });
  });

  it("does not count a verification that ran before the deploy", () => {
    const evidence = deploymentEvidenceFrom([
      { toolId: "browser.navigate", success: true },
      { toolId: "deploy", success: true },
    ]);
    expect(evidence?.urlVerified).toBe(false);
  });

  it("reports a failed deployment as started but not succeeded", () => {
    expect(deploymentEvidenceFrom([{ toolId: "deploy", success: false }])).toEqual({
      started: true, succeeded: false, url: null, urlVerified: false,
    });
  });
});

/* ── The real deploy tool is recognised as deployment evidence ───── */

describe("project.deploy is the deployment tool", () => {
  it("is recognised as a deployment, unlike a file write or a preview", () => {
    const evidence = deploymentEvidenceFrom([
      { toolId: "files.write", success: true },
      { toolId: "project.deploy", success: true },
    ]);
    expect(evidence).not.toBeNull();
    expect(evidence?.started).toBe(true);
    expect(evidence?.succeeded).toBe(true);
  });

  it("completes a ship request once the deploy tool verified the URL", () => {
    // project.deploy verifies the live URL itself before returning success,
    // so its own success IS the URL verification.
    const toolCalls = [
      { toolId: "files.write", success: true },
      { toolId: "project.deploy", success: true },
    ];
    const verdict = evaluateCompletion(requirementForMode("ship"), {
      toolCalls: toolCalls.map((c) => ({ ...c, mutating: true })),
      deployment: deploymentEvidenceFrom(toolCalls),
    });
    expect(verdict.state).toBe("complete");
  });

  it("keeps a ship request incomplete when the deploy tool failed", () => {
    const toolCalls = [
      { toolId: "files.write", success: true },
      { toolId: "project.deploy", success: false },
    ];
    const verdict = evaluateCompletion(requirementForMode("ship"), {
      toolCalls: toolCalls.map((c) => ({ ...c, mutating: true })),
      deployment: deploymentEvidenceFrom(toolCalls),
    });
    expect(verdict.state).toBe("partial");
    expect(verdict.missing).toContain("successful deployment");
  });
});
