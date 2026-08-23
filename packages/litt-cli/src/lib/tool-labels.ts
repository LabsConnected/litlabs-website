/**
 * Tool label mapping — canonical tool id/name → human-readable label.
 *
 * The activity feed and tool-progress view use these to show friendly
 * labels like "Type checking" instead of raw tool ids like "project.check".
 *
 * Priority: exact toolId match → tool name match → command match →
 * the raw tool name (last resort, never "unknown" or "tool").
 */

/** A human-readable label for a tool, suitable for the progress view. */
export function toolLabel(toolId: string, toolName?: string): string {
  // 1. Exact toolId match (canonical agent events carry data.toolId)
  const byId = TOOL_LABELS[toolId];
  if (byId) return byId;

  // 2. Tool name match (agent events carry data.tool = the name)
  const byName = TOOL_NAME_LABELS[toolName ?? toolId];
  if (byName) return byName;

  // 3. Heuristic: if the tool id contains a known keyword
  const lower = toolId.toLowerCase();
  for (const [keyword, label] of KEYWORD_LABELS) {
    if (lower.includes(keyword)) return label;
  }

  // 4. Last resort — the raw tool name, title-cased, never "unknown"
  const fallback = toolName ?? toolId;
  if (!fallback || fallback === "unknown") return "Working";
  return fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

/** Derive a concise result summary from a tool result message. */
export function toolSummary(
  toolId: string,
  success: boolean,
  message: string,
  durationMs?: number,
): string {
  if (!success) {
    // Failure — first line of the error, truncated
    const firstLine = message.split("\n")[0]?.trim() ?? "failed";
    return firstLine.length > 72 ? firstLine.slice(0, 71) + "…" : firstLine;
  }

  // Success — try to extract a concise pass/count summary
  const lower = message.toLowerCase();

  // Test results: "926 passed, 4 skipped" etc.
  const testMatch = message.match(/(\d+)\s*(?:passing|passed|tests?\s+passed)/i);
  const skipMatch = message.match(/(\d+)\s*(?:skipping|skipped)/i);
  if (testMatch) {
    const parts = [`${testMatch[1]} passed`];
    if (skipMatch) parts.push(`${skipMatch[1]} skipped`);
    return parts.join(" · ");
  }

  // Type check: "0 errors" etc.
  const errorMatch = message.match(/(\d+)\s*error/i);
  if (lower.includes("type") && errorMatch) {
    return errorMatch[1] === "0" ? "0 errors" : `${errorMatch[1]} errors`;
  }

  // Build: "build successful" etc. — check both the message and the
  // tool id (the message may be "compiled successfully" without the
  // word "build", but the tool id reveals it's a build tool).
  if (lower.includes("build") || toolId.toLowerCase().includes("build")) {
    return "Build successful";
  }

  // Generic success — first line, truncated
  const firstLine = message.split("\n")[0]?.trim() ?? "complete";
  if (firstLine.length > 72) return firstLine.slice(0, 71) + "…";
  return firstLine || "complete";
}

// ─── Label tables ──────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  "project.check": "Type checking",
  "project.typecheck": "Type checking",
  "project.test": "Running tests",
  "project.build": "Production build",
  "project.status": "Checking git status",
  "project.run": "Running command",
  "project.inspect": "Inspecting workspace",
  "project.inspect_package": "Inspecting workspace",
  "inspect_package": "Inspecting workspace",
  "project.read_file": "Reading file",
  "project.search": "Searching codebase",
  "project.edit_file": "Editing file",
  "project.write_file": "Writing file",
  "project.diff": "Reviewing changes",
  "project.lint": "Linting",
  "project.format": "Formatting",
  // ─── Realtime / web tools ───
  // These MUST be distinct from project.* labels so the UI never lies
  // about which capability is running. web.search ≠ "Searching codebase".
  "web.search": "Searching web",
  "web.fetch": "Reading web page",
  "weather.forecast": "Checking weather",
};

const TOOL_NAME_LABELS: Record<string, string> = {
  check: "Type checking",
  typecheck: "Type checking",
  test: "Running tests",
  build: "Production build",
  status: "Checking git status",
  run: "Running command",
  inspect: "Inspecting workspace",
  inspect_package: "Inspecting workspace",
  read_file: "Reading file",
  search: "Searching codebase",
  edit_file: "Editing file",
  write_file: "Writing file",
  diff: "Reviewing changes",
  lint: "Linting",
  format: "Formatting",
  // Web tool names — must not collide with project.search
  "web.search": "Searching web",
  "web.fetch": "Reading web page",
  "weather.forecast": "Checking weather",
  forecast: "Checking weather",
};

const KEYWORD_LABELS: Array<[string, string]> = [
  ["typecheck", "Type checking"],
  ["type-check", "Type checking"],
  ["test", "Running tests"],
  ["build", "Production build"],
  ["inspect", "Inspecting workspace"],
  ["status", "Checking git status"],
  ["search", "Searching codebase"],
  ["read", "Reading file"],
  ["edit", "Editing file"],
  ["write", "Writing file"],
  ["lint", "Linting"],
  ["format", "Formatting"],
  ["diff", "Reviewing changes"],
  // Web/weather keywords — checked AFTER exact toolId/name matches,
  // so "web.search" hits the exact match before "search" keyword fires.
  ["weather", "Checking weather"],
  ["forecast", "Checking weather"],
];
