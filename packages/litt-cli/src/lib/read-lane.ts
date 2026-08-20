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
  const statusSignals = ["files changed", "what changed", "changes", "diff"];

  // ─── Git log (commits, recent commits) ───
  const logSignals = ["recent commits", "commits", "git log", "show log", "show commits"];

  // ─── Branch (current branch) ───
  const branchSignals = ["branch", "current branch"];

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

  // Compound queries (2+ tools) need synthesis to combine results.
  // Single-tool queries may still need synthesis if the raw tool output
  // isn't a direct answer (e.g., inspect_package returns raw package.json
  // data — the user asked "what framework is this" and needs a one-word
  // answer extracted).
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
