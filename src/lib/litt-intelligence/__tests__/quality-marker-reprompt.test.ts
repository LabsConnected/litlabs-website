/**
 * Regression tests for the bounded missing-stage-declaration reprompt.
 *
 * Prod golden run 41505296694: a full-scope static build wrote files,
 * served a verified preview, and passed read-back — yet the quality
 * verdict failed because the model emitted only QUALITY: BUILD, leaving
 * understand/plan/design undeclared (they are intentionally NOT
 * system-filed for full scope). The loop now reprompts once for the
 * declarations instead of letting the verdict deadlock.
 */
import { describe, expect, it } from "vitest";

import {
  buildMissingStageDeclarationPrompt,
  harvestStageMarkers,
  missingDeclarableStages,
  startQualityLoopSession,
} from "../quality-loop-flow";

function makeSession(opts?: { isStaticWorkspace?: boolean; request?: string }) {
  return startQualityLoopSession({
    runId: "run-1",
    projectId: "proj-1",
    userId: "user-1",
    userRequest:
      opts?.request ??
      "Build a simple single-page landing site for a coffee roastery called Ember Roast.",
    isStaticWorkspace: opts?.isStaticWorkspace,
  });
}

describe("missingDeclarableStages", () => {
  it("full-scope build: understand/plan/design are all missing initially", () => {
    const session = makeSession();
    expect(session.taskScope).toBe("full");
    expect(missingDeclarableStages(session)).toEqual(["understand", "plan", "design"]);
  });

  it("standard scope: nothing declarable is missing (system files understand+plan)", () => {
    const session = makeSession({ request: "Fix the typo in the footer." });
    expect(session.taskScope).toBe("trivial");
    expect(missingDeclarableStages(session)).toEqual([]);
  });

  it("static workspace does not change the declarable set", () => {
    const session = makeSession({ isStaticWorkspace: true });
    expect(missingDeclarableStages(session)).toEqual(["understand", "plan", "design"]);
  });

  it("harvested QUALITY markers remove stages from the missing list", () => {
    const session = makeSession();
    harvestStageMarkers(session, [
      {
        role: "assistant",
        content:
          "QUALITY: understand — Audience: home coffee brewers; goal: roastery sales.\n" +
          "QUALITY: design — Dark glassmorphic theme, hero-forward hierarchy.",
      },
    ]);
    expect(missingDeclarableStages(session)).toEqual(["plan"]);
  });

  it("non-declarable required stages are not reprompted", () => {
    // build/run/test are required for full scope but machine-evidenced —
    // the reprompt must never ask the model to "declare" them.
    const session = makeSession();
    const missing = missingDeclarableStages(session);
    expect(missing).not.toContain("build");
    expect(missing).not.toContain("run");
    expect(missing).not.toContain("test");
  });
});

describe("buildMissingStageDeclarationPrompt", () => {
  it("emits one QUALITY marker hint per missing stage", () => {
    const prompt = buildMissingStageDeclarationPrompt(["understand", "design"]);
    expect(prompt).toContain("understand, design");
    expect(prompt).toContain("QUALITY: understand —");
    expect(prompt).toContain("QUALITY: design —");
    expect(prompt).toContain("do NOT");
  });
});
