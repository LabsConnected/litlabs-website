import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ResearchPanel,
  RecommendationPanel,
  ActionPlanPanel,
  ApprovalRequestPanel,
} from "@/components/intelligence/IntelligencePanel";
import type {
  IntegrationRecommendation,
  LiTTActionPlan,
} from "@/lib/litt-intelligence/types";
import type { ResearchResult } from "@/lib/litt-intelligence/research-engine";
import type { ApprovalRequest } from "@/lib/litt-intelligence/approval-system";

// ─── Test helpers ───────────────────────────────────────────────

function makeResearchResult(): ResearchResult {
  return {
    query: { id: "q1", text: "test", subqueries: ["test"], intent: "discover", constraints: [] },
    results: [
      {
        search: {
          id: "sr1",
          title: "Official Docs",
          url: "https://docs.example.com",
          sourceType: "official_documentation",
          snippet: "Test snippet",
          relevanceScore: 0.9,
          retrievedAt: new Date().toISOString(),
        },
        source: {
          url: "https://docs.example.com",
          title: "Official Docs",
          content: "This is the official documentation content for testing purposes.",
          contentType: "text/html",
          fetchedAt: new Date().toISOString(),
          statusCode: 200,
        },
        verification: {
          source: {
            url: "https://docs.example.com",
            title: "Official Docs",
            content: "content",
            contentType: "text/html",
            fetchedAt: new Date().toISOString(),
            statusCode: 200,
          },
          verified: true,
          checks: [{ name: "accessible", passed: true, detail: "OK" }],
          warnings: [],
        },
      },
    ],
    summary: "Research summary: 1 verified, 0 unverified, 0 failed.",
  };
}

function makeRecommendation(): IntegrationRecommendation {
  return {
    problem: "Find a CMS",
    projectConstraints: ["TypeScript compatible"],
    candidates: [
      {
        candidateId: "c1",
        name: "Option A",
        type: "open_source",
        scores: [
          { dimension: "project_compatibility", score: 0.9, evidence: "Good fit" },
        ],
        overallScore: 0.85,
        evidence: ["Test evidence"],
      },
      {
        candidateId: "c2",
        name: "Option B",
        type: "api",
        scores: [
          { dimension: "project_compatibility", score: 0.5, evidence: "Partial fit" },
        ],
        overallScore: 0.5,
        evidence: [],
      },
    ],
    recommendation: {
      candidateId: "c1",
      reason: "Option A scored highest with overall 0.85",
      confidence: 0.85,
    },
    rejectedCandidates: [
      { candidateId: "c2", reason: "Overall score 0.50 is lower than recommended (0.85)" },
    ],
    proposedIntegration: {
      approach: "Adopt open_source approach",
      steps: ["Install Option A", "Create adapter module", "Write tests"],
      filesToCreate: ["src/lib/integrations/option-a.ts"],
      filesToModify: [],
      dependencies: ["option-a"],
      estimatedEffort: "Medium (2-4 hours)",
      rollbackPlan: "Remove option-a module and dependencies",
    },
    risks: ["Option B has low security score"],
    approvalRequired: false,
  };
}

function makeActionPlan(): LiTTActionPlan {
  return {
    id: "plan-1",
    userId: "user-a",
    projectId: "proj-a",
    goal: "Deploy the app",
    assumptions: [
      { id: "a1", text: "The build passes", confidence: 0.8, verificationRequired: true },
    ],
    steps: [
      {
        id: "s1",
        toolId: "files.read",
        inputs: { path: "config.json" },
        expectedOutput: "Config content",
        requiredCapability: "filesystem",
        risk: "low",
        approvalStatus: "not_required",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
        actualStatus: "success",
        actualOutput: '{"ok": true}',
      },
      {
        id: "s2",
        toolId: "files.write",
        inputs: { path: "deploy.txt", content: "deployed" },
        expectedOutput: "File written",
        requiredCapability: "filesystem",
        risk: "high",
        approvalStatus: "approved",
        rollbackAction: "Delete deploy.txt",
        verificationAction: "Read deploy.txt",
        dependencies: ["s1"],
        maxAttempts: 3,
        actualStatus: "pending",
      },
    ],
    risk: "high",
    approvalRequired: true,
    createdAt: new Date().toISOString(),
    phase: "awaiting_approval",
  };
}

function makeApprovalRequest(status: "pending" | "approved" | "denied" = "pending"): ApprovalRequest {
  return {
    id: "approval-1",
    planId: "plan-1",
    userId: "user-a",
    projectId: "proj-a",
    goal: "Write file",
    steps: [
      {
        stepId: "s1",
        toolId: "files.write",
        description: "File written",
        risk: "high",
        inputsSummary: "path=test.txt, content=test",
      },
    ],
    risk: "high",
    reason: "HIGH risk action: Write file. 1 step(s) require explicit approval.",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    status,
    decidedBy: status !== "pending" ? "user-a" : undefined,
    decidedAt: status !== "pending" ? new Date().toISOString() : undefined,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe("LiTT Intelligence — Chat UI", () => {
  // ─── ResearchPanel ────────────────────────────────────────────

  it("ResearchPanel renders summary", () => {
    render(<ResearchPanel result={makeResearchResult()} />);
    expect(screen.getByText("Research Results")).toBeDefined();
    expect(screen.getByText(/Research summary/)).toBeDefined();
  });

  it("ResearchPanel shows verified sources", () => {
    render(<ResearchPanel result={makeResearchResult()} />);
    expect(screen.getByText(/Verified Sources/)).toBeDefined();
    expect(screen.getByText("Official Docs")).toBeDefined();
  });

  it("ResearchPanel expands source content on click", () => {
    render(<ResearchPanel result={makeResearchResult()} />);
    const sourceButton = screen.getByText("Official Docs");
    fireEvent.click(sourceButton);
    expect(screen.getByText(/official documentation content/)).toBeDefined();
  });

  // ─── RecommendationPanel ──────────────────────────────────────

  it("RecommendationPanel renders problem and recommendation", () => {
    render(<RecommendationPanel recommendation={makeRecommendation()} />);
    expect(screen.getByText("Recommendation")).toBeDefined();
    expect(screen.getByText("Find a CMS")).toBeDefined();
    expect(screen.getByText("Option A")).toBeDefined();
  });

  it("RecommendationPanel shows confidence bar", () => {
    render(<RecommendationPanel recommendation={makeRecommendation()} />);
    expect(screen.getByText("85%")).toBeDefined();
  });

  it("RecommendationPanel shows risks", () => {
    render(<RecommendationPanel recommendation={makeRecommendation()} />);
    expect(screen.getByText("Risks:")).toBeDefined();
    expect(screen.getByText(/Option B has low security/)).toBeDefined();
  });

  it("RecommendationPanel shows proposed steps", () => {
    render(<RecommendationPanel recommendation={makeRecommendation()} />);
    expect(screen.getByText("Proposed Steps:")).toBeDefined();
    expect(screen.getByText("Install Option A")).toBeDefined();
  });

  it("RecommendationPanel shows approve/reject when approval required", () => {
    const rec = makeRecommendation();
    rec.approvalRequired = true;
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<RecommendationPanel recommendation={rec} onApprove={onApprove} onReject={onReject} />);
    expect(screen.getByText("Approve")).toBeDefined();
    expect(screen.getByText("Reject")).toBeDefined();
  });

  it("RecommendationPanel does not show approve/reject when not required", () => {
    render(<RecommendationPanel recommendation={makeRecommendation()} />);
    expect(screen.queryByText("Approve")).toBeNull();
  });

  it("RecommendationPanel toggles rejected candidates", () => {
    render(<RecommendationPanel recommendation={makeRecommendation()} />);
    const toggle = screen.getByText(/Show rejected candidates/);
    fireEvent.click(toggle);
    expect(screen.getByText(/Option B.*lower/)).toBeDefined();
  });

  // ─── ActionPlanPanel ──────────────────────────────────────────

  it("ActionPlanPanel renders goal and phase", () => {
    render(<ActionPlanPanel plan={makeActionPlan()} />);
    expect(screen.getByText("Action Plan")).toBeDefined();
    expect(screen.getByText("Deploy the app")).toBeDefined();
    expect(screen.getByText(/awaiting approval/i)).toBeDefined();
  });

  it("ActionPlanPanel shows assumptions", () => {
    render(<ActionPlanPanel plan={makeActionPlan()} />);
    expect(screen.getByText("Assumptions:")).toBeDefined();
    expect(screen.getByText(/The build passes/)).toBeDefined();
    expect(screen.getByText(/needs verification/)).toBeDefined();
  });

  it("ActionPlanPanel shows steps with status", () => {
    render(<ActionPlanPanel plan={makeActionPlan()} />);
    expect(screen.getByText("Steps:")).toBeDefined();
    expect(screen.getByText(/files.read/)).toBeDefined();
    expect(screen.getByText(/files.write/)).toBeDefined();
  });

  it("ActionPlanPanel shows risk indicator for high-risk steps", () => {
    render(<ActionPlanPanel plan={makeActionPlan()} />);
    expect(screen.getByText(/high risk/i)).toBeDefined();
  });

  // ─── ApprovalRequestPanel ─────────────────────────────────────

  it("ApprovalRequestPanel renders pending request", () => {
    render(<ApprovalRequestPanel request={makeApprovalRequest("pending")} />);
    expect(screen.getByText("Approval Required")).toBeDefined();
    expect(screen.getByText("Write file")).toBeDefined();
  });

  it("ApprovalRequestPanel shows approve/deny buttons for pending", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(
      <ApprovalRequestPanel
        request={makeApprovalRequest("pending")}
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );
    expect(screen.getByText("Approve")).toBeDefined();
    expect(screen.getByText("Deny")).toBeDefined();
  });

  it("ApprovalRequestPanel does not show buttons for approved", () => {
    render(<ApprovalRequestPanel request={makeApprovalRequest("approved")} />);
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.getAllByText((_, node) => !!node?.textContent?.includes("Status: approved")).length).toBeGreaterThan(0);
  });

  it("ApprovalRequestPanel does not show buttons for denied", () => {
    render(<ApprovalRequestPanel request={makeApprovalRequest("denied")} />);
    expect(screen.queryByText("Deny")).toBeNull();
    expect(screen.getAllByText((_, node) => !!node?.textContent?.includes("Status: denied")).length).toBeGreaterThan(0);
  });

  it("ApprovalRequestPanel shows step details", () => {
    render(<ApprovalRequestPanel request={makeApprovalRequest("pending")} />);
    expect(screen.getAllByText((_, node) => !!node?.textContent?.includes("files.write")).length).toBeGreaterThan(0);
  });

  it("ApprovalRequestPanel calls onApprove when approve clicked", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(
      <ApprovalRequestPanel
        request={makeApprovalRequest("pending")}
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );
    fireEvent.click(screen.getByText("Approve"));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("ApprovalRequestPanel calls onDeny when deny clicked", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(
      <ApprovalRequestPanel
        request={makeApprovalRequest("pending")}
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );
    fireEvent.click(screen.getByText("Deny"));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });
});
