/**
 * Regression: a static website build must never earn a clean quality
 * pass while its pages still reference placeholder images.
 *
 * Production defect 2026-11-11 (build f9ad12cd): the "LiTT Food Court"
 * site shipped with two <img> slots pointing at
 * assets/images/placeholder.svg — dark empty boxes in the rendered page —
 * and the run COMPLETED with its quality gate passed. The enrichment
 * pass counted the placeholder fallbacks in its own report, but nothing
 * fed that fact into the quality loop, and the visual audit treated the
 * (existing) placeholder file as a resolved asset.
 *
 * The contract pinned here:
 * - noteStaticVisualAudit records surviving placeholder refs on the
 *   loop state and as TEST evidence; while any remain, TEST cannot pass
 *   and the verdict names the refs.
 * - A later clean audit clears the block (the fix-then-pass flow).
 * - The block is order-independent: read-back TEST evidence filed
 *   before OR after the audit note can never mask it.
 * - Inspection-scope sessions (read-only, PR #907 taskKind scoping) and
 *   non-static sessions are untouched — the check belongs to mutating
 *   static BUILD runs, whose enrichment pass is the only caller.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/terminal-internal-client", () => ({
  buildPreviewProxyUrl: (id: string) => `https://preview.test/${id}`,
}));

vi.mock("../deploy", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../deploy")>();
  return { ...orig, verifyProductionUrl: vi.fn() };
});

vi.mock("../visual-judge", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../visual-judge")>();
  return { ...orig, runVisualJudge: vi.fn() };
});

import {
  finalizeQualityLoop,
  harvestStageMarkers,
  noteBuildArtifacts,
  notePreviewReady,
  noteStaticArtifactCheck,
  noteStaticVisualAudit,
  noteToolResult,
  startQualityLoopSession,
  type QualityLoopSession,
} from "../quality-loop-flow";

function makeStaticSession(): QualityLoopSession {
  return startQualityLoopSession({
    runId: "run-placeholder",
    projectId: "proj-1",
    userId: "user-1",
    userRequest: "Build me a food court website",
    isStaticWorkspace: true,
  });
}

/** The exact evidence a successful static-lane full build produces. */
function completeStaticBuildEvidence(s: QualityLoopSession): void {
  harvestStageMarkers(s, [
    {
      role: "assistant" as const,
      content: [
        "QUALITY: understand — Food-court owners; the goal is vendor signups.",
        "QUALITY: plan — One page: hero, vendors, gallery, visit info.",
        "QUALITY: design — Bold palette, display type, card grid.",
      ].join("\n"),
    },
  ]);
  noteToolResult(
    s,
    "files.write",
    { success: true, result: {}, mutating: true, summary: "wrote index.html" },
    "ws-1",
  );
  noteStaticArtifactCheck(s, { path: "index.html", contentMatches: true });
  noteBuildArtifacts(s, ["index.html", "styles.css"]);
  notePreviewReady(s, "/api/preview/proj-1/");
}

describe("static visual audit — placeholder gate", () => {
  it("blocks a clean pass while placeholder refs survive, and names them", () => {
    const s = makeStaticSession();
    completeStaticBuildEvidence(s);
    noteStaticVisualAudit(s, ["assets/images/placeholder.svg"]);
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("test");
    expect(finale.verdict.reason).toMatch(/placeholder/i);
    expect(finale.verdict.reason).toContain("assets/images/placeholder.svg");
    expect(s.state.stages.test.status).not.toBe("passed");
  });

  it("stays blocked when the audit note lands BEFORE the read-back evidence", () => {
    // Order-independence: the enrichment audit fires per mutation, the
    // read-back check files its own TEST pass — neither order may let
    // the passing read-back mask surviving placeholders.
    const s = makeStaticSession();
    noteStaticVisualAudit(s, ["assets/images/placeholder.svg"]);
    completeStaticBuildEvidence(s);
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("test");
  });

  it("clears the block when a later audit finds no placeholders", () => {
    const s = makeStaticSession();
    completeStaticBuildEvidence(s);
    noteStaticVisualAudit(s, ["assets/images/placeholder.svg"]);
    // The agent's next edit resolves the slots; the re-run enrichment
    // pass audits clean and the gate must recover.
    noteStaticVisualAudit(s, []);
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
    expect(s.state.stages.test.status).toBe("passed");
  });

  it("passes a fully-resolved build exactly as before (no audit friction)", () => {
    const s = makeStaticSession();
    completeStaticBuildEvidence(s);
    noteStaticVisualAudit(s, []);
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
  });

  it("does not touch non-static sessions", () => {
    const s = startQualityLoopSession({
      runId: "run-git",
      projectId: "proj-1",
      userId: "user-1",
      userRequest: "Build me a food court website",
    });
    noteStaticVisualAudit(s, ["assets/images/placeholder.svg"]);
    expect(s.state.visualAudit).toBeUndefined();
    expect(
      s.state.stages.test.evidence.some(
        (e) => (e.detail as { via?: string } | undefined)?.via === "static-visual-audit",
      ),
    ).toBe(false);
  });

  it("does not touch inspection-scope sessions (read-only runs stay light)", () => {
    const s = startQualityLoopSession({
      runId: "run-inspect",
      projectId: "proj-1",
      userId: "user-1",
      userRequest: "List the files in this project",
      isStaticWorkspace: true,
      taskScope: "inspection",
    });
    noteStaticVisualAudit(s, ["assets/images/placeholder.svg"]);
    expect(s.state.visualAudit).toBeUndefined();
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
  });
});
