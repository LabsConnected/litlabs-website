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

  it("rejects explicitly stale evidence recorded before the stage began (D4)", async () => {
    const { createQualityLoop, recordEvidence, beginStage } = await import("../quality-loop");
    const state = createQualityLoop({ runId: "r", projectId: "p", userId: "u" });
    beginStage(state, "understand");
    const startedAt = state.stages.understand.startedAt!;
    expect(startedAt).toBeTruthy();
    const staleAt = new Date(Date.parse(startedAt) - 60_000).toISOString();
    expect(() =>
      recordEvidence(state, "understand", {
        summary: "forged early evidence",
        by: "agent",
        at: staleAt,
      }),
    ).toThrow(/stale/i);
  });

  it("evidence filed for a still-pending future stage does not authorize a pass (D4)", async () => {
    const { createQualityLoop, recordEvidence, beginStage, passStage, StageGateError } =
      await import("../quality-loop");
    const state = createQualityLoop({ runId: "r", projectId: "p", userId: "u" });
    // Out-of-order filing for a future stage stays pending (the starvation
    // fix) — but once that stage activates, its startedAt postdates the
    // pre-filed evidence so it cannot authorize a pass.
    const staleAt = new Date(Date.now() - 60_000).toISOString();
    recordEvidence(state, "research", { summary: "early", by: "agent", at: staleAt });
    expect(state.stages.research.status).toBe("pending");
    recordEvidence(state, "understand", { summary: "brief understood", by: "agent" });
    passStage(state, "understand");
    beginStage(state, "research");
    const { stagePassable } = await import("../quality-loop-flow");
    expect(stagePassable(state, "research")).toBe(false);
    // Fresh evidence recorded after activation does authorize.
    recordEvidence(state, "research", { summary: "research done", by: "agent" });
    expect(stagePassable(state, "research")).toBe(true);
  });
});
