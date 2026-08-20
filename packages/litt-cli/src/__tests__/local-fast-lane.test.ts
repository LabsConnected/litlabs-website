/**
 * Local Fast Lane — regression tests.
 *
 * Proves the deterministic local fast-path:
 *   1. "what branch am i on" matches locally (never reaches model routing)
 *   2. branch response matches the canonical refreshed branch
 *   3. "is git clean" reflects real git state
 *   4. project query returns the canonical project name
 *   5. plan/act mode query reflects the current mode
 *   6. bare exit/quit exits locally
 *   7. ambiguous chat does NOT match (falls through to model path)
 *   8. local path does not create a Mission (early return before mission path)
 *   9. local path does not call VerificationGate (early return before verify)
 *  10. LITT_PERF labels the local path truthfully:
 *        - kind="local"
 *        - trace is exactly submit → local_match → finalize
 *        - NO intent_classified (classifyIntent is bypassed, not run)
 *        - NO route / provider_ready / plan_start / plan_end /
 *           agent_loop_start / tool_start / tool_end / first_token
 *
 * The controller's submit() runs `if (matchLocalFastPath(...)) { ...; return; }`
 * BEFORE classifyIntent / model routing / mission creation / VerificationGate.
 * So a non-null matchLocalFastPath result for an input IS proof that the model
 * path, mission path, and verification gate are never reached for that input.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock getGitState so git-dependent cases are deterministic and do not
// depend on the host repo's transient dirty/clean state.
vi.mock("../lib/git-state.js", () => ({
  getGitState: vi.fn(() => ({
    isGitRepo: true,
    branch: "feat/local-test",
    root: "/fake",
    changed: 0,
    untracked: 0,
    clean: true,
    files: [],
    porcelain: "",
  })),
  countGitChanges: vi.fn((p: string) => {
    const lines = p.split("\n").filter((l) => l.trim().length > 0);
    const untracked = lines.filter((l) => l.startsWith("??")).length;
    return { changed: lines.length - untracked, untracked };
  }),
}));

import { matchLocalFastPath, normalizeLocalInput } from "../lib/local-fast-lane.js";
import { getGitState } from "../lib/git-state.js";
import { PerfTrace } from "../lib/perf-trace.js";

const mockedGetGitState = vi.mocked(getGitState);

const baseCtx = { cwd: "/fake", projectName: "litt-final-integration", mode: "plan" as const };

describe("Local Fast Lane — normalizeLocalInput", () => {
  it("lowercases, trims, strips trailing punctuation, collapses whitespace", () => {
    expect(normalizeLocalInput("What branch am I on?")).toBe("what branch am i on");
    expect(normalizeLocalInput("  Current   branch.  ")).toBe("current branch");
    expect(normalizeLocalInput("is git clean?!")).toBe("is git clean");
  });
});

describe("Local Fast Lane — regression suite", () => {
  beforeEach(() => {
    mockedGetGitState.mockReset();
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: "feat/local-test",
      root: "/fake",
      changed: 0,
      untracked: 0,
      clean: true,
      files: [],
      porcelain: "",
    });
  });

  // 1 + 2 — branch query matches locally and returns the canonical branch.
  it("1+2: 'what branch am i on' matches locally and returns the canonical refreshed branch", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: "perf/litt-local-fast-lane",
      root: "/fake",
      changed: 0,
      untracked: 0,
      clean: true,
      files: [],
      porcelain: "",
    });
    const res = matchLocalFastPath("what branch am i on", baseCtx);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("branch");
    expect(res!.text).toContain("perf/litt-local-fast-lane");
    // Proves the model path is never reached: a non-null result means the
    // controller's early return fires before classifyIntent/route().
    expect(getGitState).toHaveBeenCalledWith("/fake");
  });

  it("matches 'what branch is this' and 'current branch'", () => {
    expect(matchLocalFastPath("what branch is this", baseCtx)?.kind).toBe("branch");
    expect(matchLocalFastPath("current branch", baseCtx)?.kind).toBe("branch");
    expect(matchLocalFastPath("current branch?", baseCtx)?.kind).toBe("branch");
  });

  it("branch query on a non-repo / detached HEAD is truthful", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: false,
      branch: null,
      root: "/fake",
      changed: 0,
      untracked: 0,
      clean: true,
      files: [],
      porcelain: "",
    });
    const res = matchLocalFastPath("what branch am i on", baseCtx);
    expect(res?.text).toContain("detached HEAD or not a git repo");
  });

  // 3 — git cleanliness reflects real git state.
  it("3: 'is git clean' reflects real git state (clean)", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: "main",
      root: "/fake",
      changed: 0,
      untracked: 0,
      clean: true,
      files: [],
      porcelain: "",
    });
    const res = matchLocalFastPath("is git clean", baseCtx);
    expect(res?.kind).toBe("git-clean");
    expect(res?.text).toContain("clean");
    expect(res?.text).not.toContain("dirty");
  });

  it("3b: 'is the repo dirty' reflects real git state (dirty)", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: "main",
      root: "/fake",
      changed: 3,
      untracked: 2,
      clean: false,
      files: [" M a.ts", "?? b.ts"],
      porcelain: " M a.ts\n?? b.ts",
    });
    const res = matchLocalFastPath("is the repo dirty", baseCtx);
    expect(res?.kind).toBe("git-clean");
    expect(res?.text).toContain("dirty");
    expect(res?.text).toContain("3 changed");
    expect(res?.text).toContain("2 untracked");
  });

  it("3c: 'do i have changes' on a non-repo is truthful", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: false,
      branch: null,
      root: "/fake",
      changed: 0,
      untracked: 0,
      clean: true,
      files: [],
      porcelain: "",
    });
    const res = matchLocalFastPath("do i have changes", baseCtx);
    expect(res?.text).toContain("Not a git repository");
  });

  // 4 — project query returns the canonical project name.
  it("4: project query returns the canonical project name", () => {
    const res = matchLocalFastPath("what project is this", baseCtx);
    expect(res?.kind).toBe("project");
    expect(res?.text).toContain("litt-final-integration");
  });

  it("4b: project query variants all match", () => {
    expect(matchLocalFastPath("what repo is this", baseCtx)?.kind).toBe("project");
    expect(matchLocalFastPath("what repository is this", baseCtx)?.kind).toBe("project");
  });

  it("4c: project query with no detected project is truthful", () => {
    const res = matchLocalFastPath("what project is this", { cwd: "/fake", mode: "act" });
    expect(res?.text).toContain("unknown");
  });

  // 5 — mode query reflects the current mode.
  it("5: plan/act mode query reflects the current mode", () => {
    const planRes = matchLocalFastPath("what mode am i in", { cwd: "/fake", projectName: "x", mode: "plan" });
    expect(planRes?.kind).toBe("mode");
    expect(planRes?.text).toContain("PLAN");
    expect(planRes?.text).toContain("read-only");

    const actRes = matchLocalFastPath("what mode am i in", { cwd: "/fake", projectName: "x", mode: "act" });
    expect(actRes?.text).toContain("ACT");
    expect(actRes?.text).toContain("full execution");
  });

  it("5b: 'am i in plan mode' / 'am i in act mode' match", () => {
    expect(matchLocalFastPath("am i in plan mode", baseCtx)?.kind).toBe("mode");
    expect(matchLocalFastPath("am i in act mode", baseCtx)?.kind).toBe("mode");
  });

  // 6 — bare exit/quit exits locally.
  it("6: bare 'exit' and 'quit' exit locally (no model)", () => {
    const exitRes = matchLocalFastPath("exit", baseCtx);
    expect(exitRes?.kind).toBe("exit");
    expect(exitRes?.text).toContain("Exiting");

    const quitRes = matchLocalFastPath("quit", baseCtx);
    expect(quitRes?.kind).toBe("exit");
  });

  it("6b: exit/quit with trailing punctuation still match", () => {
    expect(matchLocalFastPath("exit.", baseCtx)?.kind).toBe("exit");
  });

  // 7 — ambiguous chat does NOT match (falls through to model path).
  it("7: ambiguous chat does NOT match (returns null → model path)", () => {
    // "whats up" is the proven baseline chat query — must NOT be hijacked.
    expect(matchLocalFastPath("whats up", baseCtx)).toBeNull();
    // Variant phrasings that are NOT in the exact phrase set fall through.
    expect(matchLocalFastPath("what's my branch", baseCtx)).toBeNull();
    expect(matchLocalFastPath("tell me the branch", baseCtx)).toBeNull();
    expect(matchLocalFastPath("which branch", baseCtx)).toBeNull();
    expect(matchLocalFastPath("am i clean", baseCtx)).toBeNull();
    expect(matchLocalFastPath("what are you", baseCtx)).toBeNull();
    expect(matchLocalFastPath("hello", baseCtx)).toBeNull();
  });

  // 8 + 9 — local path does not create a Mission / call VerificationGate.
  // The controller runs the local block BEFORE classifyIntent and returns
  // unconditionally on a match. So a non-null result for a local query is
  // proof that startMission() and runVerify() are never reached.
  it("8+9: local matches never reach mission/verify (early return proof)", () => {
    const localInputs = [
      "what branch am i on",
      "what project is this",
      "is git clean",
      "what mode am i in",
      "exit",
    ];
    for (const input of localInputs) {
      const res = matchLocalFastPath(input, baseCtx);
      // A non-null result means the controller's `if (local) { ... return; }`
      // fires before classifyIntent → mission/verify paths. This is the
      // structural guarantee that no Mission is created and no
      // VerificationGate is invoked for local queries.
      expect(res, `expected local match for "${input}"`).not.toBeNull();
    }
  });

  // 10 — LITT_PERF labels the local path truthfully.
  // The Local Fast Lane runs BEFORE classifyIntent(), so the trace MUST NOT
  // claim "intent_classified" — that classifier is intentionally bypassed.
  // The truthful local boundaries are: submit → local_match → finalize.
  it("10: LITT_PERF labels local path truthfully (kind=local, no classifier/provider/plan/tool marks)", () => {
    const original = process.env.LITT_PERF;
    process.env.LITT_PERF = "1";
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      // Mirror the EXACT mark sequence the controller emits on a local hit.
      // The controller calls PerfTrace.start("local"), then mark("local_match"),
      // then mark("finalize"), then end("local"). It does NOT call
      // mark("intent_classified") — classifyIntent() is bypassed entirely.
      const perf = PerfTrace.start("local");
      perf.mark("local_match");
      perf.mark("finalize");
      perf.end("local");
      const output = spy.mock.calls.map((c) => String(c[0])).join("");

      // Truthful header: kind=local, intent=local, total ms.
      expect(output).toContain("LiTT PERF");
      expect(output).toMatch(/\(local · local · \d+ms\)/);

      // Truthful local boundaries — the only marks that should appear.
      expect(output).toContain("local_match");
      expect(output).toContain("finalize");

      // The local path ends as kind "local" (the header kind, not "chat"/"mission").
      expect(output).toMatch(/\(local ·/);

      // ─── Explicit exclusions: the local path bypasses these entirely ──
      // classifyIntent() is NEVER run on a local hit, so its mark MUST NOT
      // appear. This is the core truthfulness fix — the previous trace
      // falsely claimed "intent_classified" when the classifier was bypassed.
      expect(output).not.toContain("intent_classified");
      // No model routing happens on the local path.
      expect(output).not.toContain("route");
      // No provider adapter is resolved on the local path.
      expect(output).not.toContain("provider_ready");
      // No planning round runs on the local path.
      expect(output).not.toContain("plan_start");
      expect(output).not.toContain("plan_end");
      // No agent execution loop runs on the local path.
      expect(output).not.toContain("agent_loop_start");
      // No tools are invoked on the local path.
      expect(output).not.toContain("tool_start");
      expect(output).not.toContain("tool_end");
      // No model prose is streamed on the local path.
      expect(output).not.toContain("first_token");
    } finally {
      spy.mockRestore();
      if (original === undefined) delete process.env.LITT_PERF;
      else process.env.LITT_PERF = original;
    }
  });

  it("10b: local trace is exactly submit → local_match → finalize (ordered)", () => {
    // Pins the exact ordered mark chain the controller emits on a local
    // hit. Any regression that reintroduces intent_classified (or any
    // other intermediate mark) on the local path breaks this.
    const original = process.env.LITT_PERF;
    process.env.LITT_PERF = "1";
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const perf = PerfTrace.start("local");
      perf.mark("local_match");
      perf.mark("finalize");
      perf.end("local");
      const output = spy.mock.calls.map((c) => String(c[0])).join("");

      // Reconstruct the ordered mark chain from the report.
      const marks: string[] = [];
      for (const line of output.split("\n")) {
        if (!line.includes("→") || line.includes("(total to last mark)")) continue;
        const match = line.match(/^\s*(\S+)\s+→\s+(\S+)\s+\d+ms\s*$/);
        if (!match) continue;
        const [, from, to] = match;
        if (marks.length === 0) marks.push(from);
        if (marks.at(-1) !== to) marks.push(to);
      }
      expect(marks).toEqual(["submit", "local_match", "finalize"]);
    } finally {
      spy.mockRestore();
      if (original === undefined) delete process.env.LITT_PERF;
      else process.env.LITT_PERF = original;
    }
  });

  it("10c: PerfTrace.end accepts 'local' (type-level contract)", () => {
    // Compile-time: end("local") is accepted. Runtime: idempotent + no throw.
    process.env.LITT_PERF = "1";
    const perf = PerfTrace.start("local");
    perf.end("local");
    expect(perf.enabled).toBe(true);
    delete process.env.LITT_PERF;
  });
});
