/**
 * Mission complexity routing — determines whether semantic planning
 * (planMission) is needed for a given mission intent.
 *
 * Planning is proportional to task complexity:
 *   - Simple missions (one-step, single tool) skip the ~2.1s planning
 *     round and go directly to execution.
 *   - Complex missions (multi-step, multi-tool, architecture/repair)
 *     use the full semantic planner.
 *
 * This does NOT replace the mission lifecycle — it only skips the
 * planning round when it would add latency without value. The Mission,
 * RuntimeStore, VerificationGate, and agent loop are all preserved.
 *
 * Mutating intent ALWAYS remains MISSION — this module only decides
 * whether to plan, not whether to mission.
 */

export type MissionComplexity = "simple" | "complex";

/**
 * Classify a mission's complexity to decide whether planning is needed.
 *
 * Simple missions (skip planning, go straight to execution):
 *   - Single-action requests: "fix this failing test", "run the build"
 *   - Bounded one-step requests: "make a safe code change"
 *   - Direct execution: "show me the diff", "verify it"
 *
 * Complex missions (use semantic planning):
 *   - Multi-step: "implement auth", "refactor this subsystem"
 *   - Architecture: "audit and repair security issue", "ship this feature"
 *   - Open-ended analysis: "scan this repo and tell me what needs attention"
 *   - Multi-file: "fix this failing test and update the docs"
 */
export function classifyMissionComplexity(input: string): MissionComplexity {
  const lower = input.toLowerCase().trim();

  // ─── Complex signals — multi-step, architecture, open-ended ───
  const complexSignals = [
    // Multi-step connectors
    " and then ", " after that ", " next ", " finally ",
    // Architecture/system-level work
    "implement", "refactor", "architecture", "subsystem", "system",
    "audit", "repair", "overhaul", "redesign", "restructure",
    // Open-ended analysis
    "scan", "analyze", "investigate", "explore", "review the",
    "inspect this", "inspect the",
    // Feature work
    "ship", "deploy", "release", "feature",
    // Multi-file indicators
    "multiple files", "across the", "throughout",
  ];

  // ─── Simple signals — bounded, single-action ───
  const simpleSignals = [
    // Single verbs with bounded scope
    "fix this failing test", "fix the failing test", "fix this test",
    "fix the test", "fix the bug", "fix this bug",
    "run the build", "run build", "run tests", "run the tests",
    "run typecheck", "run the typecheck", "run lint",
    // Verify/check (bounded)
    "verify it", "verify the build", "verify the tests",
    "check the build", "check the tests",
    // Show/display (bounded read)
    "show me the diff", "show the diff", "show diff",
    "show me the changes", "show changes",
    // Safe single-step changes
    "make a safe code change", "make a safe change",
    "add a comment", "add a todo",
    // Single file operations
    "fix this file", "update this file", "edit this file",
  ];

  // Check complex signals first — if any match, it's complex.
  for (const signal of complexSignals) {
    if (lower.includes(signal)) return "complex";
  }

  // Check simple signals — if any match, it's simple.
  for (const signal of simpleSignals) {
    if (lower.includes(signal)) return "simple";
  }

  // ─── Heuristic fallback ───
  // Long requests (>80 chars) tend to be multi-step → complex.
  // Short requests (<40 chars) tend to be single-action → simple.
  if (lower.length > 80) return "complex";
  if (lower.length < 40) return "simple";

  // Medium-length requests: check for multiple action verbs.
  const actionVerbs = ["fix", "build", "test", "run", "deploy", "implement",
    "create", "add", "remove", "delete", "edit", "change", "refactor",
    "update", "write", "generate"];
  const verbCount = actionVerbs.filter((v) => {
    const re = new RegExp(`\\b${v}\\b`, "g");
    return re.test(lower);
  }).length;
  if (verbCount >= 2) return "complex";

  // Default: simple (planning adds latency without value for
  // single-action missions).
  return "simple";
}

/**
 * Decide whether to skip semantic planning for a mission.
 * Returns true if the mission is simple enough to execute directly
 * without a planning round.
 */
export function shouldSkipPlanning(input: string): boolean {
  return classifyMissionComplexity(input) === "simple";
}
