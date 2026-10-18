/**
 * Regression: stage-evidence registration starvation (Gate B, golden
 * journey 2026-10-17, staging b50f4f9a).
 *
 * A full-scope build wrote index.html correctly yet every required stage
 * reported "pending": machine observations for later stages (build/run/
 * test) sat buffered in session.observations because they could only file
 * while the earlier required stage (understand) was current. When the
 * agent never emitted its cognitive-stage markers, real evidence never
 * registered and the run was marked FAILED.
 *
 * Fix: observations file for ANY stage (recording is not passing —
 * begin/pass/skip still enforce order). The verdict then names only the
 * genuinely missing stages instead of reporting provably-done work as
 * absent.
 */
import { describe, expect, it } from "vitest";
import {
  finalizeQualityLoop,
  noteBuildArtifacts,
  notePreviewReady,
  noteStaticArtifactCheck,
  noteToolResult,
  startQualityLoopSession,
} from "../quality-loop-flow";

function fullStaticSession() {
  return startQualityLoopSession({
    runId: "run-test",
    projectId: "proj-test",
    userId: "user-test",
    userRequest: "Build me a website for my bakery with a landing page",
    isStaticWorkspace: true,
  });
}

describe("quality gate — evidence registration", () => {
  it("files machine observations for later stages even when an earlier required stage has no evidence", () => {
    const session = fullStaticSession();
    // The agent never emits QUALITY markers for understand/plan/design.
    // Real work still happens: a mutating write, a verified artifact,
    // a ready preview, and a verified read-back.
    noteToolResult(session, "files.write", {
      success: true,
      result: {},
      mutating: true,
      summary: "wrote index.html",
    }, "ws-test");
    noteBuildArtifacts(session, ["index.html"]);
    notePreviewReady(session, "/api/preview/proj-test/");
    session.state.stages; // ensure state exists
    noteStaticArtifactCheck(session, { path: "index.html", contentMatches: true });

    const finale = finalizeQualityLoop(session, { deployRequested: false });
    // Old behavior: all six required stages reported "pending".
    // New behavior: build/run/test evidence is registered and named
    // accurately; only genuinely missing cognitive stages block.
    expect(finale.unfiledObservations).toBe(0);
    const byStage = Object.fromEntries(finale.stages.map((s) => [s.stage, s]));
    expect(byStage.build.evidenceCount).toBeGreaterThan(0);
    expect(byStage.run.evidenceCount).toBeGreaterThan(0);
    expect(byStage.test.evidenceCount).toBeGreaterThan(0);
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.reason).toContain('"understand"');
    // The defect signature was zero-registered evidence: every stage
    // reported pending with an EMPTY ledger even though work provably ran.
    // Now the machine evidence is filed — the ledger shows what happened.
    expect(byStage.build.status === "pending" || byStage.build.status === "active").toBe(true);
  });

  it("a run whose agent declares the cognitive stages can pass the gate", () => {
    const session = fullStaticSession();
    session.observations.push(
      { stage: "understand", evidence: { summary: "Brief: bakery landing page for local customers.", by: "agent" } },
      { stage: "plan", evidence: { summary: "Plan: hero, menu, contact sections.", by: "agent" } },
      { stage: "design", evidence: { summary: "Design: warm palette, serif headings.", by: "agent" } },
    );
    noteToolResult(session, "files.write", {
      success: true, result: {}, mutating: true, summary: "wrote index.html",
    }, "ws-test");
    noteBuildArtifacts(session, ["index.html"]);
    notePreviewReady(session, "/api/preview/proj-test/");
    noteStaticArtifactCheck(session, { path: "index.html", contentMatches: true });

    const finale = finalizeQualityLoop(session, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).toEqual([]);
  });
});
