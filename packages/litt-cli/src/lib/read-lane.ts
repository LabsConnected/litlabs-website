/**
 * READ lane — bounded read-only project inspection.
 *
 * Sits between LOCAL (deterministic fast lane) and MISSION (full agent
 * lifecycle). Maps read-only inspection queries to canonical read-only
 * ToolRegistry tools, executes them through the ExecutionGateway, and
 * optionally makes one synthesis model call to format results.
 *
 * Architecture:
 *   LOCAL  → deterministic local state (no model, no tools)
 *   READ   → bounded read-only tools → optional one synthesis call
 *   MISSION → full mission lifecycle (planner, agent loop, verification)
 *   CHAT   → conversation (model only, no tools)
 *
 * The READ lane does NOT:
 *   - create a Mission
 *   - invoke the planner
 *   - invoke VerificationGate
 *   - perform mutations
 *   - run multi-step agent loops
 *
 * It DOES:
 *   - use canonical ExecutionGateway + ToolRegistry (no duplicated logic)
 *   - execute independent read tools in parallel
 *   - emit truthful PerfTrace marks
 *   - surface truthful tool activity in the UI
 *   - optionally synthesize results with one model call
 */

import type { ToolResult } from "@litt/agent-core";

// ─── Types ─────────────────────────────────────────────────────────

/** A single read-only tool call to execute. */
export interface ReadToolCall {
  toolId: string;
  args: Record<string, unknown>;
  /** Human-readable label for UI display. */
  label: string;
}

/** Result of a read tool call. */
export interface ReadToolResult {
  toolId: string;
  label: string;
  result: ToolResult;
  ms: number;
}

/** Outcome of matching a query to read tools. */
export interface ReadMatch {
  /** The tool calls to execute. */
  calls: ReadToolCall[];
  /** Whether a synthesis model call is needed to combine/format results. */
  needsSynthesis: boolean;
  /** Human-readable summary of what was matched. */
  summary: string;
}

// ─── Query → Tool mapping ──────────────────────────────────────────

/**
 * Map a read-intent query to canonical read-only tool calls.
 * Returns null if the query doesn't match any read pattern (shouldn't
 * happen if intent classification is correct, but defensive).
 */
export function matchReadTools(input: string): ReadMatch | null {
  const lower = input.toLowerCase().trim();

  // ─── Package inspection (framework, package manager, scripts, deps) ───
  const packageSignals = [
    "framework", "stack", "technology", "technologies",
    "package manager", "package-manager",
    "scripts", "npm scripts", "available scripts",
    "dependencies", "deps", "dev dependencies", "devdependencies",
    "packages", "project name", "project type", "project info",
    "build tool", "bundler", "node version", "typescript version",
  ];

  // ─── Git status (files changed, diff, changes) ───
  const statusSignals = [
    "git status", "current git status",
    "files changed", "what changed", "changes", "diff",
  ];

  // ─── Git log (commits, recent commits) ───
  const logSignals = ["recent commits", "commits", "git log", "show log", "show commits"];

  // ─── Branch (current branch) ───
  const branchSignals = ["branch", "current branch"];

  // NOTE: "repo name" / "repository name" queries are handled by the
  // LOCAL fast lane deterministically (using the canonical directory name
  // from basename(projectRoot), NOT package.json name). The READ lane
  // does NOT map "repo" to project.inspect_package because that tool
  // returns package.json.name (e.g. "@litlabs/litt-cli") which is the
  // package name, not the repository name.

  const calls: ReadToolCall[] = [];
  let needsSynthesis = false;

  // Check for compound queries (framework + branch, etc.)
  const wantsPackage = packageSignals.some((s) => lower.includes(s));
  const wantsStatus = statusSignals.some((s) => lower.includes(s));
  const wantsLog = logSignals.some((s) => lower.includes(s));
  const wantsBranch = branchSignals.some((s) => lower.includes(s));

  if (wantsPackage) {
    calls.push({
      toolId: "project.inspect_package",
      args: {},
      label: "Inspect package metadata",
    });
  }

  if (wantsBranch) {
    calls.push({
      toolId: "project.branch",
      args: {},
      label: "Get current branch",
    });
  }

  if (wantsStatus) {
    calls.push({
      toolId: "project.status",
      args: {},
      label: "Get git status",
    });
  }

  if (wantsLog) {
    calls.push({
      toolId: "project.log",
      args: { limit: 10 },
      label: "Show recent commits",
    });
  }

  if (calls.length === 0) {
    return null;
  }

  // Compound queries need synthesis to combine results.
  // Package inspection also needs synthesis because its structured metadata
  // must be interpreted. A single git-status result is formatted
  // deterministically below instead of spending a model call.
  needsSynthesis = calls.length >= 2 || wantsPackage;

  const summary = calls.length === 1
    ? calls[0].label
    : `${calls.length} read tools: ${calls.map((c) => c.toolId).join(", ")}`;

  return { calls, needsSynthesis, summary };
}

// ─── Execution ─────────────────────────────────────────────────────

/**
 * Execute read tool calls in parallel through the gateway/registry.
 * Returns results in the same order as the input calls.
 *
 * Uses the provided execute function (typically bound to the gateway or
 * registry) so this module stays testable without real tool implementations.
 */
export async function executeReadTools(
  calls: ReadToolCall[],
  execute: (toolId: string, args: Record<string, unknown>) => Promise<ToolResult>,
): Promise<ReadToolResult[]> {
  const results = await Promise.all(
    calls.map(async (call) => {
      const t0 = Date.now();
      const result = await execute(call.toolId, call.args);
      const ms = Date.now() - t0;
      return { toolId: call.toolId, label: call.label, result, ms };
    }),
  );
  return results;
}

/**
 * Activity-feed completion type for a finished READ pass.
 *
 * Mirrors the "agent.complete" / "agent.stopped" convention the CHAT and
 * MISSION lanes already use for their own completion events (see
 * controller.ts) — "agent.complete" is the existing semantic SUCCESS
 * type the activity renderer maps to the completed/checkmark
 * presentation; "agent.stopped" is its existing failure counterpart.
 *
 * Truthful: only reports the completed type when every read tool in
 * this pass actually succeeded. A failed project.status/project.log
 * must not be reported as a clean completion just because the READ
 * pass itself finished running.
 */
export function readCompletionActivityType(
  results: ReadToolResult[],
): "agent.complete" | "agent.stopped" {
  return results.every((r) => r.result.success) ? "agent.complete" : "agent.stopped";
}

/**
 * Format read tool results into a context prompt for optional synthesis.
 * The synthesis model gets the raw tool results and the original query,
 * and produces a concise natural-language answer.
 */
export function formatReadResultsForSynthesis(
  input: string,
  results: ReadToolResult[],
): string {
  const evidence = results.map((r) => {
    const data = r.result.data;
    return `[${r.toolId}] ${r.result.message}\nData: ${JSON.stringify(data, null, 2)}`;
  }).join("\n\n");

  return [
    `User asked: "${input}"`,
    "",
    "Read-only tool results (use ONLY this evidence — do not fabricate):",
    evidence,
    "",
    "Provide a concise, factual answer based on the tool results above.",
    "If the tools did not return the requested information, say so honestly.",
  ].join("\n");
}


/**
 * Produce a precise user-facing answer for read results that do not need
 * model synthesis. Returns null when no specialized deterministic formatter
 * applies, allowing the controller to use its generic fallback.
 */
export function formatDeterministicReadAnswer(
  results: ReadToolResult[],
): string | null {
  if (results.length !== 1) return null;

  const entry = results[0];
  if (entry.toolId !== "project.status" || !entry.result.success) return null;

  const data = entry.result.data;
  if (!data || typeof data !== "object") return null;

  const record = data as Record<string, unknown>;

  const branch =
    typeof record.branch === "string" && record.branch.trim()
      ? record.branch.trim()
      : null;

  const changed =
    typeof record.changed === "number" && Number.isFinite(record.changed)
      ? record.changed
      : 0;

  const untracked =
    typeof record.untracked === "number" && Number.isFinite(record.untracked)
      ? record.untracked
      : 0;

  const gitStatus =
    record.gitStatus && typeof record.gitStatus === "object"
      ? record.gitStatus as Record<string, unknown>
      : null;

  const files =
    gitStatus && Array.isArray(gitStatus.files)
      ? gitStatus.files.filter((value): value is string => typeof value === "string")
      : [];

  const trackedFiles: string[] = [];
  const untrackedFiles: string[] = [];

  for (const raw of files) {
    const line = raw.trimEnd();

    // Git porcelain uses two status columns followed by a space and path:
    // " M file", "M  file", "?? file", etc.
    const path = line.length >= 4 ? line.slice(3).trim() : line.trim();

    if (!path) continue;

    if (line.startsWith("??")) {
      untrackedFiles.push(path);
    } else {
      trackedFiles.push(path);
    }
  }

  const total =
    typeof gitStatus?.changeCount === "number" &&
    Number.isFinite(gitStatus.changeCount)
      ? gitStatus.changeCount
      : changed + untracked;

  if (record.clean === true || total === 0) {
    return branch
      ? `The working tree on \`${branch}\` is clean.`
      : "The working tree is clean.";
  }

  const intro = branch
    ? `On \`${branch}\`, there are ${total} working-tree changes: ${changed} tracked and ${untracked} untracked.`
    : `There are ${total} working-tree changes: ${changed} tracked and ${untracked} untracked.`;

  const lines = [intro];

  if (trackedFiles.length > 0) {
    lines.push(
      `Tracked: ${trackedFiles.map((file) => `\`${file}\``).join(", ")}`
    );
  }

  if (untrackedFiles.length > 0) {
    lines.push(
      `Untracked: ${untrackedFiles.map((file) => `\`${file}\``).join(", ")}`
    );
  }

  return lines.join("\n");
}

// ─── Full inspection (for /inspect) ────────────────────────────────

/**
 * Build a comprehensive inspection match — runs ALL key read-only tools
 * in parallel so the inspection is GUARANTEED to gather real evidence,
 * regardless of whether the model would have called tools on its own.
 *
 * This is the /inspect fast path: instead of forcing a mission that
 * relies on the model to emit tool_call blocks (which weak/free models
 * often skip — they say "I'll check..." and then answer from memory),
 * we execute the tools directly and hand the results to the model for
 * synthesis only.
 */
export function buildFullInspectionMatch(extraFocus?: string): ReadMatch {
  const calls: ReadToolCall[] = [
    { toolId: "project.status", args: {}, label: "Git status" },
    { toolId: "project.log", args: { count: 10 }, label: "Recent commits" },
    { toolId: "project.branch", args: {}, label: "Current branch" },
    { toolId: "project.inspect_package", args: {}, label: "Package metadata" },
    { toolId: "project.list_files", args: { path: "." }, label: "Root directory" },
    { toolId: "project.list_files", args: { path: "src" }, label: "src/ directory" },
  ];

  const summary = extraFocus
    ? `Full inspection (focus: ${extraFocus})`
    : "Full project inspection";

  return { calls, needsSynthesis: true, summary };
}

/**
 * Format full inspection results into a comprehensive synthesis prompt.
 * The model gets ALL the evidence and produces a structured rundown.
 */
export function formatInspectionForSynthesis(
  results: ReadToolResult[],
  extraFocus?: string,
): string {
  const evidence = results.map((r) => {
    const data = r.result.data;
    return `[${r.toolId}] ${r.result.message}\nData: ${JSON.stringify(data, null, 2)}`;
  }).join("\n\n");

  const focusSection = extraFocus
    ? `\nThe user specifically wants focus on: ${extraFocus}\n`
    : "";

  return [
    "You are LiTT. The following read-only tool results were gathered by DIRECTLY executing project inspection tools.",
    "Do NOT say you will check — the checks have already been run. Summarize the ACTUAL results below.",
    focusSection,
    "Tool results (real evidence — use ONLY this, do not fabricate):",
    evidence,
    "",
    "Provide a structured project rundown covering:",
    "1. Current branch and git status",
    "2. Latest commits (summarize the recent work)",
    "3. Uncommitted/untracked files",
    "4. Project structure and major packages",
    "5. Known issues or concerns visible in the state",
    "6. What should be done next, in priority order",
    "",
    "Be concise and factual. If a tool failed, report the failure honestly.",
  ].join("\n");
}
