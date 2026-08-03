/**
 * Candidate Evaluation and Recommendation Engine
 *
 * Provides a consistent candidate-scoring model across 15 evaluation
 * dimensions. Each score must show supporting evidence.
 *
 * LiTT can recommend:
 * - Use existing implementation
 * - Extend existing implementation
 * - Adopt an open-source package
 * - Integrate an external API
 * - Self-host a service
 * - Build internally
 * - Postpone the feature
 * - Reject an unsafe or incompatible option
 *
 * "Open source" must not automatically mean "best."
 */

import type {
  CandidateEvaluation,
  EvaluationScore,
  IntegrationRecommendation,
  IntegrationPlan,
  ProjectIntelligenceSnapshot,
} from "./types";

// ─── Evaluation dimensions ──────────────────────────────────────

export const EVALUATION_DIMENSIONS = [
  "project_compatibility",
  "implementation_effort",
  "operational_cost",
  "license_compatibility",
  "security_risk",
  "maintenance_health",
  "api_quality",
  "documentation_quality",
  "vendor_lock_in",
  "self_hosting_difficulty",
  "performance",
  "reliability",
  "user_privacy",
  "commercial_use_suitability",
  "reversibility",
] as const;

export type EvaluationDimension = (typeof EVALUATION_DIMENSIONS)[number];

// ─── Candidate input ────────────────────────────────────────────

export interface CandidateInput {
  id: string;
  name: string;
  type: "open_source" | "api" | "self_hosted" | "internal" | "postpone" | "reject";
  scores: Partial<Record<EvaluationDimension, { score: number; evidence: string }>>;
  evidence?: string[];
}

// ─── Evaluator ──────────────────────────────────────────────────

export class CandidateEvaluator {
  private projectSnapshot: ProjectIntelligenceSnapshot | null;

  constructor(projectSnapshot?: ProjectIntelligenceSnapshot) {
    this.projectSnapshot = projectSnapshot ?? null;
  }

  /**
   * Evaluate a single candidate and produce a full CandidateEvaluation
   * with scores on all 15 dimensions.
   */
  evaluate(candidate: CandidateInput): CandidateEvaluation {
    const evaluationScores: EvaluationScore[] = [];
    const evidence = candidate.evidence ?? [];

    for (const dimension of EVALUATION_DIMENSIONS) {
      const provided = candidate.scores[dimension];
      if (provided) {
        evaluationScores.push({
          dimension,
          score: provided.score,
          evidence: provided.evidence,
        });
      } else {
        // Default score for unprovided dimensions
        evaluationScores.push({
          dimension,
          score: 0.5,
          evidence: "Not evaluated — defaulting to neutral score",
        });
      }
    }

    // Calculate overall score as weighted average
    const overallScore = this.calculateOverallScore(evaluationScores);

    return {
      candidateId: candidate.id,
      name: candidate.name,
      type: candidate.type,
      scores: evaluationScores,
      overallScore,
      evidence,
    };
  }

  /**
   * Evaluate multiple candidates and produce a recommendation.
   */
  recommend(
    problem: string,
    projectConstraints: string[],
    candidates: CandidateInput[],
  ): IntegrationRecommendation {
    const evaluations = candidates.map((c) => this.evaluate(c));

    // Sort by overall score (descending)
    const sorted = [...evaluations].sort((a, b) => b.overallScore - a.overallScore);

    // The top candidate is the recommendation
    const top = sorted[0];
    const rejected = sorted.slice(1);

    // Determine if approval is required
    const approvalRequired = top.type === "api" || top.type === "self_hosted";

    // Build integration plan
    const proposedIntegration = this.buildIntegrationPlan(top, projectConstraints);

    // Collect risks
    const risks = this.collectRisks(evaluations);

    return {
      problem,
      projectConstraints,
      candidates: evaluations,
      recommendation: {
        candidateId: top.candidateId,
        reason: this.buildRecommendationReason(top, projectConstraints),
        confidence: top.overallScore,
      },
      rejectedCandidates: rejected.map((c) => ({
        candidateId: c.candidateId,
        reason: `Overall score ${c.overallScore.toFixed(2)} is lower than recommended candidate (${top.overallScore.toFixed(2)})`,
      })),
      proposedIntegration,
      risks,
      approvalRequired,
    };
  }

  /**
   * Calculate overall score as a weighted average.
   * Security and compatibility are weighted higher.
   */
  private calculateOverallScore(scores: EvaluationScore[]): number {
    const weights: Record<string, number> = {
      project_compatibility: 2.0,
      implementation_effort: 1.0,
      operational_cost: 1.0,
      license_compatibility: 1.5,
      security_risk: 2.0,
      maintenance_health: 1.5,
      api_quality: 1.0,
      documentation_quality: 0.5,
      vendor_lock_in: 1.0,
      self_hosting_difficulty: 0.5,
      performance: 1.0,
      reliability: 1.5,
      user_privacy: 1.0,
      commercial_use_suitability: 1.0,
      reversibility: 1.0,
    };

    let totalWeight = 0;
    let weightedSum = 0;

    for (const score of scores) {
      const weight = weights[score.dimension] ?? 1;
      totalWeight += weight;
      weightedSum += score.score * weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Build an integration plan for the recommended candidate.
   */
  private buildIntegrationPlan(
    candidate: CandidateEvaluation,
    constraints: string[],
  ): IntegrationPlan {
    const steps: string[] = [];
    const filesToCreate: string[] = [];
    const filesToModify: string[] = [];
    const dependencies: string[] = [];

    switch (candidate.type) {
      case "open_source":
        steps.push(`Install ${candidate.name} as a dependency`);
        dependencies.push(candidate.name);
        steps.push("Create adapter module following existing project patterns");
        filesToCreate.push(`src/lib/integrations/${candidate.candidateId}.ts`);
        steps.push("Add environment variable names to .env.example (names only)");
        steps.push("Write tests for the adapter");
        filesToCreate.push(`tests/${candidate.candidateId}.test.ts`);
        break;

      case "api":
        steps.push(`Create API client for ${candidate.name}`);
        filesToCreate.push(`src/lib/integrations/${candidate.candidateId}.ts`);
        steps.push("Add API key environment variable name to .env.example");
        steps.push("Create API route handler");
        filesToCreate.push(`src/app/api/integrations/${candidate.candidateId}/route.ts`);
        steps.push("Write integration tests");
        filesToCreate.push(`tests/${candidate.candidateId}.test.ts`);
        break;

      case "self_hosted":
        steps.push(`Set up ${candidate.name} as a self-hosted service`);
        filesToCreate.push(`docker/${candidate.candidateId}.yml`);
        steps.push("Create service adapter");
        filesToCreate.push(`src/lib/integrations/${candidate.candidateId}.ts`);
        steps.push("Configure health check endpoint");
        steps.push("Write deployment tests");
        break;

      case "internal":
        steps.push(`Implement ${candidate.name} using existing project patterns`);
        filesToCreate.push(`src/lib/${candidate.candidateId}.ts`);
        steps.push("Write tests");
        filesToCreate.push(`tests/${candidate.candidateId}.test.ts`);
        break;

      case "postpone":
        steps.push("Document the feature as postponed with rationale");
        filesToCreate.push("docs/postponed-features.md");
        break;

      case "reject":
        steps.push("Document the rejection with rationale");
        break;
    }

    // Add constraint-specific steps
    for (const constraint of constraints) {
      steps.push(`Verify constraint: ${constraint}`);
    }

    return {
      approach: candidate.type === "postpone" ? "Postpone" : candidate.type === "reject" ? "Reject" : `Adopt ${candidate.type} approach`,
      steps,
      filesToCreate,
      filesToModify,
      dependencies,
      estimatedEffort: this.estimateEffort(candidate),
      rollbackPlan: candidate.type === "reject" || candidate.type === "postpone"
        ? "No rollback needed — no changes made"
        : `Remove ${candidate.candidateId} module and dependencies, revert .env.example changes`,
    };
  }

  private estimateEffort(candidate: CandidateEvaluation): string {
    const effortScore = candidate.scores.find((s) => s.dimension === "implementation_effort")?.score ?? 0.5;
    if (effortScore >= 0.8) return "Low (1-2 hours)";
    if (effortScore >= 0.6) return "Medium (2-4 hours)";
    if (effortScore >= 0.4) return "High (4-8 hours)";
    return "Very high (1+ days)";
  }

  private buildRecommendationReason(
    candidate: CandidateEvaluation,
    constraints: string[],
  ): string {
    const topScores = [...candidate.scores]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => `${s.dimension}: ${s.score.toFixed(2)}`);

    const reason = `${candidate.name} (${candidate.type}) scored highest with overall ${candidate.overallScore.toFixed(2)}. Top dimensions: ${topScores.join(", ")}.`;

    if (constraints.length > 0) {
      return `${reason} Meets constraints: ${constraints.join(", ")}.`;
    }

    return reason;
  }

  private collectRisks(evaluations: CandidateEvaluation[]): string[] {
    const risks: string[] = [];

    for (const eval_ of evaluations) {
      const securityScore = eval_.scores.find((s) => s.dimension === "security_risk");
      if (securityScore && securityScore.score < 0.4) {
        risks.push(`${eval_.name} has low security score (${securityScore.score.toFixed(2)}): ${securityScore.evidence}`);
      }

      const maintenanceScore = eval_.scores.find((s) => s.dimension === "maintenance_health");
      if (maintenanceScore && maintenanceScore.score < 0.4) {
        risks.push(`${eval_.name} has poor maintenance health (${maintenanceScore.score.toFixed(2)}): ${maintenanceScore.evidence}`);
      }

      const licenseScore = eval_.scores.find((s) => s.dimension === "license_compatibility");
      if (licenseScore && licenseScore.score < 0.4) {
        risks.push(`${eval_.name} has license compatibility concerns (${licenseScore.score.toFixed(2)}): ${licenseScore.evidence}`);
      }
    }

    return risks;
  }
}
