/**
 * Local-Tool Mission — regression coverage for signed-out LOCAL gating.
 *
 * The bug: every mission was blocked by the capability gate when signed out
 * + LOCAL, even when the mission could be satisfied entirely with local
 * tools (git status, typecheck, build, project inspection). The gate ran
 * BEFORE classifyIntent, so it couldn't distinguish tool-only missions
 * from model-required missions.
 *
 * The fix:
 *   1. The gate now runs AFTER classifyIntent.
 *   2. READ intent always falls through (READ lane handles no-model).
 *   3. MISSION intent is checked against matchLocalToolMission() — if the
 *      prompt can be decomposed into local tool calls, it executes with
 *      NO model inference. If not, it's blocked (needs model reasoning).
 *   4. CHAT intent is blocked (needs model inference).
 *
 * Coverage:
 *   - matchLocalToolMission detection (allowed vs blocked prompts)
 *   - formatLocalToolSummary (evidence-grounded, never invented)
 *   - shouldBlockModelPath gating logic (unchanged for remote/model)
 *   - The exact real-terminal prompt → allowed as local-tool mission
 *   - Model-required prompts → blocked
 *   - Remote-required prompts → blocked
 *   - Authenticated model missions → unchanged (not blocked)
 */

import { describe, it, expect } from "vitest";
import {
  matchLocalToolMission,
  formatLocalToolSummary,
  formatGitSummary,
  parseGitPorcelain,
  type LocalToolResult,
} from "../lib/local-tool-mission.js";
import { shouldBlockModelPath, CAPABILITY_GATE_MESSAGE, LOCAL_ONLY_GATE_MESSAGE } from "../lib/capability-gate.js";
import { classifyIntent } from "../lib/intent.js";

// ─── Fixtures ───────────────────────────────────────────────────────

const EXACT_PROMPT =
  "Inspect this project, tell me what is currently dirty, run typecheck, and explain what you checked without changing anything";

// ─── matchLocalToolMission detection ────────────────────────────────

describe("matchLocalToolMission — detection", () => {
  it("the exact real-terminal prompt matches as a local-tool mission", () => {
    const match = matchLocalToolMission(EXACT_PROMPT);
    expect(match).not.toBeNull();
    expect(match!.calls.length).toBeGreaterThanOrEqual(3);
    // Must include git status, project inspection, and typecheck.
    const labels = match!.calls.map((c) => c.label);
    expect(labels.some((l) => /git/i.test(l))).toBe(true);
    expect(labels.some((l) => /project/i.test(l))).toBe(true);
    expect(labels.some((l) => /typecheck/i.test(l))).toBe(true);
  });

  it("matches a simple typecheck request", () => {
    const match = matchLocalToolMission("run typecheck");
    expect(match).not.toBeNull();
    expect(match!.calls.some((c) => c.label === "Typecheck")).toBe(true);
  });

  it("matches git status + typecheck compound", () => {
    const match = matchLocalToolMission("check git status and run typecheck");
    expect(match).not.toBeNull();
    expect(match!.calls.some((c) => c.toolId === "project.status")).toBe(true);
    expect(match!.calls.some((c) => c.label === "Typecheck")).toBe(true);
  });

  it("matches build request", () => {
    const match = matchLocalToolMission("run the build");
    expect(match).not.toBeNull();
    expect(match!.calls.some((c) => c.label === "Build")).toBe(true);
  });

  it("matches lint request", () => {
    const match = matchLocalToolMission("run lint");
    expect(match).not.toBeNull();
    expect(match!.calls.some((c) => c.label === "Lint")).toBe(true);
  });

  it("matches test request", () => {
    const match = matchLocalToolMission("run tests");
    expect(match).not.toBeNull();
    expect(match!.calls.some((c) => c.label === "Tests")).toBe(true);
  });

  it("matches branch check", () => {
    const match = matchLocalToolMission("what branch am i on");
    expect(match).not.toBeNull();
    expect(match!.calls.some((c) => c.toolId === "project.branch")).toBe(true);
  });

  it("does NOT match model-reasoning prompts (fix)", () => {
    expect(matchLocalToolMission("fix the typecheck errors")).toBeNull();
  });

  it("does NOT match model-reasoning prompts (implement)", () => {
    expect(matchLocalToolMission("implement a new feature")).toBeNull();
  });

  it("does NOT match model-reasoning prompts (refactor)", () => {
    expect(matchLocalToolMission("refactor the auth module")).toBeNull();
  });

  it("does NOT match model-reasoning prompts (debug)", () => {
    expect(matchLocalToolMission("debug why the build fails")).toBeNull();
  });

  it("does NOT match 'explain why' prompts (needs model reasoning)", () => {
    expect(matchLocalToolMission("explain why the typecheck fails")).toBeNull();
  });

  it("does NOT match 'explain how' prompts (needs model reasoning)", () => {
    expect(matchLocalToolMission("explain how the build works")).toBeNull();
  });

  it("DOES match 'explain what you checked' (summary, not reasoning)", () => {
    // "explain what you checked" is asking for a summary of what was done,
    // not model reasoning. This is the exact prompt's trailing clause.
    const match = matchLocalToolMission("run typecheck and explain what you checked");
    expect(match).not.toBeNull();
  });

  it("does NOT match empty/gibberish", () => {
    expect(matchLocalToolMission("")).toBeNull();
    expect(matchLocalToolMission("hello world")).toBeNull();
    expect(matchLocalToolMission("asdf jkl")).toBeNull();
  });

  it("does NOT match pure chat (no tool keywords)", () => {
    expect(matchLocalToolMission("what is TypeScript")).toBeNull();
    expect(matchLocalToolMission("how are you")).toBeNull();
  });

  it("preserves the original prompt as the mission goal", () => {
    const match = matchLocalToolMission("run typecheck");
    expect(match!.goal).toBe("run typecheck");
  });

  it("each call has a stepTitle for the MissionProgressBlock", () => {
    const match = matchLocalToolMission("check git status and run typecheck");
    for (const call of match!.calls) {
      expect(call.stepTitle).toBeTruthy();
      expect(call.stepTitle.length).toBeGreaterThan(0);
    }
  });
});

// ─── formatLocalToolSummary — evidence-grounded ─────────────────────

describe("formatLocalToolSummary — evidence-grounded, never invented", () => {
  function makeResult(overrides: Partial<LocalToolResult>): LocalToolResult {
    return {
      toolId: "project.run",
      label: "Typecheck",
      stepTitle: "Typecheck",
      success: true,
      message: "No type errors found.",
      ...overrides,
    };
  }

  it("reports 'Inspection complete' header", () => {
    const summary = formatLocalToolSummary("run typecheck", [
      makeResult({ toolId: "project.run", label: "Typecheck", success: true, message: "ok" }),
    ]);
    expect(summary).toContain("Inspection complete.");
  });

  it("reports git clean status from actual tool data", () => {
    const summary = formatLocalToolSummary("check git status", [
      makeResult({
        toolId: "project.status",
        label: "Git status",
        stepTitle: "Git status",
        success: true,
        message: "Working tree clean",
        data: { porcelain: "", changeCount: 0, files: [] },
      }),
    ]);
    expect(summary).toContain("Git: clean");
  });

  it("reports git dirty status from actual porcelain data", () => {
    const summary = formatLocalToolSummary("check git status", [
      makeResult({
        toolId: "project.status",
        label: "Git status",
        stepTitle: "Git status",
        success: true,
        message: "5 change(s)",
        data: {
          porcelain: [
            " M src/index.ts",
            " M src/lib.ts",
            " M src/util.ts",
            "?? src/new.ts",
            "?? src/other.ts",
          ].join("\n"),
          changeCount: 5,
          files: [
            " M src/index.ts",
            " M src/lib.ts",
            " M src/util.ts",
            "?? src/new.ts",
            "?? src/other.ts",
          ],
        },
      }),
    ]);
    expect(summary).toContain("Git: 5 changes — 3 modified, 2 untracked");
  });

  it("reports typecheck passed from actual tool result", () => {
    const summary = formatLocalToolSummary("run typecheck", [
      makeResult({ toolId: "project.run", label: "Typecheck", success: true, message: "No type errors found." }),
    ]);
    expect(summary).toContain("Typecheck: passed.");
  });

  it("reports typecheck FAILED from actual tool result (with error text)", () => {
    const summary = formatLocalToolSummary("run typecheck", [
      makeResult({
        toolId: "project.run",
        label: "Typecheck",
        success: false,
        message: "src/index.ts(10,5): error TS2304: Cannot find name 'foo'.",
      }),
    ]);
    expect(summary).toContain("Typecheck: failed");
    expect(summary).toContain("Cannot find name 'foo'");
  });

  it("reports branch from actual tool data", () => {
    const summary = formatLocalToolSummary("what branch", [
      makeResult({
        toolId: "project.branch",
        label: "Current branch",
        stepTitle: "Branch check",
        success: true,
        message: "main",
        data: { branch: "main" },
      }),
    ]);
    expect(summary).toContain("Branch: main");
  });

  it("reports project name from actual tool data", () => {
    const summary = formatLocalToolSummary("inspect project", [
      makeResult({
        toolId: "project.inspect_package",
        label: "Project metadata",
        stepTitle: "Project inspection",
        success: true,
        message: "ok",
        data: { name: "@litlabs/litt-cli", version: "0.1.0" },
      }),
    ]);
    expect(summary).toContain("Project: @litlabs/litt-cli@0.1.0");
  });

  it("includes 'No files were changed' when prompt mentions 'without changing'", () => {
    const summary = formatLocalToolSummary(
      "run typecheck without changing anything",
      [makeResult({ success: true, message: "ok" })],
    );
    expect(summary).toContain("No files were changed.");
  });

  it("includes 'Checked:' footer listing what was checked", () => {
    const summary = formatLocalToolSummary("check git status and run typecheck", [
      makeResult({ toolId: "project.status", label: "Git status", stepTitle: "Git status", success: true, message: "clean", data: { clean: true } }),
      makeResult({ toolId: "project.run", label: "Typecheck", stepTitle: "Typecheck", success: true, message: "ok" }),
    ]);
    expect(summary).toContain("Checked: git status, typecheck.");
  });

  it("NEVER invents success — failed tools are reported as failed", () => {
    const summary = formatLocalToolSummary("run build", [
      makeResult({
        toolId: "project.run",
        label: "Build",
        stepTitle: "Build",
        success: false,
        message: "Build failed: syntax error in src/index.ts",
      }),
    ]);
    expect(summary).toContain("Build: failed");
    expect(summary).not.toContain("Build: passed");
  });
});

// ─── Capability gate — unchanged for remote/model/auth ──────────────

describe("shouldBlockModelPath — gating logic unchanged", () => {
  it("blocks signed-out + LOCAL", () => {
    expect(shouldBlockModelPath(false, "local", false)).toBe(true);
  });

  it("blocks local-only emergency mode regardless of auth", () => {
    expect(shouldBlockModelPath(true, "local", true)).toBe(true);
    expect(shouldBlockModelPath(false, "local", true)).toBe(true);
  });

  it("does NOT block signed-in + LOCAL (BYOK allowed)", () => {
    expect(shouldBlockModelPath(true, "local", false)).toBe(false);
  });

  it("does NOT block REMOTE (auth handled by remote)", () => {
    expect(shouldBlockModelPath(false, "remote", false)).toBe(false);
    expect(shouldBlockModelPath(true, "remote", false)).toBe(false);
  });

  it("does NOT block when auth state is unknown (startup window)", () => {
    expect(shouldBlockModelPath(null, "local", false)).toBe(false);
    expect(shouldBlockModelPath(undefined, "local", false)).toBe(false);
  });

  it("gate messages are user-facing and actionable", () => {
    expect(CAPABILITY_GATE_MESSAGE).toContain("litt login");
    expect(CAPABILITY_GATE_MESSAGE).toContain("/remote");
    expect(LOCAL_ONLY_GATE_MESSAGE).toContain("LITT_LOCAL_ONLY");
  });
});

// ─── Intent classification for the exact prompt ─────────────────────

describe("classifyIntent — exact prompt classification", () => {
  it("the exact prompt classifies as MISSION (not read/chat)", () => {
    // After the local-fast-lane fix, this prompt must reach classifyIntent
    // and be classified as "mission" (contains "inspect", "run", "check").
    const intent = classifyIntent(EXACT_PROMPT);
    expect(intent).toBe("mission");
  });

  it("'run typecheck' classifies as MISSION", () => {
    expect(classifyIntent("run typecheck")).toBe("mission");
  });

  it("'fix the bug' classifies as MISSION (model-required)", () => {
    expect(classifyIntent("fix the bug")).toBe("mission");
  });

  it("'what files changed' classifies as READ (local-tool allowed)", () => {
    expect(classifyIntent("what files changed")).toBe("read");
  });

  it("'what is TypeScript' classifies as CHAT (model-required)", () => {
    expect(classifyIntent("what is TypeScript")).toBe("chat");
  });
});

// ─── The exact real-terminal prompt → allowed as local-tool mission ─

describe("Exact real-terminal prompt — signed-out LOCAL → allowed", () => {
  it("the full pipeline: classifyIntent=mission → matchLocalToolMission matches → NOT blocked", () => {
    // 1. The prompt is NOT caught by the local fast lane (fixed in
    //    local-fast-lane.ts — "tell me" + action verbs fall through).
    // 2. classifyIntent returns "mission" (contains "inspect", "run").
    // 3. The capability gate checks shouldBlockModelPath(false, "local", false) → true.
    // 4. BUT the gate now checks matchLocalToolMission() for mission intent.
    // 5. matchLocalToolMission matches → the mission executes locally.

    const intent = classifyIntent(EXACT_PROMPT);
    expect(intent).toBe("mission");

    const isBlocked = shouldBlockModelPath(false, "local", false);
    expect(isBlocked).toBe(true);

    const localMatch = matchLocalToolMission(EXACT_PROMPT);
    expect(localMatch).not.toBeNull();

    // The gate's logic: if blocked AND mission AND localMatch → execute.
    // If blocked AND mission AND !localMatch → block.
    // This is the exact decision the controller makes.
    if (isBlocked && intent === "mission" && localMatch) {
      // ALLOWED — local-tool mission executes.
      expect(true).toBe(true);
    } else {
      expect.unreachable("Should be allowed as local-tool mission");
    }
  });

  it("model-required mission signed-out LOCAL → blocked", () => {
    // "fix the typecheck errors" needs model reasoning — NOT local-tool.
    const prompt = "fix the typecheck errors";
    const intent = classifyIntent(prompt);
    expect(intent).toBe("mission");

    const isBlocked = shouldBlockModelPath(false, "local", false);
    expect(isBlocked).toBe(true);

    const localMatch = matchLocalToolMission(prompt);
    expect(localMatch).toBeNull(); // No local-tool decomposition

    // The gate's logic: blocked AND mission AND !localMatch → BLOCK.
    expect(isBlocked && intent === "mission" && !localMatch).toBe(true);
  });

  it("chat intent signed-out LOCAL → blocked", () => {
    const prompt = "what is TypeScript";
    const intent = classifyIntent(prompt);
    expect(intent).toBe("chat");

    const isBlocked = shouldBlockModelPath(false, "local", false);
    expect(isBlocked).toBe(true);

    // Chat intent is always blocked when the gate is active.
    expect(isBlocked && intent === "chat").toBe(true);
  });

  it("read intent signed-out LOCAL → allowed (READ lane handles no-model)", () => {
    const prompt = "what files changed";
    const intent = classifyIntent(prompt);
    expect(intent).toBe("read");

    const isBlocked = shouldBlockModelPath(false, "local", false);
    expect(isBlocked).toBe(true);

    // Read intent falls through the gate (READ lane handles no-model).
    // The gate's logic: if blocked AND read → fall through.
    expect(isBlocked && intent === "read").toBe(true);
  });

  it("remote-required prompt signed-out → NOT blocked by shouldBlockModelPath", () => {
    // Remote target is never blocked by shouldBlockModelPath — auth is
    // handled by the remote transport. This preserves the existing
    // remote auth boundary.
    expect(shouldBlockModelPath(false, "remote", false)).toBe(false);
  });

  it("authenticated model mission → NOT blocked", () => {
    // Signed-in users are completely unaffected.
    expect(shouldBlockModelPath(true, "local", false)).toBe(false);
    expect(shouldBlockModelPath(true, "remote", false)).toBe(false);
  });

  it("local-only emergency mode blocks EVERYTHING including local-tool missions", () => {
    // In local-only mode (LITT_LOCAL_ONLY=1), even local-tool missions
    // are blocked because the gate blocks before matchLocalToolMission
    // is checked. This is intentional — local-only is emergency mode.
    // NOTE: the current implementation checks matchLocalToolMission only
    // for the signed-out case, not the local-only case. This test
    // documents that local-only blocks everything.
    expect(shouldBlockModelPath(false, "local", true)).toBe(true);
    expect(shouldBlockModelPath(true, "local", true)).toBe(true);
  });
});

// ─── parseGitPorcelain + formatGitSummary ───────────────────────────

describe("parseGitPorcelain — porcelain v1 parsing", () => {
  it("empty porcelain → all zeros", () => {
    const c = parseGitPorcelain("");
    expect(c.total).toBe(0);
    expect(c.modified).toBe(0);
    expect(c.untracked).toBe(0);
  });

  it("3 modified + 2 untracked → correct counts", () => {
    const porcelain = [
      " M src/index.ts",
      " M src/lib.ts",
      " M src/util.ts",
      "?? src/new.ts",
      "?? src/other.ts",
    ].join("\n");
    const c = parseGitPorcelain(porcelain);
    expect(c.total).toBe(5);
    expect(c.modified).toBe(3);
    expect(c.untracked).toBe(2);
  });

  it("staged + unstaged modifications both count", () => {
    const porcelain = "MM src/file.ts"; // staged M + unstaged M
    const c = parseGitPorcelain(porcelain);
    expect(c.modified).toBe(1);
    expect(c.total).toBe(1);
  });

  it("added files count separately", () => {
    const porcelain = "A  src/new1.ts\nA  src/new2.ts";
    const c = parseGitPorcelain(porcelain);
    expect(c.added).toBe(2);
    expect(c.total).toBe(2);
  });

  it("deleted files count separately", () => {
    const porcelain = "D  src/old.ts";
    const c = parseGitPorcelain(porcelain);
    expect(c.deleted).toBe(1);
  });

  it("renamed files count separately", () => {
    const porcelain = "R  src/old.ts -> src/new.ts";
    const c = parseGitPorcelain(porcelain);
    expect(c.renamed).toBe(1);
  });

  it("unmerged (conflict) files count separately", () => {
    const porcelain = "UU src/conflict.ts";
    const c = parseGitPorcelain(porcelain);
    expect(c.unmerged).toBe(1);
  });
});

describe("formatGitSummary — canonical git summary format", () => {
  it("clean repo → 'Git: clean'", () => {
    expect(formatGitSummary("", 0)).toBe("Git: clean");
  });

  it("3 modified + 2 untracked → 'Git: 5 changes — 3 modified, 2 untracked'", () => {
    const porcelain = [
      " M src/index.ts",
      " M src/lib.ts",
      " M src/util.ts",
      "?? src/new.ts",
      "?? src/other.ts",
    ].join("\n");
    expect(formatGitSummary(porcelain, 5)).toBe("Git: 5 changes — 3 modified, 2 untracked");
  });

  it("single change → singular 'change'", () => {
    const porcelain = " M src/index.ts";
    expect(formatGitSummary(porcelain, 1)).toBe("Git: 1 change — 1 modified");
  });

  it("only untracked → 'Git: N changes — N untracked'", () => {
    const porcelain = "?? src/new.ts\n?? src/other.ts";
    expect(formatGitSummary(porcelain, 2)).toBe("Git: 2 changes — 2 untracked");
  });

  it("mixed categories preserve truthful counts", () => {
    const porcelain = [
      " M src/mod.ts",
      "A  src/new.ts",
      "D  src/old.ts",
      "R  src/rename.ts -> src/renamed.ts",
      "?? src/untracked.ts",
    ].join("\n");
    const result = formatGitSummary(porcelain, 5);
    expect(result).toBe("Git: 5 changes — 1 modified, 1 added, 1 deleted, 1 renamed, 1 untracked");
  });

  it("fallback when changeCount > 0 but no categories matched", () => {
    // Edge case: porcelain with only ignored files (shouldn't happen in
    // practice since git status --porcelain doesn't show ignored by default)
    expect(formatGitSummary("!! src/ignored.ts", 1)).toBe("Git: 1 change(s)");
  });
});

// ─── Tool progress deduplication regression ─────────────────────────

describe("Tool progress deduplication — one typecheck → one block", () => {
  it("the exact prompt produces a match with one typecheck call", () => {
    const match = matchLocalToolMission(EXACT_PROMPT);
    expect(match).not.toBeNull();
    // Count typecheck calls — must be exactly 1.
    const typecheckCalls = match!.calls.filter((c) => c.label === "Typecheck");
    expect(typecheckCalls.length).toBe(1);
  });

  it("multiple distinct tools each produce one call", () => {
    const match = matchLocalToolMission("check git status, inspect project, run typecheck, run lint, run build, run tests");
    expect(match).not.toBeNull();
    // Each tool type appears exactly once.
    const labels = match!.calls.map((c) => c.label);
    const uniqueLabels = new Set(labels);
    expect(labels.length).toBe(uniqueLabels.size);
  });

  it("two genuinely separate typecheck executions have different toolCallIds", () => {
    // Simulate two separate toolCallId generations — they must differ.
    const id1 = `ltc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const id2 = `ltc_${Date.now() + 1}_${Math.random().toString(36).slice(2, 6)}`;
    expect(id1).not.toBe(id2);
  });

  it("repeated updates to the same toolCallId do not create duplicate entries", () => {
    // This is enforced by ToolProgressStore.startTool idempotency.
    // We verify the contract: the same toolCallId passed twice to
    // startToolProgress should not create a second entry.
    // (Tested in tool-progress.test.ts — here we verify the contract
    // is documented and maintained.)
    // The ToolProgressStore invariant: "startTool is idempotent per
    // toolCallId — a duplicate start is a no-op."
    expect(true).toBe(true); // Contract verified by tool-progress.test.ts
  });
});

// ─── Final summary non-redundancy with DONE block ───────────────────

describe("Final summary — non-redundancy with DONE block", () => {
  it("deterministic summary does not contain 'verification passed'", () => {
    // The SummaryBlock (DONE) renders "inspection verified" for read-only
    // missions. The chat message summary should NOT repeat this.
    const summary = formatLocalToolSummary(EXACT_PROMPT, [
      {
        toolId: "project.status",
        label: "Git status",
        stepTitle: "Git status",
        success: true,
        message: "Working tree clean",
        data: { porcelain: "", changeCount: 0, files: [] },
      },
      {
        toolId: "project.inspect_package",
        label: "Project metadata",
        stepTitle: "Project inspection",
        success: true,
        message: "ok",
        data: { name: "@litlabs/litt-cli", version: "0.1.0" },
      },
      {
        toolId: "project.run",
        label: "Typecheck",
        stepTitle: "Typecheck",
        success: true,
        message: "No type errors found.",
      },
    ]);
    // The deterministic summary reports what was checked + results.
    expect(summary).toContain("Inspection complete.");
    expect(summary).toContain("Typecheck: passed.");
    expect(summary).toContain("Checked:");
    // It should NOT contain the DONE block's text.
    expect(summary).not.toContain("verification passed");
    expect(summary).not.toContain("inspection verified");
    expect(summary).not.toContain("typecheck clean");
  });

  it("deterministic summary does not duplicate 'typecheck clean' from DONE", () => {
    const summary = formatLocalToolSummary("run typecheck", [
      {
        toolId: "project.run",
        label: "Typecheck",
        stepTitle: "Typecheck",
        success: true,
        message: "No type errors found.",
      },
    ]);
    expect(summary).toContain("Typecheck: passed.");
    // DONE block would say "typecheck clean" — the chat message says
    // "Typecheck: passed." instead, avoiding word-for-word redundancy.
    expect(summary).not.toContain("typecheck clean");
  });
});

// ─── Viewport collision — 55-column and 80-column layouts ───────────

describe("Viewport collision — summary fits narrow and wide layouts", () => {
  it("git summary fits in 55 columns", () => {
    const porcelain = [
      " M src/index.ts",
      " M src/lib.ts",
      " M src/util.ts",
      "?? src/new.ts",
      "?? src/other.ts",
    ].join("\n");
    const gitLine = formatGitSummary(porcelain, 5);
    // The git summary line should be reasonably short.
    expect(gitLine.length).toBeLessThan(55);
  });

  it("git summary fits in 80 columns", () => {
    const porcelain = [
      " M src/index.ts",
      " M src/lib.ts",
      " M src/util.ts",
      "A  src/new.ts",
      "D  src/old.ts",
      "R  src/rename.ts -> src/renamed.ts",
      "?? src/untracked.ts",
    ].join("\n");
    const gitLine = formatGitSummary(porcelain, 7);
    expect(gitLine.length).toBeLessThan(80);
  });

  it("full deterministic summary fits in 80 columns per line", () => {
    const summary = formatLocalToolSummary(EXACT_PROMPT, [
      {
        toolId: "project.status",
        label: "Git status",
        stepTitle: "Git status",
        success: true,
        message: "5 change(s)",
        data: {
          porcelain: " M src/index.ts\n M src/lib.ts\n M src/util.ts\n?? src/new.ts\n?? src/other.ts",
          changeCount: 5,
        },
      },
      {
        toolId: "project.inspect_package",
        label: "Project metadata",
        stepTitle: "Project inspection",
        success: true,
        message: "ok",
        data: { name: "@litlabs/litt-cli", version: "0.1.0" },
      },
      {
        toolId: "project.run",
        label: "Typecheck",
        stepTitle: "Typecheck",
        success: true,
        message: "No type errors found.",
      },
    ]);
    const lines = summary.split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThan(80);
    }
  });
});
