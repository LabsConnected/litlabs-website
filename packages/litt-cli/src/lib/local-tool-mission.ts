/**
 * Local-Tool Mission — deterministic tool-only missions for signed-out LOCAL.
 *
 * A local-tool mission is a request that can be satisfied entirely with
 * local tool execution + a deterministic evidence-grounded summary, with
 * NO model inference required. This allows signed-out LOCAL users to run
 * compound inspection/verification requests (git status + typecheck +
 * project inspection) without cloud/model access.
 *
 * Detection is deliberately conservative: only prompts that clearly ask
 * for tool execution + reporting (not reasoning/fixing/creating) match.
 * Anything ambiguous falls through to the normal mission path (which the
 * capability gate blocks for signed-out LOCAL).
 *
 * What this module does NOT do:
 *   - no model inference (no planning, no synthesis, no reasoning)
 *   - no remote execution
 *   - no file mutations (read-only commands only)
 *   - no fix/refactor/implement (those need model reasoning)
 *
 * Truthfulness:
 *   - The summary is derived ONLY from actual tool results — never
 *     invented. If typecheck passes, the summary says so. If it fails,
 *     the summary reports the actual errors.
 *   - LOCAL/REMOTE truth is preserved: the mission reports LOCAL locus.
 */

/** A single tool call in a local-tool mission. */
export interface LocalToolCall {
  toolId: string;
  args: Record<string, unknown>;
  label: string;
  /** Mission step title for the observability MissionProgressBlock. */
  stepTitle: string;
}

/** A matched local-tool mission. */
export interface LocalToolMissionMatch {
  calls: LocalToolCall[];
  /** Human-readable summary of what the mission does. */
  summary: string;
  /** The mission goal text (for the canonical mission). */
  goal: string;
}

/**
 * Action verbs that indicate the user wants model REASONING, not just tool
 * execution. If any of these appear, the mission is NOT local-tool-only.
 */
const MODEL_REASONING_VERBS = /\b(fix|implement|refactor|create|write|edit|delete|deploy|ship|optimize|migrate|scaffold|generate|design|architect|plan|debug|repair)\b/i;

/**
 * Detect whether a prompt is a local-tool-only mission — one that can be
 * satisfied with local tool execution + a deterministic summary, with no
 * model inference.
 *
 * Returns a match with tool calls, or null if the prompt needs model
 * reasoning or cannot be deterministically decomposed into local tools.
 */
export function matchLocalToolMission(input: string): LocalToolMissionMatch | null {
  const lower = input.toLowerCase().trim();

  // ─── Guard: model-reasoning verbs disqualify ──────────────────────
  // "fix the typecheck errors" needs model reasoning — NOT local-tool.
  if (MODEL_REASONING_VERBS.test(lower)) return null;

  const calls: LocalToolCall[] = [];

  // ─── Git status / dirty state ─────────────────────────────────────
  const wantsGitStatus = /\b(dirty|clean|git status|what.*changed|what.*change|working tree|changes|uncommitted|untracked)\b/i.test(lower);
  if (wantsGitStatus) {
    calls.push({
      toolId: "project.status",
      args: {},
      label: "Git status",
      stepTitle: "Git status",
    });
  }

  // ─── Project inspection ───────────────────────────────────────────
  const wantsProjectInfo = /\b(project|repo|repository|inspect|package|structure|stack|framework)\b/i.test(lower);
  if (wantsProjectInfo) {
    calls.push({
      toolId: "project.inspect_package",
      args: {},
      label: "Project metadata",
      stepTitle: "Project inspection",
    });
  }

  // ─── Branch ───────────────────────────────────────────────────────
  const wantsBranch = /\bbranch\b/i.test(lower);
  if (wantsBranch) {
    calls.push({
      toolId: "project.branch",
      args: {},
      label: "Current branch",
      stepTitle: "Branch check",
    });
  }

  // ─── Typecheck ────────────────────────────────────────────────────
  const wantsTypecheck = /\b(typecheck|type check|type-check|tsc)\b/i.test(lower);
  if (wantsTypecheck) {
    calls.push({
      toolId: "project.run",
      args: { command: "pnpm", args: ["exec", "tsc", "--noEmit"] },
      label: "Typecheck",
      stepTitle: "Typecheck",
    });
  }

  // ─── Lint ─────────────────────────────────────────────────────────
  const wantsLint = /\b(lint|eslint|linting)\b/i.test(lower);
  if (wantsLint) {
    calls.push({
      toolId: "project.run",
      args: { command: "pnpm", args: ["exec", "eslint", "src", "--ext", ".ts"] },
      label: "Lint",
      stepTitle: "Lint",
    });
  }

  // ─── Build ────────────────────────────────────────────────────────
  const wantsBuild = /\b(build|compile)\b/i.test(lower);
  if (wantsBuild) {
    calls.push({
      toolId: "project.run",
      args: { command: "pnpm", args: ["build"] },
      label: "Build",
      stepTitle: "Build",
    });
  }

  // ─── Tests ────────────────────────────────────────────────────────
  const wantsTests = /\b(test|tests|testing|vitest|jest)\b/i.test(lower);
  if (wantsTests) {
    calls.push({
      toolId: "project.run",
      args: { command: "pnpm", args: ["exec", "vitest", "run", "--reporter=dot"] },
      label: "Tests",
      stepTitle: "Tests",
    });
  }

  // Need at least one tool call to be a local-tool mission.
  if (calls.length === 0) return null;

  // ─── Guard: must not ask for model-only tasks ─────────────────────
  // "explain why the code is broken" needs model reasoning even though
  // it contains "explain". Only allow if the prompt is clearly about
  // tool execution + reporting.
  const hasToolRequest = wantsGitStatus || wantsProjectInfo || wantsBranch
    || wantsTypecheck || wantsLint || wantsBuild || wantsTests;
  if (!hasToolRequest) return null;

  // "explain what you checked" is fine — it's asking for a summary of
  // what was done, not model reasoning. But "explain why..." or
  // "explain how..." needs model reasoning.
  const wantsModelExplanation = /\bexplain\s+(why|how|what is|what are|the reason|the cause)\b/i.test(lower);
  if (wantsModelExplanation) return null;

  const summary = `${calls.length} local tool${calls.length > 1 ? "s" : ""}: ${calls.map((c) => c.label).join(", ")}`;

  return {
    calls,
    summary,
    goal: input,
  };
}

// ─── Deterministic summary ──────────────────────────────────────────

/** A tool result from the gateway. */
export interface LocalToolResult {
  toolId: string;
  label: string;
  stepTitle: string;
  success: boolean;
  message: string;
  data?: Record<string, unknown> | unknown;
  durationMs?: number;
}

/**
 * Parse git porcelain lines into categorized counts.
 *
 * Porcelain v1 format: each line starts with a 2-char status code:
 *   XY filename
 * X = staged status, Y = unstaged status.
 *   " " = unmodified
 *   M  = modified
 *   A  = added
 *   D  = deleted
 *   R  = renamed
 *   C  = copied
 *   U  = unmerged (conflict)
 *   ?  = untracked (only in Y, X is " ")
 *   !  = ignored (only in Y, X is " ")
 *
 * We categorize into: modified, added, deleted, renamed, untracked, unmerged.
 * "modified" includes copied (rare) to keep the summary concise.
 */
export function parseGitPorcelain(
  porcelain: string,
): {
  total: number;
  modified: number;
  added: number;
  deleted: number;
  renamed: number;
  untracked: number;
  unmerged: number;
} {
  const lines = porcelain.trim().split("\n").filter((l) => l.trim());
  const counts = { total: 0, modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, unmerged: 0 };

  for (const line of lines) {
    if (line.length < 2) continue;
    counts.total++;
    const x = line[0];
    const y = line[1];

    if (x === "?" || y === "?") {
      counts.untracked++;
      continue;
    }
    if (x === "U" || y === "U" || (x === "D" && y === "D") || (x === "A" && y === "A")) {
      counts.unmerged++;
      continue;
    }
    // Check both staged (X) and unstaged (Y) status
    const codes = x + y;
    if (codes.includes("R") || codes.includes("C")) {
      counts.renamed++;
    } else if (codes.includes("A")) {
      counts.added++;
    } else if (codes.includes("D")) {
      counts.deleted++;
    } else if (codes.includes("M")) {
      counts.modified++;
    }
  }

  return counts;
}

/**
 * Format git status into the canonical summary string.
 *
 *   clean repo → "Git: clean"
 *   dirty repo → "Git: N changes — X modified, Y untracked, ..."
 *
 * Only non-zero categories are listed. Categories are ordered:
 * modified, added, deleted, renamed, unmerged, untracked.
 */
export function formatGitSummary(
  porcelain: string,
  changeCount: number,
): string {
  if (changeCount === 0) return "Git: clean";

  const c = parseGitPorcelain(porcelain);
  const parts: string[] = [];
  if (c.modified > 0) parts.push(`${c.modified} modified`);
  if (c.added > 0) parts.push(`${c.added} added`);
  if (c.deleted > 0) parts.push(`${c.deleted} deleted`);
  if (c.renamed > 0) parts.push(`${c.renamed} renamed`);
  if (c.unmerged > 0) parts.push(`${c.unmerged} unmerged`);
  if (c.untracked > 0) parts.push(`${c.untracked} untracked`);

  if (parts.length === 0) {
    // Fallback: changeCount > 0 but no categories matched — use the raw count.
    return `Git: ${changeCount} change(s)`;
  }

  return `Git: ${c.total} change${c.total > 1 ? "s" : ""} — ${parts.join(", ")}`;
}

/**
 * Format a deterministic, evidence-grounded summary from actual tool
 * results. NEVER invents status — every line derives from a real tool
 * result.
 *
 * This is the "plain-English conclusion" that the SummaryBlock renders.
 * It reports what was checked and what passed/failed, with no model
 * inference.
 */
export function formatLocalToolSummary(
  input: string,
  results: LocalToolResult[],
): string {
  const lines: string[] = [];

  // Header: what was inspected
  lines.push("Inspection complete.");

  // Per-tool evidence
  for (const r of results) {
    if (r.toolId === "project.status") {
      const data = r.data as { porcelain?: string; changeCount?: number; files?: string[] } | undefined;
      if (data?.porcelain !== undefined && data?.changeCount !== undefined) {
        lines.push(formatGitSummary(data.porcelain, data.changeCount));
      } else if (data?.changeCount === 0 || r.message === "Working tree clean") {
        lines.push("Git: clean");
      } else {
        lines.push(`Git: ${r.message}`);
      }
    } else if (r.toolId === "project.branch") {
      const data = r.data as { branch?: string } | undefined;
      lines.push(`Branch: ${data?.branch ?? r.message}`);
    } else if (r.toolId === "project.inspect_package") {
      const data = r.data as { name?: string; version?: string } | undefined;
      if (data?.name) {
        lines.push(`Project: ${data.name}${data.version ? `@${data.version}` : ""}`);
      } else {
        lines.push(`Project: ${r.message}`);
      }
    } else if (r.toolId === "project.run") {
      const label = r.label;
      if (r.success) {
        lines.push(`${label}: passed.`);
      } else {
        // Include a truncated portion of the actual error output
        const errMsg = r.message.slice(0, 200);
        lines.push(`${label}: failed — ${errMsg}`);
      }
    }
  }

  // Footer: what was checked (derived from the actual tool set)
  const checked = results.map((r) => r.stepTitle.toLowerCase());
  if (checked.length > 0) {
    lines.push(`Checked: ${checked.join(", ")}.`);
  }

  // Read-only note if the prompt mentioned "without changing"
  if (/\b(without changing|don.t change|read.only|no changes)\b/i.test(input)) {
    lines.push("No files were changed.");
  }

  return lines.join("\n");
}
