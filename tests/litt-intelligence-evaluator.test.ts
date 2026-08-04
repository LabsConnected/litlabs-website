import { describe, it, expect } from "vitest";
import { CandidateEvaluator, EVALUATION_DIMENSIONS } from "@/lib/litt-intelligence/evaluator";
import type { CandidateInput } from "@/lib/litt-intelligence/evaluator";

describe("LiTT Intelligence — Candidate Evaluator", () => {
  // ─── Dimensions ───────────────────────────────────────────────

  it("defines all 15 evaluation dimensions", () => {
    expect(EVALUATION_DIMENSIONS).toHaveLength(15);
    expect(EVALUATION_DIMENSIONS).toContain("project_compatibility");
    expect(EVALUATION_DIMENSIONS).toContain("security_risk");
    expect(EVALUATION_DIMENSIONS).toContain("license_compatibility");
    expect(EVALUATION_DIMENSIONS).toContain("reversibility");
  });

  // ─── Single candidate evaluation ──────────────────────────────

  it("evaluate produces scores on all 15 dimensions", () => {
    const evaluator = new CandidateEvaluator();
    const candidate: CandidateInput = {
      id: "c1",
      name: "Test Library",
      type: "open_source",
      scores: {
        project_compatibility: { score: 0.9, evidence: "Uses same runtime" },
        security_risk: { score: 0.8, evidence: "No known CVEs" },
      },
    };

    const result = evaluator.evaluate(candidate);

    expect(result.scores).toHaveLength(15);
    expect(result.candidateId).toBe("c1");
    expect(result.name).toBe("Test Library");
    expect(result.type).toBe("open_source");
  });

  it("evaluate fills missing dimensions with neutral score", () => {
    const evaluator = new CandidateEvaluator();
    const candidate: CandidateInput = {
      id: "c1",
      name: "Test",
      type: "open_source",
      scores: {
        security_risk: { score: 0.9, evidence: "Safe" },
      },
    };

    const result = evaluator.evaluate(candidate);

    const compatScore = result.scores.find((s) => s.dimension === "project_compatibility");
    expect(compatScore).toBeDefined();
    expect(compatScore!.score).toBe(0.5);
    expect(compatScore!.evidence).toContain("Not evaluated");
  });

  it("evaluate records provided evidence", () => {
    const evaluator = new CandidateEvaluator();
    const candidate: CandidateInput = {
      id: "c1",
      name: "Test",
      type: "open_source",
      scores: {
        security_risk: { score: 0.9, evidence: "No CVEs found in OSV database" },
      },
      evidence: ["GitHub repo has 1000 stars", "Last commit 2 days ago"],
    };

    const result = evaluator.evaluate(candidate);

    expect(result.evidence).toContain("GitHub repo has 1000 stars");
    expect(result.evidence).toContain("Last commit 2 days ago");
  });

  it("evaluate calculates overall score as weighted average", () => {
    const evaluator = new CandidateEvaluator();
    const candidate: CandidateInput = {
      id: "c1",
      name: "Test",
      type: "open_source",
      scores: Object.fromEntries(
        EVALUATION_DIMENSIONS.map((d) => [d, { score: 0.8, evidence: "good" }]),
      ),
    };

    const result = evaluator.evaluate(candidate);

    expect(result.overallScore).toBeCloseTo(0.8, 1);
  });

  // ─── Recommendation ───────────────────────────────────────────

  it("recommend selects the highest-scoring candidate", () => {
    const evaluator = new CandidateEvaluator();
    const candidates: CandidateInput[] = [
      {
        id: "c1",
        name: "Option A",
        type: "open_source",
        scores: { project_compatibility: { score: 0.9, evidence: "Perfect fit" } },
      },
      {
        id: "c2",
        name: "Option B",
        type: "api",
        scores: { project_compatibility: { score: 0.5, evidence: "Partial fit" } },
      },
    ];

    const result = evaluator.recommend("Find a CMS", ["TypeScript"], candidates);

    expect(result.recommendation.candidateId).toBe("c1");
    expect(result.recommendation.confidence).toBeGreaterThan(0);
  });

  it("recommend lists rejected candidates with reasons", () => {
    const evaluator = new CandidateEvaluator();
    const candidates: CandidateInput[] = [
      {
        id: "c1",
        name: "Option A",
        type: "open_source",
        scores: { project_compatibility: { score: 0.9, evidence: "Perfect" } },
      },
      {
        id: "c2",
        name: "Option B",
        type: "api",
        scores: { project_compatibility: { score: 0.3, evidence: "Poor fit" } },
      },
    ];

    const result = evaluator.recommend("Find a CMS", [], candidates);

    expect(result.rejectedCandidates).toHaveLength(1);
    expect(result.rejectedCandidates[0].candidateId).toBe("c2");
    expect(result.rejectedCandidates[0].reason).toContain("lower");
  });

  it("recommend includes project constraints", () => {
    const evaluator = new CandidateEvaluator();
    const result = evaluator.recommend(
      "Find a CMS",
      ["TypeScript compatible", "MIT license"],
      [
        {
          id: "c1",
          name: "Option A",
          type: "open_source",
          scores: { project_compatibility: { score: 0.9, evidence: "Good" } },
        },
      ],
    );

    expect(result.projectConstraints).toContain("TypeScript compatible");
    expect(result.projectConstraints).toContain("MIT license");
  });

  it("recommend marks approval required for API candidates", () => {
    const evaluator = new CandidateEvaluator();
    const result = evaluator.recommend("Find a CMS", [], [
      {
        id: "c1",
        name: "Hosted API",
        type: "api",
        scores: { project_compatibility: { score: 0.95, evidence: "Perfect" } },
      },
    ]);

    expect(result.approvalRequired).toBe(true);
  });

  it("recommend marks approval required for self-hosted candidates", () => {
    const evaluator = new CandidateEvaluator();
    const result = evaluator.recommend("Find a CMS", [], [
      {
        id: "c1",
        name: "Self-hosted Service",
        type: "self_hosted",
        scores: { project_compatibility: { score: 0.95, evidence: "Perfect" } },
      },
    ]);

    expect(result.approvalRequired).toBe(true);
  });

  it("recommend does not require approval for internal builds", () => {
    const evaluator = new CandidateEvaluator();
    const result = evaluator.recommend("Find a CMS", [], [
      {
        id: "c1",
        name: "Build Internally",
        type: "internal",
        scores: { project_compatibility: { score: 0.95, evidence: "Perfect" } },
      },
    ]);

    expect(result.approvalRequired).toBe(false);
  });

  // ─── Integration plan ─────────────────────────────────────────

  it("recommend generates integration plan with steps", () => {
    const evaluator = new CandidateEvaluator();
    const result = evaluator.recommend("Find a CMS", [], [
      {
        id: "c1",
        name: "Open CMS",
        type: "open_source",
        scores: { project_compatibility: { score: 0.9, evidence: "Good" } },
      },
    ]);

    expect(result.proposedIntegration.steps.length).toBeGreaterThan(0);
    expect(result.proposedIntegration.filesToCreate.length).toBeGreaterThan(0);
    expect(result.proposedIntegration.rollbackPlan).toBeTruthy();
  });

  it("recommend generates integration plan for API type", () => {
    const evaluator = new CandidateEvaluator();
    const result = evaluator.recommend("Find a CMS", [], [
      {
        id: "c1",
        name: "Hosted CMS API",
        type: "api",
        scores: { project_compatibility: { score: 0.9, evidence: "Good" } },
      },
    ]);

    expect(result.proposedIntegration.steps).toContain("Create API route handler");
    expect(result.proposedIntegration.dependencies).toHaveLength(0);
  });

  it("recommend generates integration plan for postpone type", () => {
    const evaluator = new CandidateEvaluator();
    const result = evaluator.recommend("Find a CMS", [], [
      {
        id: "c1",
        name: "Postpone",
        type: "postpone",
        scores: { project_compatibility: { score: 0.3, evidence: "Not ready" } },
      },
    ]);

    expect(result.proposedIntegration.approach).toBe("Postpone");
    expect(result.proposedIntegration.rollbackPlan).toContain("No rollback needed");
  });

  it("recommend generates integration plan for reject type", () => {
    const evaluator = new CandidateEvaluator();
    const result = evaluator.recommend("Find a CMS", [], [
      {
        id: "c1",
        name: "Reject",
        type: "reject",
        scores: { project_compatibility: { score: 0.1, evidence: "Unsafe" } },
      },
    ]);

    expect(result.proposedIntegration.approach).toBe("Reject");
  });

  // ─── Risk collection ──────────────────────────────────────────

  it("recommend collects risks for low security scores", () => {
    const evaluator = new CandidateEvaluator();
    const result = evaluator.recommend("Find a CMS", [], [
      {
        id: "c1",
        name: "Risky Option",
        type: "open_source",
        scores: {
          project_compatibility: { score: 0.9, evidence: "Good" },
          security_risk: { score: 0.2, evidence: "Known critical CVEs" },
        },
      },
    ]);

    expect(result.risks.some((r) => r.includes("security"))).toBe(true);
  });

  it("recommend collects risks for poor maintenance health", () => {
    const evaluator = new CandidateEvaluator();
    const result = evaluator.recommend("Find a CMS", [], [
      {
        id: "c1",
        name: "Stale Option",
        type: "open_source",
        scores: {
          project_compatibility: { score: 0.9, evidence: "Good" },
          maintenance_health: { score: 0.2, evidence: "Last commit 3 years ago" },
        },
      },
    ]);

    expect(result.risks.some((r) => r.includes("maintenance"))).toBe(true);
  });

  it("recommend collects risks for license compatibility issues", () => {
    const evaluator = new CandidateEvaluator();
    const result = evaluator.recommend("Find a CMS", [], [
      {
        id: "c1",
        name: "GPL Option",
        type: "open_source",
        scores: {
          project_compatibility: { score: 0.9, evidence: "Good" },
          license_compatibility: { score: 0.2, evidence: "GPL-3.0 incompatible with project" },
        },
      },
    ]);

    expect(result.risks.some((r) => r.includes("license"))).toBe(true);
  });

  // ─── Weighted scoring ─────────────────────────────────────────

  it("security and compatibility are weighted higher in overall score", () => {
    const evaluator = new CandidateEvaluator();
    const candidate: CandidateInput = {
      id: "c1",
      name: "Test",
      type: "open_source",
      scores: Object.fromEntries(
        EVALUATION_DIMENSIONS.map((d) => [d, { score: 0.5, evidence: "neutral" }]),
      ),
    };

    // Override security and compatibility with high scores
    candidate.scores.security_risk = { score: 1.0, evidence: "perfect" };
    candidate.scores.project_compatibility = { score: 1.0, evidence: "perfect" };

    const result = evaluator.evaluate(candidate);
    // With weighted dimensions at 1.0 and others at 0.5, overall should be > 0.5
    expect(result.overallScore).toBeGreaterThan(0.5);
  });
});
