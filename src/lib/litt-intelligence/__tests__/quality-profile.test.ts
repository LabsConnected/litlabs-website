/**
 * Task-sized quality gate (acceptance 2026-09-28): a one-line edit must not
 * require the full eight-stage website workflow, and evidence is recorded
 * automatically as stages actually execute.
 */
import { describe, it, expect } from "vitest";
import {
  classifyQualityProfile,
  createQualityLoop,
  declareSuccess,
} from "../quality-loop";
import {
  finalizeQualityLoop,
  noteMutationReadBack,
  noteToolResult,
  snapshotQualityLoopSession,
  startQualityLoopSession,
  qualityLoopPromptSection,
  QUALITY_LOOP_PROMPT_SECTION,
} from "../quality-loop-flow";

const ACCEPTANCE_PROMPT =
  "Add an HTML comment `<!-- acceptance-test -->` right after the opening <body> tag in index.html";

function session(userRequest: string) {
  return startQualityLoopSession({ runId: "r1", projectId: "p1", userId: "u1", userRequest });
}

const mutation = (toolId = "files.patch") => ({
  success: true,
  result: { success: true },
  mutating: true,
  summary: `${toolId} ok`,
});

describe("classifyQualityProfile", () => {
  it("classifies the acceptance prompt as a targeted edit", () => {
    expect(classifyQualityProfile(ACCEPTANCE_PROMPT)).toBe("edit");
  });

  it.each([
    "Build me a modern website for my roofing business",
    "Create a landing page for my new product",
    "Make a portfolio site for my photography",
    "Design a booking web app from scratch",
  ])("site builds get the full gate: %s", (req) => {
    expect(classifyQualityProfile(req)).toBe("site");
  });

  it.each([
    "Change the hero headline to 'Roofs that last'",
    "Fix the typo in the footer",
    "Rename the About page to Our Story",
  ])("small edits: %s", (req) => {
    expect(classifyQualityProfile(req)).toBe("edit");
  });

  it("everything else is a feature", () => {
    expect(
      classifyQualityProfile(
        "I'd like visitors to be able to request a quote. It should collect name, phone and roof type. " +
          "Store submissions somewhere I can see them. Also send me an email when one arrives.",
      ),
    ).toBe("feature");
  });

  it("an empty request keeps the strict gate", () => {
    expect(classifyQualityProfile("")).toBe("site");
  });
});

describe("edit profile", () => {
  it("records UNDERSTAND automatically from the request", () => {
    const s = session(ACCEPTANCE_PROMPT);
    expect(s.state.profile).toBe("edit");
    expect(s.state.stages.understand.evidence[0]?.by).toBe("system");
  });

  it("passes after a successful edit that is read back — no website stages required", () => {
    const s = session(ACCEPTANCE_PROMPT);
    noteToolResult(s, "files.patch", mutation(), "ws1");
    noteMutationReadBack(s, { path: "index.html", readable: true, contentMatches: null });
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).toEqual([]);
    const byStage = Object.fromEntries(finale.stages.map((x) => [x.stage, x.status]));
    expect(byStage.understand).toBe("passed");
    expect(byStage.build).toBe("passed");
    expect(byStage.inspect).toBe("passed");
    expect(byStage.plan).toBe("skipped");
    expect(byStage.design).toBe("skipped");
    expect(byStage.critique).toBe("skipped");
  });

  it("passes after a successful edit verified by a passing check instead", () => {
    const s = session(ACCEPTANCE_PROMPT);
    noteToolResult(s, "files.write", mutation("files.write"), "ws1");
    noteToolResult(s, "test.run", { success: true, result: { success: true, exitCode: 0 }, mutating: false, summary: "tests ok" }, "ws1");
    expect(finalizeQualityLoop(s, { deployRequested: false }).verdict.ok).toBe(true);
  });

  it("still refuses success when the edit was never verified", () => {
    const s = session(ACCEPTANCE_PROMPT);
    noteToolResult(s, "files.patch", mutation(), "ws1");
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.reason).toMatch(/not verified/);
    expect(finale.verdict.reason).not.toMatch(/"design"|"critique"|"plan"/);
  });

  it("still refuses success when no edit happened", () => {
    const s = session(ACCEPTANCE_PROMPT);
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("build");
  });

  it("a failing check blocks success even with a read-back", () => {
    const s = session(ACCEPTANCE_PROMPT);
    noteToolResult(s, "files.patch", mutation(), "ws1");
    noteToolResult(s, "test.run", { success: false, result: { success: false, exitCode: 1 }, mutating: false, summary: "1 failing" }, "ws1");
    noteMutationReadBack(s, { path: "index.html", readable: true, contentMatches: true });
    expect(finalizeQualityLoop(s, { deployRequested: false }).verdict.ok).toBe(false);
  });

  it("a read-back that does not confirm the edit is not a pass", () => {
    const s = session(ACCEPTANCE_PROMPT);
    noteToolResult(s, "files.write", mutation("files.write"), "ws1");
    noteMutationReadBack(s, { path: "index.html", readable: true, contentMatches: false });
    expect(finalizeQualityLoop(s, { deployRequested: false }).verdict.ok).toBe(false);
  });

  it("read-back evidence is ignored before any mutation happened", () => {
    const s = session(ACCEPTANCE_PROMPT);
    noteMutationReadBack(s, { path: "index.html", readable: true, contentMatches: true });
    expect(s.state.stages.inspect.evidence).toHaveLength(0);
  });

  it("deploy stays mandatory when a deployment was requested", () => {
    const s = session(ACCEPTANCE_PROMPT);
    noteToolResult(s, "files.patch", mutation(), "ws1");
    noteMutationReadBack(s, { path: "index.html", readable: true, contentMatches: null });
    const finale = finalizeQualityLoop(s, { deployRequested: true });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toEqual(expect.arrayContaining(["deploy", "verify"]));
  });

  it("the profile survives an approval pause (snapshot/restore)", () => {
    const s = session(ACCEPTANCE_PROMPT);
    const snap = snapshotQualityLoopSession(s);
    const resumed = startQualityLoopSession({ runId: "r2", projectId: "p1", userId: "u1", userRequest: "", snapshot: snap });
    expect(resumed.state.profile).toBe("edit");
    noteToolResult(resumed, "files.patch", mutation(), "ws1");
    noteMutationReadBack(resumed, { path: "index.html", readable: true, contentMatches: null });
    expect(finalizeQualityLoop(resumed, { deployRequested: false }).verdict.ok).toBe(true);
  });
});

describe("site profile is unchanged", () => {
  it("a mutation plus read-back does NOT satisfy a website build", () => {
    const s = session("Build me a modern website for my roofing business");
    expect(s.state.profile).toBe("site");
    noteToolResult(s, "files.write", mutation("files.write"), "ws1");
    noteMutationReadBack(s, { path: "index.html", readable: true, contentMatches: true });
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toEqual(
      expect.arrayContaining(["understand", "plan", "design", "build", "run", "inspect", "critique", "test"]),
    );
  });

  it("legacy snapshots without a profile keep the full gate", () => {
    const legacy = createQualityLoop({ runId: "r", projectId: "p", userId: "u" });
    delete (legacy as { profile?: unknown }).profile;
    const v = declareSuccess(legacy, { deployRequested: false });
    expect(v.ok).toBe(false);
    expect(v.missing).toHaveLength(8);
  });
});

describe("prompt section", () => {
  it("targeted work does not teach the eight-stage website workflow", () => {
    expect(qualityLoopPromptSection("site")).toBe(QUALITY_LOOP_PROMPT_SECTION);
    expect(qualityLoopPromptSection("edit")).not.toMatch(/QUALITY: <stage>/);
    expect(qualityLoopPromptSection("edit")).not.toMatch(/understand → research → plan/);
    expect(qualityLoopPromptSection("edit")).toMatch(/targeted edit/);
  });
});
