/**
 * LiTT Agent Loop — the brain-to-hands connection.
 *
 * Before calling the LLM, this module:
 * 1. Detects whether the user's message is an engineering/project request
 * 2. Auto-runs safe read-only tools (project.scan, git.status, files.read, etc.)
 * 3. Injects the real tool results into the prompt as context
 * 4. Returns the enriched prompt for the LLM to reason over
 *
 * This is NOT a function-calling loop (the LLM providers in this codebase
 * don't support native function calling). Instead, it's a pre-LLM
 * auto-inspection phase that gives LiTT real data to reason over,
 * so he doesn't ask stupid questions the repo can answer.
 *
 * The approval model:
 * - Read-only tools (scan, git status, file reads, health checks) → auto-run
 * - Mutation tools (file writes, terminal mutations) → require approval,
 *   handled by the tool execution API at /api/litt/tools/execute
 */

import "server-only";
import { toolRegistry } from "./tool-registry";

export interface AgentLoopResult {
  /** Enriched prompt with tool results injected */
  enrichedPrompt: string;
  /** Tool executions that were run automatically */
  toolExecutions: Array<{
    toolId: string;
    success: boolean;
    summary: string;
  }>;
  /** Whether any tools were auto-run */
  ranTools: boolean;
}

// ─── Intent detection for auto-inspection ─────────────────────────

interface EngineeringIntent {
  shouldScan: boolean;
  shouldGitStatus: boolean;
  shouldReadPackageJson: boolean;
  shouldHealthCheck: boolean;
  shouldListFiles: boolean;
  /** Additional file paths to read based on the message */
  filesToRead: string[];
}

const ENGINEERING_KEYWORDS = [
  "see what",
  "what's needed",
  "whats needed",
  "audit",
  "scan",
  "inspect",
  "production ready",
  "fix it",
  "fix all",
  "what's wrong",
  "whats wrong",
  "diagnose",
  "health",
  "status",
  "where do things stand",
  "where does everything stand",
  "project status",
  "what framework",
  "what stack",
  "what dependencies",
  "what tests",
  "check the",
  "run checks",
  "typecheck",
  "type check",
  "lint",
  "build",
  "deploy",
  "get this ready",
  "make it production",
  "what needs",
  "review the code",
  "review the project",
  "something's wrong",
  "somethings wrong",
  "what's broken",
  "whats broken",
  "assess",
  "evaluate",
  "analyze",
  "analyse",
];

const GIT_KEYWORDS = [
  "git",
  "branch",
  "commit",
  "diff",
  "changes",
  "what changed",
  "uncommitted",
  "status",
];

const HEALTH_KEYWORDS = [
  "health",
  "typecheck",
  "type check",
  "lint",
  "test",
  "build check",
  "quality",
  "errors",
  "broken",
  "failing",
  "passing",
];

const FILE_KEYWORDS = [
  "package.json",
  "tsconfig",
  "config",
  "readme",
  "docker",
  "next.config",
  "tailwind",
  "env",
  "eslint",
  "vitest",
  "playwright",
];

function detectEngineeringIntent(message: string): EngineeringIntent {
  const lower = message.toLowerCase().trim();

  const isEngineering = ENGINEERING_KEYWORDS.some((kw) => lower.includes(kw));
  const isGitRelated = GIT_KEYWORDS.some((kw) => lower.includes(kw));
  const isHealthRelated = HEALTH_KEYWORDS.some((kw) => lower.includes(kw));

  // Specific file mentions
  const filesToRead: string[] = [];
  for (const kw of FILE_KEYWORDS) {
    if (lower.includes(kw)) {
      const mapping: Record<string, string> = {
        "package.json": "package.json",
        "tsconfig": "tsconfig.json",
        "readme": "README.md",
        "docker": "docker-compose.yml",
        "next.config": "next.config.ts",
        "tailwind": "postcss.config.mjs",
        "eslint": "eslint.config.mjs",
        "vitest": "vitest.config.ts",
        "playwright": "playwright.config.ts",
      };
      const file = mapping[kw];
      if (file && !filesToRead.includes(file)) {
        filesToRead.push(file);
      }
    }
  }

  return {
    shouldScan: isEngineering || lower.includes("scan") || lower.includes("audit"),
    shouldGitStatus: isEngineering || isGitRelated,
    shouldReadPackageJson: isEngineering || lower.includes("package.json") || lower.includes("dependencies") || lower.includes("framework") || lower.includes("stack"),
    shouldHealthCheck: isHealthRelated || lower.includes("health") || lower.includes("production ready") || lower.includes("fix it") || lower.includes("fix all"),
    shouldListFiles: isEngineering && !lower.includes("specific"),
    filesToRead,
  };
}

// ─── Tool execution helpers ───────────────────────────────────────

async function executeReadOnlyTool(
  toolId: string,
  inputs: Record<string, unknown>,
): Promise<{ success: boolean; result: unknown; summary: string }> {
  const result = await toolRegistry.execute(toolId, inputs, {
    hasApproval: true, // read-only tools auto-approve
    availableCapabilities: [],
  });

  if (!result.ok) {
    return { success: false, result: null, summary: result.error };
  }

  return {
    success: true,
    result: result.result,
    summary: summarizeResult(toolId, result.result),
  };
}

function summarizeResult(toolId: string, result: unknown): string {
  if (!result || typeof result !== "object") return "Completed";

  const r = result as Record<string, unknown>;

  switch (toolId) {
    case "project.scan": {
      const summary = r.summary as Record<string, unknown[]> | undefined;
      if (!summary) return "Scan completed";
      return `Languages: ${(summary.languages as string[])?.join(", ") || "none"}. Frameworks: ${(summary.frameworks as string[])?.join(", ") || "none"}. Package managers: ${(summary.packageManagers as string[])?.join(", ") || "none"}. Dependencies: ${summary.dependencyCount}. Tests: ${summary.testCount}. Risks: ${summary.riskCount}.`;
    }
    case "git.status": {
      const branch = r.branch as string;
      const hasChanges = r.hasChanges as boolean;
      return `Branch: ${branch}. ${hasChanges ? "Has uncommitted changes." : "Clean working tree."}`;
    }
    case "files.read": {
      const path = r.path as string;
      const lines = r.lines as number;
      return `Read ${path} (${lines} lines)`;
    }
    case "files.list": {
      const items = r.items as Array<{ name: string; type: string }>[];
      return `Listed ${items?.length ?? 0} items`;
    }
    case "project.health": {
      const overall = r.overallStatus as string;
      return `Overall: ${overall}`;
    }
    default:
      return "Completed";
  }
}

function formatToolResultsBlock(
  executions: Array<{ toolId: string; success: boolean; result: unknown; summary: string }>,
): string {
  if (executions.length === 0) return "";

  const lines: string[] = [
    "",
    "=== LiTT AUTO-INSPECTION RESULTS (real data from the repository — use this when answering) ===",
    "",
  ];

  for (const exec of executions) {
    lines.push(`--- ${exec.toolId} ${exec.success ? "✓" : "✗"} ---`);
    if (!exec.success) {
      lines.push(`Error: ${exec.summary}`);
    } else {
      const r = exec.result as Record<string, unknown>;
      if (exec.toolId === "project.scan") {
        const summary = r?.summary as Record<string, unknown> | undefined;
        if (summary) {
          lines.push(`Stack:`);
          lines.push(`  Languages: ${(summary.languages as string[])?.join(", ") || "none"}`);
          lines.push(`  Frameworks: ${(summary.frameworks as string[])?.join(", ") || "none"}`);
          lines.push(`  Package managers: ${(summary.packageManagers as string[])?.join(", ") || "none"}`);
          lines.push(`  Deployment targets: ${(summary.deploymentTargets as string[])?.join(", ") || "none"}`);
          lines.push(`Dependencies: ${summary.dependencyCount} packages`);
          lines.push(`Tests: ${summary.testFramework ?? "none"} (${summary.testCount} test files)`);
          lines.push(`Risks: ${summary.riskCount} detected`);
          lines.push(`Open work: ${summary.openWorkCount} items`);
          const caps = summary.capabilities as Array<{ id: string; state: string; evidence: string }> | undefined;
          if (caps && Array.isArray(caps)) {
            lines.push(`Capabilities:`);
            for (const cap of caps) {
              lines.push(`  ${cap.id}: ${cap.state} — ${cap.evidence}`);
            }
          }
        }
      } else if (exec.toolId === "git.status") {
        lines.push(`Branch: ${r?.branch ?? "unknown"}`);
        lines.push(`Status: ${r?.status ?? "unknown"}`);
        lines.push(`Recent commits: ${r?.recentCommits ?? "none"}`);
        if (r?.diffStat) lines.push(`Diff: ${r?.diffStat}`);
      } else if (exec.toolId === "files.read") {
        const content = r?.content as string;
        const path = r?.path as string;
        const lines_ = r?.lines as number;
        // Truncate large files
        const truncated = content && content.length > 8000
          ? content.slice(0, 8000) + `\n... (${lines_ - content.slice(0, 8000).split("\n").length} more lines truncated)`
          : content;
        lines.push(`File: ${path} (${lines_} lines)`);
        lines.push(`Content:`);
        lines.push(truncated || "(empty)");
      } else if (exec.toolId === "files.list") {
        const items = r?.items as Array<{ name: string; type: string; path: string }> | undefined;
        if (items && Array.isArray(items)) {
          lines.push(`Directory: ${r?.path ?? "."}`);
          for (const item of items.slice(0, 50)) {
            lines.push(`  ${item.type === "directory" ? "📁" : "📄"} ${item.name}`);
          }
          if (items.length > 50) lines.push(`  ... and ${items.length - 50} more`);
        }
      } else if (exec.toolId === "project.health") {
        const results = r?.results as Array<{ check: string; status: string; output: string }> | undefined;
        if (results && Array.isArray(results)) {
          for (const check of results) {
            lines.push(`${check.check}: ${check.status.toUpperCase()}`);
            if (check.status !== "pass") {
              lines.push(`  ${check.output.slice(0, 500)}`);
            }
          }
        }
        lines.push(`Overall: ${r?.overallStatus ?? "unknown"}`);
      } else {
        lines.push(JSON.stringify(r, null, 2).slice(0, 2000));
      }
    }
    lines.push("");
  }

  lines.push("=== END AUTO-INSPECTION RESULTS ===");
  lines.push("");
  lines.push("INSTRUCTIONS: You have real data above. Use it to answer the user's question.");
  lines.push("Do NOT ask the user to check things you already checked. Do NOT ask if a package.json exists — you can see it above.");
  lines.push("If the data shows issues, describe them and propose fixes. If everything looks good, say so.");
  lines.push("");

  return lines.join("\n");
}

// ─── Main agent loop entry point ──────────────────────────────────

/**
 * Run the pre-LLM auto-inspection phase.
 *
 * Takes the user's message and project context, auto-runs safe read-only
 * tools, and returns an enriched prompt with real data injected.
 *
 * @param message The user's message
 * @param projectId The active project ID
 * @param originalPrompt The prompt built by the prompt builder
 * @returns AgentLoopResult with enriched prompt and tool execution log
 */
export async function runAgentLoop(
  message: string,
  projectId: string,
  originalPrompt: string,
): Promise<AgentLoopResult> {
  const intent = detectEngineeringIntent(message);

  // If no engineering intent, skip tool execution
  const hasAnyIntent =
    intent.shouldScan ||
    intent.shouldGitStatus ||
    intent.shouldReadPackageJson ||
    intent.shouldHealthCheck ||
    intent.shouldListFiles ||
    intent.filesToRead.length > 0;

  if (!hasAnyIntent) {
    return {
      enrichedPrompt: originalPrompt,
      toolExecutions: [],
      ranTools: false,
    };
  }

  const executions: Array<{ toolId: string; success: boolean; result: unknown; summary: string }> = [];

  // 1. Project scan — gives stack, architecture, dependencies, tests, risks
  if (intent.shouldScan) {
    const exec = await executeReadOnlyTool("project.scan", { projectId });
    executions.push({ toolId: "project.scan", ...exec });
  }

  // 2. Git status — branch, changes, recent commits
  if (intent.shouldGitStatus) {
    const exec = await executeReadOnlyTool("git.status", { projectId });
    executions.push({ toolId: "git.status", ...exec });
  }

  // 3. Read package.json — always useful for engineering questions
  if (intent.shouldReadPackageJson) {
    const exec = await executeReadOnlyTool("files.read", { projectId, path: "package.json" });
    executions.push({ toolId: "files.read", ...exec });
  }

  // 4. List root files — gives an overview of the project structure
  if (intent.shouldListFiles) {
    const exec = await executeReadOnlyTool("files.list", { projectId, path: "." });
    executions.push({ toolId: "files.list", ...exec });
  }

  // 5. Read specifically mentioned files
  for (const filePath of intent.filesToRead) {
    if (filePath === "package.json") continue; // already read above
    const exec = await executeReadOnlyTool("files.read", { projectId, path: filePath });
    executions.push({ toolId: "files.read", ...exec });
  }

  // 6. Health check — TypeScript, lint, tests (only if explicitly requested)
  if (intent.shouldHealthCheck) {
    const exec = await executeReadOnlyTool("project.health", { projectId });
    executions.push({ toolId: "project.health", ...exec });
  }

  // Build the enriched prompt
  const toolResultsBlock = formatToolResultsBlock(executions);

  if (!toolResultsBlock) {
    return {
      enrichedPrompt: originalPrompt,
      toolExecutions: executions.map((e) => ({ toolId: e.toolId, success: e.success, summary: e.summary })),
      ranTools: false,
    };
  }

  // Inject the tool results into the prompt, right before the user's message
  // The prompt structure is: system + history + "User: message" + "LiTT:"
  // We inject the tool results before "User: message"
  const injectionPoint = `\nUser: ${message}`;
  const enrichedPrompt = originalPrompt.includes(injectionPoint)
    ? originalPrompt.replace(injectionPoint, `${toolResultsBlock}${injectionPoint}`)
    : `${originalPrompt}\n${toolResultsBlock}`;

  return {
    enrichedPrompt,
    toolExecutions: executions.map((e) => ({ toolId: e.toolId, success: e.success, summary: e.summary })),
    ranTools: true,
  };
}
