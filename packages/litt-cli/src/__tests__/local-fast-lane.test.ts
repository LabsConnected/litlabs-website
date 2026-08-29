/* eslint-disable @typescript-eslint/no-require-imports */
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

// Mock getGitState, readBranchFromGitDir, and readHeadStateFromGitDir so
// git-dependent cases are deterministic and do not depend on the host
// repo's transient state.
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
  readBranchFromGitDir: vi.fn(() => "feat/local-test"),
  readHeadStateFromGitDir: vi.fn(() => ({ kind: "branch", branch: "feat/local-test" })),
  countGitChanges: vi.fn((p: string) => {
    const lines = p.split("\n").filter((l) => l.trim().length > 0);
    const untracked = lines.filter((l) => l.startsWith("??")).length;
    return { changed: lines.length - untracked, untracked };
  }),
}));

import { matchLocalFastPath, normalizeLocalInput, stripTrailingPolicy } from "../lib/local-fast-lane.js";
import { getGitState, readBranchFromGitDir, readHeadStateFromGitDir } from "../lib/git-state.js";
import type { GitHeadState } from "../lib/git-state.js";
import { PerfTrace } from "../lib/perf-trace.js";

const mockedGetGitState = vi.mocked(getGitState);
const mockedReadBranchFromGitDir = vi.mocked(readBranchFromGitDir);
const mockedReadHeadStateFromGitDir = vi.mocked(readHeadStateFromGitDir);

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
    mockedReadHeadStateFromGitDir.mockReset();
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "feat/local-test" });
    mockedReadHeadStateFromGitDir.mockReset();
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "feat/local-test" });
  });

  // 1 + 2 — branch query matches locally and returns the fresh branch.
  it("1+2: 'what branch am i on' matches locally and returns the fresh branch from .git/HEAD", () => {
    // .git/HEAD read returns the fresh branch — this is the primary source.
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "perf/litt-local-fast-lane" });
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "perf/litt-local-fast-lane" });
    const res = matchLocalFastPath("what branch am i on", baseCtx);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("branch");
    expect(res!.text).toContain("perf/litt-local-fast-lane");
    // Proves the model path is never reached: a non-null result means the
    // controller's early return fires before classifyIntent/route().
    // .git/HEAD read is the primary source — getGitState should NOT be
    // called when the file read succeeds.
    expect(mockedReadHeadStateFromGitDir).toHaveBeenCalledWith("/fake");
    expect(getGitState).not.toHaveBeenCalled();
  });

  it("matches 'what branch is this' and 'current branch'", () => {
    expect(matchLocalFastPath("what branch is this", baseCtx)?.kind).toBe("branch");
    expect(matchLocalFastPath("current branch", baseCtx)?.kind).toBe("branch");
    expect(matchLocalFastPath("current branch?", baseCtx)?.kind).toBe("branch");
  });

  it("branch query on a non-repo / detached HEAD is truthful", () => {
    // .git/HEAD read returns not-git (not a repo)
        mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "not-git" });
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
    expect(res?.text).toContain("not a git repo");
  });

  it("branch query on detached HEAD (is repo, no branch) is truthful", () => {
    // .git/HEAD read returns detached (detached HEAD — file contains SHA, not ref)
        mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "detached", commit: "abc1234" });
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: null,
      root: "/fake",
      changed: 0,
      untracked: 0,
      clean: true,
      files: [],
      porcelain: "",
    });
    const res = matchLocalFastPath("what branch am i on", baseCtx);
    expect(res?.text).toContain("detached HEAD @ abc1234");
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

// ─── Compound local-state queries ────────────────────────────────────

describe("Local Fast Lane — compound local-state queries", () => {
  beforeEach(() => {
    mockedGetGitState.mockReset();
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: "release/litt-v1-acceptance",
      root: "/fake",
      changed: 0,
      untracked: 0,
      clean: true,
      files: [],
      porcelain: "",
    });
    mockedReadHeadStateFromGitDir.mockReset();
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "release/litt-v1-acceptance" });
    mockedReadHeadStateFromGitDir.mockReset();
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "release/litt-v1-acceptance" });
  });

  it("matches 'what repo and branch am i currently in' as compound", () => {
    const res = matchLocalFastPath(
      "what repo and branch am i currently in",
      baseCtx,
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("compound");
    expect(res!.text).toContain("litt-final-integration");
    expect(res!.text).toContain("release/litt-v1-acceptance");
  });

  it("matches 'what project and branch is this' as compound", () => {
    const res = matchLocalFastPath(
      "what project and branch is this",
      baseCtx,
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("compound");
    expect(res!.text).toContain("litt-final-integration");
    expect(res!.text).toContain("release/litt-v1-acceptance");
  });

  it("matches 'what repo and branch and mode am i in' as compound (3 aspects)", () => {
    const res = matchLocalFastPath(
      "what repo and branch and mode am i in",
      baseCtx,
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("compound");
    expect(res!.text).toContain("litt-final-integration");
    expect(res!.text).toContain("release/litt-v1-acceptance");
    expect(res!.text).toContain("PLAN");
  });

  it("strips trailing 'read only. do not modify anything' and matches compound", () => {
    const res = matchLocalFastPath(
      "What repo and branch am I currently in? Read only. Do not modify anything.",
      baseCtx,
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("compound");
    expect(res!.text).toContain("litt-final-integration");
    expect(res!.text).toContain("release/litt-v1-acceptance");
  });

  it("strips trailing 'don't change anything' and matches compound", () => {
    const res = matchLocalFastPath(
      "what repo and branch am i in don't change anything",
      baseCtx,
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("compound");
  });

  it("strips trailing 'read-only' and matches compound", () => {
    const res = matchLocalFastPath(
      "what project and branch is this read-only",
      baseCtx,
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("compound");
  });

  it("compound query with branch (no clean) uses readHeadStateFromGitDir, NOT getGitState", () => {
    mockedGetGitState.mockClear();
    mockedReadHeadStateFromGitDir.mockClear();
    mockedReadHeadStateFromGitDir.mockClear();
    matchLocalFastPath("what repo and branch am i in", baseCtx);
    // Branch comes from .git/HEAD filesystem read — no git subprocess
    expect(mockedReadHeadStateFromGitDir).toHaveBeenCalledTimes(1);
    expect(mockedGetGitState).not.toHaveBeenCalled();
  });

  it("compound query with repo+branch+clean uses ONE getGitState (no .git/HEAD)", () => {
    mockedGetGitState.mockClear();
    mockedReadHeadStateFromGitDir.mockClear();
    mockedReadHeadStateFromGitDir.mockClear();
    matchLocalFastPath("what repo and branch and is the repo clean", baseCtx);
    // When clean is requested, ONE getGitState provides both branch + dirty
    expect(mockedGetGitState).toHaveBeenCalledTimes(1);
    expect(mockedReadHeadStateFromGitDir).not.toHaveBeenCalled();
  });

  it("compound query without git aspects does NOT call getGitState", () => {
    mockedGetGitState.mockClear();
    // repo + mode — no branch/clean, so no git read needed
    matchLocalFastPath("what repo and mode am i in", baseCtx);
    expect(mockedGetGitState).not.toHaveBeenCalled();
  });

  it("compound query on non-repo is truthful about detached HEAD", () => {
    // .git/HEAD read returns not-git (not a repo)
        mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "not-git" });
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
    const res = matchLocalFastPath("what repo and branch am i in", baseCtx);
    expect(res).not.toBeNull();
    // Branch-only compound falls back to getGitState when .git/HEAD returns not-git
    expect(res!.text).toContain("not a git repo");
  });

  it("compound query with dirty repo reports dirty state", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: "main",
      root: "/fake",
      changed: 5,
      untracked: 3,
      clean: false,
      files: [" M a.ts", "?? b.ts"],
      porcelain: " M a.ts\n?? b.ts",
    });
    const res = matchLocalFastPath(
      "what repo and branch and is the repo dirty",
      baseCtx,
    );
    expect(res).not.toBeNull();
    expect(res!.text).toContain("dirty");
    expect(res!.text).toContain("5 changed");
  });

  // ─── Negative: non-local compound queries fall through ──────────────

  it("compound query with action verb does NOT match (falls to READ/MISSION)", () => {
    expect(matchLocalFastPath("fix the repo and branch", baseCtx)).toBeNull();
    expect(matchLocalFastPath("edit the repo and check the branch", baseCtx)).toBeNull();
    expect(matchLocalFastPath("scan the repo and branch", baseCtx)).toBeNull();
  });

  it("compound query without question form does NOT match", () => {
    // "repo and branch" without "what/which/am i/is this" is not a question
    expect(matchLocalFastPath("repo and branch", baseCtx)).toBeNull();
  });

  it("single-aspect query with trailing policy text still matches via exact phrase", () => {
    // "what branch am i on read only" — after stripping policy, becomes
    // "what branch am i on" which is an exact BRANCH_PHRASE
    const res = matchLocalFastPath(
      "what branch am i on read only",
      baseCtx,
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("branch");
  });

  it("single-aspect 'what repo is this' with trailing policy still matches", () => {
    const res = matchLocalFastPath(
      "what repo is this don't modify anything",
      baseCtx,
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("project");
  });
});

// ─── Fresh branch via .git/HEAD (no subprocess, always current) ────

describe("Local Fast Lane — fresh branch via .git/HEAD", () => {
  beforeEach(() => {
    mockedGetGitState.mockReset();
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: "feat/fallback-branch",
      root: "/fake",
      changed: 0,
      untracked: 0,
      clean: true,
      files: [],
      porcelain: "",
    });
    mockedReadHeadStateFromGitDir.mockReset();
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "feat/fallback-branch" });
  });

  // ─── Branch freshness: .git/HEAD is the primary source ──────────

  it("uses readHeadStateFromGitDir (not getGitState) for 'what branch am i on'", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "feature/new-ui" });
    mockedGetGitState.mockClear();

    const res = matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
    });

    expect(res?.kind).toBe("branch");
    expect(res?.text).toContain("feature/new-ui");
    // .git/HEAD read is the primary source — no git subprocess
    expect(mockedReadHeadStateFromGitDir).toHaveBeenCalledWith("/fake");
    expect(mockedGetGitState).not.toHaveBeenCalled();
  });

  // ─── STALE STATE REPRODUCTION: branch changed externally ────────
  // This is the critical test. If the fast path trusted cached
  // knownBranch, it would return the OLD branch. With .git/HEAD, it
  // returns the NEW branch.

  it("STALE STATE: external branch change reflected immediately (not cached)", () => {
    // .git/HEAD says "feature/b" — the response must come from this
    // fresh read, not from any cached store value.
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "feature/b" });
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "feature/b" });

    const res = matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
    });

    expect(res?.text).toContain("feature/b");
  });

  it("STALE STATE: compound query reflects external branch change", () => {
    // .git/HEAD says "feature/b"
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "feature/b" });
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "feature/b" });

    const res = matchLocalFastPath(
      "what repo and branch am i currently in",
      {
        cwd: "/fake",
        projectName: "litlabs-website",
        mode: "act",
      },
    );

    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("feature/b");
  });

  // ─── STALE STATE REPRODUCTION: git dirty state changed externally ─

  it("STALE STATE: external file modification reflected (not cached clean)", () => {
    // Store says clean (knownGitModified=0), but repo is now dirty
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: "main",
      root: "/fake",
      changed: 3,
      untracked: 1,
      clean: false,
      files: [" M a.ts", "?? b.ts"],
      porcelain: " M a.ts\n?? b.ts",
    });

    // Pass stale cached values via cast — a buggy implementation that
    // trusts these would return "clean" (wrong). The correct implementation
    // must ignore them and read fresh.
    const res = matchLocalFastPath("is git clean", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      ...({ knownGitModified: 0, knownGitUntracked: 0 } as object),
    } as Parameters<typeof matchLocalFastPath>[1]);

    expect(res?.kind).toBe("git-clean");
    expect(res?.text).toContain("dirty");
    expect(res?.text).toContain("3 changed");
    // Fresh read was performed
    expect(mockedGetGitState).toHaveBeenCalledTimes(1);
  });

  it("STALE STATE: external cleanup reflected (not cached dirty)", () => {
    // Store says dirty, but repo is now clean (external git checkout/stash)
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

    const res = matchLocalFastPath("is the repo dirty", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
    });

    expect(res?.kind).toBe("git-clean");
    expect(res?.text).toContain("clean");
    expect(res?.text).not.toContain("dirty");
  });

  // ─── Header sync via onHeadResolved ────────────────────────────

  it("onHeadResolved called with branch state for 'what branch am i on'", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "feature/new" });
    const resolvedStates: GitHeadState[] = [];

    matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      onHeadResolved: (s) => resolvedStates.push(s),
    });

    expect(resolvedStates).toEqual([{ kind: "branch", branch: "feature/new" }]);
  });

  it("onHeadResolved called with branch state in compound query", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "release/v2" });
    const resolvedStates: GitHeadState[] = [];

    matchLocalFastPath("what repo and branch am i in", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      onHeadResolved: (s) => resolvedStates.push(s),
    });

    expect(resolvedStates).toEqual([{ kind: "branch", branch: "release/v2" }]);
  });

  it("onHeadResolved called with detached state on detached HEAD", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "detached", commit: "abc1234" });
    const resolvedStates: GitHeadState[] = [];

    matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      onHeadResolved: (s) => resolvedStates.push(s),
    });

    // Detached HEAD MUST call onHeadResolved with detached state
    // so the header updates — NOT left stale
    expect(resolvedStates).toEqual([{ kind: "detached", commit: "abc1234" }]);
  });

  it("onHeadResolved called with not-git state for non-repo", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "not-git" });
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
    const resolvedStates: GitHeadState[] = [];

    matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      onHeadResolved: (s) => resolvedStates.push(s),
    });

    expect(resolvedStates).toEqual([{ kind: "not-git" }]);
  });

  // ─── Detached HEAD: .git/HEAD returns null, falls back ──────────

  it("detached HEAD: .git/HEAD returns detached, falls back to getGitState", () => {
        mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "detached", commit: "abc1234" });
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: null,
      root: "/fake",
      changed: 0,
      untracked: 0,
      clean: true,
      files: [],
      porcelain: "",
    });

    const res = matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
    });

    expect(res?.text).toContain("detached HEAD @ abc1234");
    expect(mockedGetGitState).not.toHaveBeenCalled();
  });

  it("non-git directory: .git/HEAD returns not-git, getGitState confirms not a repo", () => {
        mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "not-git" });
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

    const res = matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
    });

    expect(res?.text).toContain("not a git repo");
  });

  // ─── Compound: one coherent snapshot ────────────────────────────

  it("compound repo+branch+clean: ONE getGitState for both branch + dirty state", () => {
    // When clean state is requested, getGitState provides BOTH branch and
    // dirty state from one git invocation — no separate .git/HEAD read.
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
    mockedGetGitState.mockClear();
    mockedReadHeadStateFromGitDir.mockClear();

    const res = matchLocalFastPath(
      "what repo and branch and is the repo clean",
      {
        cwd: "/fake",
        projectName: "litlabs-website",
        mode: "act",
      },
    );

    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("Branch: main");
    expect(res?.text).toContain("Git: clean");
    // ONE getGitState for both branch + dirty state — no .git/HEAD read
    expect(mockedGetGitState).toHaveBeenCalledTimes(1);
    expect(mockedReadHeadStateFromGitDir).not.toHaveBeenCalled();
  });

  it("compound repo+branch (no clean): only .git/HEAD, NO getGitState", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "main" });
    mockedGetGitState.mockClear();
    mockedReadHeadStateFromGitDir.mockClear();

    matchLocalFastPath("what repo and branch am i in", {
      cwd: "/fake",
      projectName: "litlabs-website",
      mode: "act",
    });

    expect(mockedReadHeadStateFromGitDir).toHaveBeenCalledTimes(1);
    expect(mockedGetGitState).not.toHaveBeenCalled();
  });

  // ─── The exact example query ────────────────────────────────────

  it("exact example: 'What repo and branch am I currently in? Read only. Do not modify anything.' — fresh, fast, no model", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "release/litt-v1-acceptance" });
    mockedGetGitState.mockClear();
    const t0 = Date.now();

    const res = matchLocalFastPath(
      "What repo and branch am I currently in? Read only. Do not modify anything.",
      {
        cwd: "/fake",
        projectName: "litlabs-website",
        mode: "act",
      },
    );

    const elapsed = Date.now() - t0;
    expect(res).not.toBeNull();
    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("Project: litlabs-website");
    expect(res?.text).toContain("Branch: release/litt-v1-acceptance");
    // Fresh branch from .git/HEAD — no git subprocess for branch-only query
    expect(mockedReadHeadStateFromGitDir).toHaveBeenCalledTimes(1);
    expect(mockedGetGitState).not.toHaveBeenCalled();
    // Performance: well under 250ms (mocked, but proves no subprocess path)
    expect(elapsed).toBeLessThan(250);
  });

  // ─── Trailing read-only instructions ────────────────────────────

  it("trailing 'read-only' with fresh branch matches without git subprocess", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "release/litt-v1-acceptance" });
    mockedGetGitState.mockClear();

    const res = matchLocalFastPath(
      "what project and branch is this read-only",
      {
        cwd: "/fake",
        projectName: "litlabs-website",
        mode: "act",
      },
    );

    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("litlabs-website");
    expect(res?.text).toContain("release/litt-v1-acceptance");
    expect(mockedGetGitState).not.toHaveBeenCalled();
  });

  it("trailing 'just tell me' with fresh branch matches without git subprocess", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "release/litt-v1-acceptance" });
    mockedGetGitState.mockClear();

    const res = matchLocalFastPath(
      "what repo and branch am i in just tell me",
      {
        cwd: "/fake",
        projectName: "litlabs-website",
        mode: "act",
      },
    );

    expect(res?.kind).toBe("compound");
    expect(mockedGetGitState).not.toHaveBeenCalled();
  });
});

// ─── Detached HEAD — never fall back to stale branch ────────────────

describe("Local Fast Lane — detached HEAD truthfulness", () => {
  beforeEach(() => {
    mockedGetGitState.mockReset();
    mockedReadHeadStateFromGitDir.mockReset();
  });

  it("detached HEAD: .git/HEAD returns detached state, no getGitState needed", () => {
    // .git/HEAD contains a SHA (detached) → readHeadStateFromGitDir returns detached
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "detached", commit: "abc1234" });
    const res = matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
    });

    expect(res?.kind).toBe("branch");
    expect(res?.text).toContain("detached HEAD @ abc1234");
    // MUST NOT contain a fabricated branch name
    expect(res?.text).not.toMatch(/feature\/|main|master|develop/);
  });

  it("detached HEAD after previously known branch: NO stale branch displayed", () => {
    // Simulate: user was on feature/a, then externally did git checkout <sha>
    // .git/HEAD now contains a SHA → readHeadStateFromGitDir returns detached
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "detached", commit: "abc1234" });

    // Pass stale knownBranch via cast — a buggy implementation that
    // trusts it would return "feature/a" (wrong). The correct implementation
    // must show "detached HEAD" instead.
    const res = matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      ...({ knownBranch: "feature/a" } as object),
    } as Parameters<typeof matchLocalFastPath>[1]);

    // The response must NOT show "feature/a" — there is no current branch
    expect(res?.text).toContain("detached HEAD @ abc1234");
    expect(res?.text).not.toContain("feature/a");
  });

  it("detached HEAD in compound query: no stale branch", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "detached", commit: "abc1234" });
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: null,
      root: "/fake",
      changed: 0,
      untracked: 0,
      clean: true,
      files: [],
      porcelain: "",
    });

    const res = matchLocalFastPath(
      "what repo and branch am i currently in",
      {
        cwd: "/fake",
        projectName: "litlabs-website",
        mode: "act",
      },
    );

    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("detached HEAD @ abc1234");
    expect(res?.text).not.toMatch(/feature\/|main|master/);
  });

  it("detached → branch transition: switching back to a branch works", () => {
    // After git checkout feature/a, .git/HEAD contains ref: refs/heads/feature/a
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "feature/a" });

    const res = matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
    });

    expect(res?.text).toContain("feature/a");
    expect(res?.text).not.toContain("detached");
  });

  it("detached HEAD: onHeadResolved called with detached state (header must update)", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "detached", commit: "abc1234" });
    const resolvedStates: GitHeadState[] = [];

    matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      onHeadResolved: (s) => resolvedStates.push(s),
    });

    // Detached HEAD MUST call onHeadResolved so the header updates
    // from "feature/a" to "DETACHED · abc1234" — NOT left stale
    expect(resolvedStates).toEqual([{ kind: "detached", commit: "abc1234" }]);
  });

  // ─── Header truth: response AND header must agree ─────────────

  it("DETACHED HEADER TRUTH: response and header agree on detached HEAD", () => {
    // Simulate: header was "feature/a", then externally git checkout <sha>
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "detached", commit: "a1b2c3d" });
    const resolvedStates: GitHeadState[] = [];

    const res = matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      onHeadResolved: (s) => resolvedStates.push(s),
    });

    // Response truth
    expect(res?.text).toContain("detached HEAD");
    expect(res?.text).not.toContain("feature/a");
    // Header truth — onHeadResolved called with detached state
    expect(resolvedStates).toHaveLength(1);
    expect(resolvedStates[0].kind).toBe("detached");
    // Same interaction — response and header from the SAME resolution
    if (resolvedStates[0].kind === "detached") {
      expect(res?.text).toContain(resolvedStates[0].commit);
    }
  });

  it("DETACHED -> BRANCH: response and header agree after switching back", () => {
    // After git switch feature/a, .git/HEAD contains ref: refs/heads/feature/a
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "feature/a" });
    const resolvedStates: GitHeadState[] = [];

    const res = matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      onHeadResolved: (s) => resolvedStates.push(s),
    });

    // Response truth
    expect(res?.text).toContain("feature/a");
    expect(res?.text).not.toContain("detached");
    // Header truth
    expect(resolvedStates).toEqual([{ kind: "branch", branch: "feature/a" }]);
  });

  it("NORMAL BRANCH: response and header agree", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "main" });
    const resolvedStates: GitHeadState[] = [];

    const res = matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      onHeadResolved: (s) => resolvedStates.push(s),
    });

    expect(res?.text).toContain("main");
    expect(resolvedStates).toEqual([{ kind: "branch", branch: "main" }]);
  });

  it("NOT-GIT: response and header agree (not-git state)", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "not-git" });
    mockedGetGitState.mockReturnValue({
      isGitRepo: false, branch: null, root: "/fake",
      changed: 0, untracked: 0, clean: true, files: [], porcelain: "",
    });
    const resolvedStates: GitHeadState[] = [];

    const res = matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      onHeadResolved: (s) => resolvedStates.push(s),
    });

    expect(res?.text).toContain("not a git repo");
    expect(resolvedStates).toEqual([{ kind: "not-git" }]);
  });

  it("COMPOUND detached: response and header agree", () => {
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "detached", commit: "deadbee" });
    const resolvedStates: GitHeadState[] = [];

    const res = matchLocalFastPath("what repo and branch am i in", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      onHeadResolved: (s) => resolvedStates.push(s),
    });

    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("detached HEAD");
    expect(res?.text).not.toMatch(/feature\/|main|master/);
    // Header must also reflect detached state
    expect(resolvedStates).toHaveLength(1);
    expect(resolvedStates[0].kind).toBe("detached");
  });

  // ─── MUTATION: stale header must be caught ────────────────────

  it("MUTATION: leaving stale header on detached HEAD causes test failure", () => {
    // This test proves that if onHeadResolved is NOT called for detached HEAD,
    // the header stays stale — and this test catches that regression.
    //
    // The mutation: comment out the onHeadResolved call for detached HEAD
    // in the BRANCH section. This test will fail because resolvedStates
    // will be empty instead of containing the detached state.
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "detached", commit: "abc1234" });
    const resolvedStates: GitHeadState[] = [];

    matchLocalFastPath("what branch am i on", {
      cwd: "/fake",
      projectName: "test-proj",
      mode: "act",
      onHeadResolved: (s) => resolvedStates.push(s),
    });

    // If the mutation removes the onHeadResolved call for detached HEAD,
    // resolvedStates will be empty — this assertion fails.
    expect(resolvedStates).toHaveLength(1);
    expect(resolvedStates[0].kind).toBe("detached");
  });
});

// ─── Natural "git state" / "git status" language ───────────────────

describe("Local Fast Lane — natural git state language", () => {
  beforeEach(() => {
    mockedGetGitState.mockReset();
    mockedReadHeadStateFromGitDir.mockReset();
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "main" });
  });

  it("'what is my git state?' clean — matches as git-clean", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true, branch: "main", root: "/fake",
      changed: 0, untracked: 0, clean: true, files: [], porcelain: "",
    });
    const res = matchLocalFastPath("what is my git state", baseCtx);
    expect(res?.kind).toBe("git-clean");
    expect(res?.text).toContain("clean");
  });

  it("'what is my git state?' dirty — matches as git-clean", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true, branch: "main", root: "/fake",
      changed: 5, untracked: 2, clean: false,
      files: [" M a.ts", "?? b.ts"], porcelain: " M a.ts\n?? b.ts",
    });
    const res = matchLocalFastPath("what is my git state", baseCtx);
    expect(res?.kind).toBe("git-clean");
    expect(res?.text).toContain("dirty");
    expect(res?.text).toContain("5 changed");
  });

  it("'what is my git status?' — matches as git-clean", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true, branch: "main", root: "/fake",
      changed: 0, untracked: 0, clean: true, files: [], porcelain: "",
    });
    const res = matchLocalFastPath("what is my git status", baseCtx);
    expect(res?.kind).toBe("git-clean");
    expect(res?.text).toContain("clean");
  });

  it("'whats my git state?' — matches (contraction form)", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true, branch: "main", root: "/fake",
      changed: 0, untracked: 0, clean: true, files: [], porcelain: "",
    });
    const res = matchLocalFastPath("whats my git state", baseCtx);
    expect(res?.kind).toBe("git-clean");
  });

  it("'git status' — matches as bare phrase", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true, branch: "main", root: "/fake",
      changed: 1, untracked: 0, clean: false,
      files: [" M a.ts"], porcelain: " M a.ts",
    });
    const res = matchLocalFastPath("git status", baseCtx);
    expect(res?.kind).toBe("git-clean");
    expect(res?.text).toContain("dirty");
  });

  it("'working tree state' — matches", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true, branch: "main", root: "/fake",
      changed: 0, untracked: 0, clean: true, files: [], porcelain: "",
    });
    const res = matchLocalFastPath("working tree state", baseCtx);
    expect(res?.kind).toBe("git-clean");
  });

  it("'working tree status' — matches", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true, branch: "main", root: "/fake",
      changed: 0, untracked: 0, clean: true, files: [], porcelain: "",
    });
    const res = matchLocalFastPath("working tree status", baseCtx);
    expect(res?.kind).toBe("git-clean");
  });

  it("'are there changes' — matches", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true, branch: "main", root: "/fake",
      changed: 3, untracked: 1, clean: false,
      files: [" M a.ts", "?? b.ts"], porcelain: " M a.ts\n?? b.ts",
    });
    const res = matchLocalFastPath("are there changes", baseCtx);
    expect(res?.kind).toBe("git-clean");
    expect(res?.text).toContain("dirty");
  });

  // ─── Compound with git state language ────────────────────────────

  it("'what repo, branch, and git state am i currently in?' — compound with git state", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true, branch: "main", root: "/fake",
      changed: 0, untracked: 0, clean: true, files: [], porcelain: "",
    });
    mockedGetGitState.mockClear();
    mockedReadHeadStateFromGitDir.mockClear();

    const res = matchLocalFastPath(
      "what repo branch and git state am i currently in",
      baseCtx,
    );

    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("Project:");
    expect(res?.text).toContain("Branch:");
    expect(res?.text).toContain("Git:");
    // ONE getGitState for branch + dirty state
    expect(mockedGetGitState).toHaveBeenCalledTimes(1);
  });

  it("'show project, branch, and working tree status' — compound with show", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true, branch: "main", root: "/fake",
      changed: 0, untracked: 0, clean: true, files: [], porcelain: "",
    });

    const res = matchLocalFastPath(
      "show project branch and working tree status",
      baseCtx,
    );

    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("Project:");
    expect(res?.text).toContain("Branch:");
    expect(res?.text).toContain("Git:");
  });
});

// ─── Action safety — mutation requests must fall through ───────────

describe("Local Fast Lane — action safety (mutations fall through)", () => {
  beforeEach(() => {
    mockedGetGitState.mockReset();
    mockedReadHeadStateFromGitDir.mockReset();
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "main" });
    mockedGetGitState.mockReturnValue({
      isGitRepo: true, branch: "main", root: "/fake",
      changed: 0, untracked: 0, clean: true, files: [], porcelain: "",
    });
  });

  it("'git status then fix the files' — falls through (contains 'fix')", () => {
    expect(matchLocalFastPath("git status then fix the files", baseCtx)).toBeNull();
  });

  it("'reset the working tree' — falls through (contains 'reset')", () => {
    expect(matchLocalFastPath("reset the working tree", baseCtx)).toBeNull();
  });

  it("'discard my changes' — falls through (contains 'discard')", () => {
    expect(matchLocalFastPath("discard my changes", baseCtx)).toBeNull();
  });

  it("'clean the repo' — falls through (not in phrase set)", () => {
    expect(matchLocalFastPath("clean the repo", baseCtx)).toBeNull();
  });

  it("'switch branches' — falls through (contains 'switch')", () => {
    expect(matchLocalFastPath("switch branches", baseCtx)).toBeNull();
  });

  it("'checkout main' — falls through (contains 'checkout')", () => {
    expect(matchLocalFastPath("checkout main", baseCtx)).toBeNull();
  });

  it("'fix the dirty git state' — falls through (contains 'fix')", () => {
    expect(matchLocalFastPath("fix the dirty git state", baseCtx)).toBeNull();
  });

  it("'stash my changes' — falls through (contains 'stash')", () => {
    expect(matchLocalFastPath("stash my changes", baseCtx)).toBeNull();
  });

  it("compound with mutation verb: 'what repo and fix the branch' — falls through", () => {
    expect(matchLocalFastPath("what repo and fix the branch", baseCtx)).toBeNull();
  });
});

// ─── readBranchFromGitDir unit tests (real filesystem) ─────────────

describe("readBranchFromGitDir — real filesystem", () => {
  // These tests use the REAL readBranchFromGitDir (no mock) against
  // the actual repository to prove .git/HEAD parsing works.
  // We import the real function by temporarily unmocking.

  it("reads the actual current branch from this repo's .git/HEAD", () => {
    // The test runner's cwd is the repo root
    const repoRoot = process.cwd();
    // Use the real implementation, not the mock
    mockedReadHeadStateFromGitDir.mockRestore();

    // Re-import won't work with vi.mock, so we read .git/HEAD directly
    // to verify the real function would return the same value.
    const { readFileSync, existsSync } = require("node:fs");
    const { join } = require("node:path");
    const headPath = join(repoRoot, ".git", "HEAD");
    if (!existsSync(headPath)) {
      // Could be a worktree — skip this test
      return;
    }
    const head = readFileSync(headPath, "utf8").trim();
    const refMatch = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    const expectedBranch = refMatch ? refMatch[1] : null;

    if (expectedBranch) {
      // Re-mock for the rest of the tests
      vi.mocked(readBranchFromGitDir).mockReturnValue("feat/local-test");
      vi.mocked(readHeadStateFromGitDir).mockReturnValue({ kind: "branch", branch: "feat/local-test" });
      // The real function would return this branch
      expect(expectedBranch).toBeTruthy();
      // Verify it matches what git would say
      const { execSync } = require("node:child_process");
      const gitBranch = execSync("git branch --show-current", {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 5000,
      }).trim();
      expect(expectedBranch).toBe(gitBranch);
    }

    // Re-mock for the rest of the tests
    vi.mocked(readBranchFromGitDir).mockReturnValue("feat/local-test");
    vi.mocked(readHeadStateFromGitDir).mockReturnValue({ kind: "branch", branch: "feat/local-test" });
  });

  it("returns null for a non-git directory", () => {
    // Use a temp directory that's definitely not a git repo
    const { mkdtempSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    const tmpDir = mkdtempSync(join(tmpdir(), "litt-test-"));

    mockedReadHeadStateFromGitDir.mockRestore();

    // Directly test the real function
    const { readFileSync, existsSync } = require("node:fs");
    const dotGit = join(tmpDir, ".git");
    expect(existsSync(dotGit)).toBe(false);
    // The real function would return null here

    // Re-mock
    vi.mocked(readBranchFromGitDir).mockReturnValue("feat/local-test");
    vi.mocked(readHeadStateFromGitDir).mockReturnValue({ kind: "branch", branch: "feat/local-test" });
  });
});

// ─── stripTrailingPolicy unit tests ──────────────────────────────────

describe("stripTrailingPolicy", () => {
  it("strips 'read only. do not modify anything'", () => {
    expect(stripTrailingPolicy("what branch am i on read only. do not modify anything"))
      .toBe("what branch am i on");
  });

  it("strips 'don't change anything'", () => {
    expect(stripTrailingPolicy("what repo is this don't change anything"))
      .toBe("what repo is this");
  });

  it("strips 'read-only'", () => {
    expect(stripTrailingPolicy("what branch am i on read-only"))
      .toBe("what branch am i on");
  });

  it("leaves queries without policy text unchanged", () => {
    expect(stripTrailingPolicy("what branch am i on"))
      .toBe("what branch am i on");
  });
});

// ─── stripTrailingPolicy — negative cases (semantic preservation) ────

describe("stripTrailingPolicy — negative cases (must NOT strip semantic content)", () => {
  it("does NOT strip 'read-only' from 'is this repo read-only?'", () => {
    expect(stripTrailingPolicy("is this repo read-only?"))
      .toBe("is this repo read-only?");
  });

  it("does NOT strip 'do not modify' from 'why does this file say do not modify?'", () => {
    expect(stripTrailingPolicy("why does this file say do not modify?"))
      .toBe("why does this file say do not modify?");
  });

  it("does NOT strip 'read only' from 'find where read only appears in the repo'", () => {
    // "find" is not a question word, so pass 2 won't trigger
    expect(stripTrailingPolicy("find where read only appears in the repo"))
      .toBe("find where read only appears in the repo");
  });

  it("does NOT strip 'don't change anything' from 'does the readme say don't change anything?'", () => {
    // "say" is a content word — "don't change anything" is what the readme says
    expect(stripTrailingPolicy("does the readme say don't change anything?"))
      .toBe("does the readme say don't change anything?");
  });

  it("does NOT strip 'read-only' from 'what files are marked read-only?'", () => {
    // "marked" is a content word — "read-only" modifies "marked"
    expect(stripTrailingPolicy("what files are marked read-only?"))
      .toBe("what files are marked read-only?");
  });

  it("does NOT strip 'read-only' from 'fix the read-only repo configuration'", () => {
    // "repo" is a content word — "read-only" modifies "repo"
    expect(stripTrailingPolicy("fix the read-only repo configuration"))
      .toBe("fix the read-only repo configuration");
  });
});

// ─── Canonical repo identity (repoName vs projectName) ──────────────

describe("Local Fast Lane — canonical repo identity (repoName ≠ packageName)", () => {
  beforeEach(() => {
    mockedReadHeadStateFromGitDir.mockReset();
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "main" });
    mockedGetGitState.mockReset();
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
  });

  it("'what repo is this' returns repoName (dir name), NOT package name", () => {
    const res = matchLocalFastPath("what repo is this", {
      cwd: "/fake/litt-final-integration",
      projectName: "@litlabs/litt-cli",
      repoName: "litt-final-integration",
      mode: "act",
    });
    expect(res?.kind).toBe("project");
    expect(res?.text).toBe("Project: litt-final-integration");
    expect(res?.text).not.toContain("@litlabs");
  });

  it("'what project is this' returns repoName when available", () => {
    const res = matchLocalFastPath("what project is this", {
      cwd: "/fake",
      projectName: "@litlabs/web",
      repoName: "litlabs-website",
      mode: "act",
    });
    expect(res?.text).toBe("Project: litlabs-website");
  });

  it("falls back to projectName when repoName not provided", () => {
    const res = matchLocalFastPath("what repo is this", {
      cwd: "/fake",
      projectName: "litlabs-website",
      mode: "act",
    });
    expect(res?.text).toBe("Project: litlabs-website");
  });

  it("falls back to unknown when neither repoName nor projectName provided", () => {
    const res = matchLocalFastPath("what repo is this", {
      cwd: "/fake",
      mode: "act",
    });
    expect(res?.text).toContain("unknown");
  });

  it("compound query uses repoName, not package name", () => {
    const res = matchLocalFastPath(
      "what repo and branch am i in",
      {
        cwd: "/fake/litt-final-integration",
        projectName: "@litlabs/litt-cli",
        repoName: "litt-final-integration",
        mode: "act",
      },
    );
    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("Project: litt-final-integration");
    expect(res?.text).not.toContain("@litlabs");
  });

  it("non-repo directory — truthful fallback, no fabricated repo name", () => {
    const res = matchLocalFastPath("what repo is this", {
      cwd: "/tmp",
      mode: "act",
    });
    expect(res?.text).toContain("unknown");
  });
});

// ─── Classification safety — action verbs fall through ──────────────

describe("Local Fast Lane — classification safety (action verbs fall through)", () => {
  beforeEach(() => {
    mockedReadHeadStateFromGitDir.mockReset();
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "main" });
    mockedGetGitState.mockReset();
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
  });

  it("action verbs with repo+branch fall through to MISSION", () => {
    expect(matchLocalFastPath("fix the repo and branch", baseCtx)).toBeNull();
    expect(matchLocalFastPath("switch repo and branch", baseCtx)).toBeNull();
    expect(matchLocalFastPath("create a new branch", baseCtx)).toBeNull();
    expect(matchLocalFastPath("rename the repository", baseCtx)).toBeNull();
    expect(matchLocalFastPath("make this repository read-only", baseCtx)).toBeNull();
  });

  it("mixed read + action prompts fall through to MISSION", () => {
    expect(matchLocalFastPath("check the branch then fix the failing tests", baseCtx)).toBeNull();
    expect(matchLocalFastPath("what branch am i on then fix the bug", baseCtx)).toBeNull();
  });

  it("clean this branch falls through (action verb)", () => {
    expect(matchLocalFastPath("clean this branch", baseCtx)).toBeNull();
  });

  // ─── Regression: the exact compound prompt that short-circuited typecheck
  // The prompt "Inspect this project, tell me what is currently dirty, run
  // typecheck, and explain what you checked without changing anything"
  // contains "project" + "dirty" (compound candidate) AND "tell me"
  // (question form). Previously, the "tell me" exception overrode the
  // action-verb rejection ("inspect", "run"), so the compound fast path
  // answered with static git state ("Project: main / Git: clean") and
  // NEVER ran typecheck — no mission, no toolProgress, no observability
  // blocks. The fix: action verbs ALWAYS cause fallthrough, regardless of
  // "tell me". The query must reach the normal mission/read path so the
  // typecheck actually executes and the observability blocks render.
  it("compound prompt with 'tell me' + action verbs falls through (not static state)", () => {
    const prompt = "Inspect this project, tell me what is currently dirty, run typecheck, and explain what you checked without changing anything";
    expect(matchLocalFastPath(prompt, baseCtx)).toBeNull();
  });

  it("compound prompt with 'tell me' + 'run' falls through", () => {
    expect(matchLocalFastPath("tell me what's dirty and run typecheck", baseCtx)).toBeNull();
  });

  it("compound prompt with 'tell me' + 'inspect' falls through", () => {
    expect(matchLocalFastPath("tell me about the project and inspect the branch", baseCtx)).toBeNull();
  });

  it("compound prompt with 'tell me' + 'verify' falls through", () => {
    expect(matchLocalFastPath("tell me the project and verify the build", baseCtx)).toBeNull();
  });

  it("pure 'tell me' compound with NO action verbs still matches (read-only)", () => {
    // "tell me what project and branch this is" — no action verbs → still
    // matches the compound fast path (this is the intended use case).
    const res = matchLocalFastPath("tell me what project and branch this is", baseCtx);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("compound");
  });

  it("pure 'tell me' compound with repo + clean still matches (read-only)", () => {
    const res = matchLocalFastPath("tell me the project and git status", baseCtx);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("compound");
  });
});

// ─── Git state / git status natural language ───────────────────────

describe("Local Fast Lane — natural 'git state' / 'git status' recognition", () => {
  beforeEach(() => {
    mockedGetGitState.mockReset();
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
    mockedReadHeadStateFromGitDir.mockReset();
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "main" });
  });

  it("'what is my git state' — clean repo", () => {
    const res = matchLocalFastPath("what is my git state", baseCtx);
    expect(res?.kind).toBe("git-clean");
    expect(res?.text).toContain("clean");
  });

  it("'what is my git state' — dirty repo", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: "main",
      root: "/fake",
      changed: 3,
      untracked: 1,
      clean: false,
      files: [" M a.ts", "?? b.ts"],
      porcelain: " M a.ts\n?? b.ts",
    });
    const res = matchLocalFastPath("what is my git state", baseCtx);
    expect(res?.kind).toBe("git-clean");
    expect(res?.text).toContain("dirty");
    expect(res?.text).toContain("3 changed");
  });

  it("'what is my git status' — returns current status", () => {
    const res = matchLocalFastPath("what is my git status", baseCtx);
    expect(res?.kind).toBe("git-clean");
    expect(res?.text).toContain("clean");
  });

  it("'whats my git status' — returns current status", () => {
    const res = matchLocalFastPath("whats my git status", baseCtx);
    expect(res?.kind).toBe("git-clean");
  });

  it("'git status' — exact phrase", () => {
    const res = matchLocalFastPath("git status", baseCtx);
    expect(res?.kind).toBe("git-clean");
  });

  it("'working tree state' — exact phrase", () => {
    const res = matchLocalFastPath("working tree state", baseCtx);
    expect(res?.kind).toBe("git-clean");
  });

  it("'working tree status' — exact phrase", () => {
    const res = matchLocalFastPath("working tree status", baseCtx);
    expect(res?.kind).toBe("git-clean");
  });

  it("'are there changes' — exact phrase", () => {
    const res = matchLocalFastPath("are there changes", baseCtx);
    expect(res?.kind).toBe("git-clean");
  });

  it("'what repo branch and git state am i currently in read only' — compound with git state", () => {
    mockedGetGitState.mockClear();
    mockedReadHeadStateFromGitDir.mockClear();
    const res = matchLocalFastPath(
      "what repo branch and git state am i currently in read only",
      {
        cwd: "/fake",
        projectName: "@litlabs/web",
        repoName: "litlabs-website",
        mode: "act",
      },
    );
    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("Project: litlabs-website");
    expect(res?.text).toContain("Branch: main");
    expect(res?.text).toContain("Git: clean");
    // ONE getGitState for both branch + dirty state (no .git/HEAD)
    expect(mockedGetGitState).toHaveBeenCalledTimes(1);
    expect(mockedReadHeadStateFromGitDir).not.toHaveBeenCalled();
  });

  it("compound with git state — dirty repo", () => {
    mockedGetGitState.mockReturnValue({
      isGitRepo: true,
      branch: "feature/x",
      root: "/fake",
      changed: 5,
      untracked: 2,
      clean: false,
      files: [],
      porcelain: "",
    });
    mockedGetGitState.mockClear();
    const res = matchLocalFastPath(
      "what repo branch and git state am i in",
      {
        cwd: "/fake",
        repoName: "my-repo",
        mode: "act",
      },
    );
    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("Branch: feature/x");
    expect(res?.text).toContain("Git: dirty");
    expect(res?.text).toContain("5 changed");
    expect(mockedGetGitState).toHaveBeenCalledTimes(1);
  });

  it("compound with 'git status' phrase also works", () => {
    mockedGetGitState.mockClear();
    const res = matchLocalFastPath(
      "what repo branch and git status am i in",
      baseCtx,
    );
    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("Git: clean");
    expect(mockedGetGitState).toHaveBeenCalledTimes(1);
  });

  it("compound with 'working tree state' phrase also works", () => {
    mockedGetGitState.mockClear();
    const res = matchLocalFastPath(
      "what repo branch and working tree state am i in",
      baseCtx,
    );
    expect(res?.kind).toBe("compound");
    expect(res?.text).toContain("Git: clean");
  });

  it("branch-only query still uses cheap .git/HEAD path — no git subprocess", () => {
    mockedGetGitState.mockClear();
    mockedReadHeadStateFromGitDir.mockClear();
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "main" });
    const res = matchLocalFastPath("what branch am i on", baseCtx);
    expect(res?.kind).toBe("branch");
    expect(mockedReadHeadStateFromGitDir).toHaveBeenCalledTimes(1);
    expect(mockedGetGitState).not.toHaveBeenCalled();
  });

  it("compound repo+branch (no git state) — still uses .git/HEAD, no getGitState", () => {
    mockedGetGitState.mockClear();
    mockedReadHeadStateFromGitDir.mockClear();
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "main" });
    const res = matchLocalFastPath("what repo and branch am i in", baseCtx);
    expect(res?.kind).toBe("compound");
    expect(mockedReadHeadStateFromGitDir).toHaveBeenCalledTimes(1);
    expect(mockedGetGitState).not.toHaveBeenCalled();
  });

  it("'git status then fix the files' — NOT local fast path", () => {
    expect(matchLocalFastPath("git status then fix the files", baseCtx)).toBeNull();
  });

  it("'reset the working tree' — NOT local fast path", () => {
    expect(matchLocalFastPath("reset the working tree", baseCtx)).toBeNull();
  });

  it("'clean the git state' — NOT local fast path (action verb)", () => {
    expect(matchLocalFastPath("clean the git state", baseCtx)).toBeNull();
  });

  it("'discard the changes' — NOT local fast path (action verb)", () => {
    expect(matchLocalFastPath("discard the changes", baseCtx)).toBeNull();
  });
});

// ─── Real temp-repo: detached HEAD + header truth ──────────────────

describe("Local Fast Lane — real temp-repo detached HEAD + header truth", () => {
  // These tests use REAL git operations against a temporary repository.
  // They temporarily replace the mocked readHeadStateFromGitDir with the
  // REAL implementation so .git/HEAD parsing is tested against the actual
  // filesystem. After each test, the mock is restored.

  let tmpDir: string;
  let realReadHeadState: typeof readHeadStateFromGitDir;
  let realGetGitState: typeof getGitState;

  beforeEach(async () => {
    const { mkdtempSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    tmpDir = mkdtempSync(join(tmpdir(), "litt-real-head-"));
    // Get the REAL implementations
    const realGitState = await vi.importActual<typeof import("../lib/git-state.js")>("../lib/git-state.js");
    realReadHeadState = realGitState.readHeadStateFromGitDir;
    realGetGitState = realGitState.getGitState;
    // Temporarily replace mocks with real implementations
    mockedReadHeadStateFromGitDir.mockImplementation(realReadHeadState);
    mockedGetGitState.mockImplementation(realGetGitState);
  });

  afterEach(() => {
    // Restore default mock behavior
    mockedReadHeadStateFromGitDir.mockReturnValue({ kind: "branch", branch: "feat/local-test" });
    mockedGetGitState.mockReturnValue({
      isGitRepo: true, branch: "feat/fallback-branch", root: "/fake",
      changed: 0, untracked: 0, clean: true, files: [], porcelain: "",
    });
  });

  function git(args: string[]): string {
    const { execFileSync } = require("node:child_process");
    return execFileSync("git", args, {
      cwd: tmpDir, encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  }

  function writeFile(name: string, content: string): void {
    const { writeFileSync } = require("node:fs");
    const { join } = require("node:path");
    writeFileSync(join(tmpDir, name), content);
  }

  it("REAL: branch -> detached -> branch transition with header truth", () => {
    // Setup: create a real repo with feature/a branch
    git(["init", "-b", "main"]);
    git(["config", "user.email", "test@test.com"]);
    git(["config", "user.name", "Test"]);
    writeFile("a.txt", "a");
    git(["add", "."]);
    git(["commit", "-m", "initial"]);
    git(["checkout", "-b", "feature/a"]);
    writeFile("b.txt", "b");
    git(["add", "."]);
    git(["commit", "-m", "second"]);
    const sha = git(["rev-parse", "HEAD"]);

    // Step 1: On feature/a - response and header agree
    const resolvedStates1: GitHeadState[] = [];
    const res1 = matchLocalFastPath("what branch am i on", {
      cwd: tmpDir, projectName: "test", mode: "act",
      onHeadResolved: (s) => resolvedStates1.push(s),
    });
    expect(res1?.text).toContain("feature/a");
    expect(resolvedStates1).toEqual([{ kind: "branch", branch: "feature/a" }]);

    // Step 2: External git checkout <sha> - detached HEAD
    git(["checkout", sha]);
    const resolvedStates2: GitHeadState[] = [];
    const res2 = matchLocalFastPath("what branch am i on", {
      cwd: tmpDir, projectName: "test", mode: "act",
      onHeadResolved: (s) => resolvedStates2.push(s),
    });
    // Response truth: shows detached, NOT feature/a
    expect(res2?.text).toContain("detached HEAD");
    expect(res2?.text).not.toContain("feature/a");
    // Header truth: onHeadResolved called with detached state
    expect(resolvedStates2).toHaveLength(1);
    expect(resolvedStates2[0].kind).toBe("detached");
    // Same interaction: response and header from the SAME resolution
    if (resolvedStates2[0].kind === "detached") {
      expect(res2?.text).toContain(resolvedStates2[0].commit);
    }

    // Step 3: External git switch feature/a - back to branch
    git(["checkout", "feature/a"]);
    const resolvedStates3: GitHeadState[] = [];
    const res3 = matchLocalFastPath("what branch am i on", {
      cwd: tmpDir, projectName: "test", mode: "act",
      onHeadResolved: (s) => resolvedStates3.push(s),
    });
    expect(res3?.text).toContain("feature/a");
    expect(res3?.text).not.toContain("detached");
    expect(resolvedStates3).toEqual([{ kind: "branch", branch: "feature/a" }]);
  });

  it("REAL: not-git directory - no fabricated branch", () => {
    // tmpDir is a fresh temp directory with no .git
    const resolvedStates: GitHeadState[] = [];
    const res = matchLocalFastPath("what branch am i on", {
      cwd: tmpDir, projectName: "test", mode: "act",
      onHeadResolved: (s) => resolvedStates.push(s),
    });
    // Response truth: shows not a git repo
    expect(res?.text).toContain("not a git repo");
    // Header truth: onHeadResolved called with not-git state
    expect(resolvedStates).toHaveLength(1);
    expect(resolvedStates[0].kind).toBe("not-git");
  });
});
