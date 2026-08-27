/**
 * litt ask — Ask LiTT a question about your project.
 *
 * Canonical path:
 *   User question
 *     → RuntimeSession
 *     → ExecutionGateway (identity, policy, approval)
 *     → runAgentLoop (model + tool calls)
 *     → CommandExecutor / ToolRegistry
 *     → actual execution
 *
 * When OPENROUTER_API_KEY is set, the full agent loop runs with tool
 * calling through the ExecutionGateway. When no key is available, falls
 * back to local heuristic analysis (no execution, no gateway).
 */

import {
  runAgentLoop,
  ToolRegistry,
  createShellExecutor,
  CommandExecutor,
  RuntimeStore,
  ExecutionGateway,
  type RuntimeEvent,
  type StreamChunk,
} from "@litt/agent-core";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { OpenRouterModelProvider, hasOpenRouterKey, resolveProviderAdapter } from "../lib/model-provider.js";
import { ModelRuntime } from "../lib/model-runtime.js";
import { ok, fail, warn, header, c, detectProject, resolveProjectCwd } from "../lib/utils.js";
import type { RuntimeSession } from "../lib/runtime-session.js";
import { getAuthSession } from "../lib/auth/auth-session.js";
import { getTerminalUrl } from "../lib/auth/auth-config.js";
import { createPolicyApproval } from "../lib/approval-policy.js";

export async function askCommand(args: string[], session?: RuntimeSession): Promise<number> {
  const question = args.join(" ").trim();

  if (!question) {
    fail("Please provide a question. Example: litt ask \"How do I fix the build?\"");
    return 1;
  }

  const project = detectProject(resolveProjectCwd());

  if (!project.hasPackageJson) {
    fail("No package.json found. Run this command from your project root.");
    return 1;
  }

  header("LiTT Ask");

  // If no API key, fall back to heuristic analysis
  if (!hasOpenRouterKey()) {
    warn("No OPENROUTER_API_KEY set — using local heuristic analysis (no agent loop).");
    console.log(`${c.dim}Run 'litt login' for managed keys (no API key needed), or set OPENROUTER_API_KEY for BYOK.${c.reset}\n`);
    return heuristicAnalysis(question, project);
  }

  // Full agent path: RuntimeSession → ExecutionGateway → runAgentLoop
  // Use the detected project root (walks upward from cwd)
  const projectRoot = project.rootDir;
  const sess = session ?? createRuntimeSession({ cwd: projectRoot, mode: "act" });
  sess.installSigintHandler();

  const store = new RuntimeStore();
  const shell = createShellExecutor(projectRoot);
  const executor = new CommandExecutor(shell, store);
  const tools = new ToolRegistry();
  const gateway = new ExecutionGateway({
    tools,
    shell,
    executor,
    store,
    projectId: projectRoot,
    // Policy-aware approval: safe→approve, elevated→approve in ACT,
    // dangerous→deny (requires --yes flag or interactive UI).
    onApprovalRequired: createPolicyApproval(),
  });

  // Route through the same ModelRuntime as the TUI — picks the best
  // available provider (OpenAI direct, OpenRouter, etc.) and passes
  // native tool schemas so the model can call tools.
  const modelRuntime = new ModelRuntime();
  await modelRuntime.refresh();
  const routed = modelRuntime.route("auto", null, question);
  const model = resolveProviderAdapter(routed, {
    tools: tools.list(),
  });

  // Resolve auth + REMOTE state so the model knows who it's acting for
  // and whether the REMOTE transport is available. Without this, the
  // agent cannot truthfully answer "am I authenticated?" or "is REMOTE
  // reachable?" — it would guess or say "unable to determine."
  const authSession = getAuthSession();
  const authState = await authSession.getAuthState();
  const remoteUrl = getTerminalUrl();

  console.log(`${c.cyan}▶${c.reset} Asking: ${c.bold}${question}${c.reset}\n`);

  try {
    const result = await runAgentLoop(question, {
      model,
      tools,
      shell,
      gateway,
      cwd: projectRoot,
      userId: "cli-user",
      mode: "act",
      maxRounds: 12,
      projectContext: {
        name: String(project.packageJson?.name ?? "unnamed"),
        root: project.rootDir,
        branch: project.gitBranch ?? "unknown",
        authenticated: authState.signedIn,
        authEmail: authState.email,
        authProvider: authState.signedIn ? "Clerk OAuth" : null,
        remoteUrl,
      },
      store,
      onModelStream: (event) => {
        if (event.type === "delta") {
          process.stdout.write(event.text);
        }
      },
      onToolStream: (chunk: StreamChunk) => {
        if (chunk.stream === "stdout") {
          process.stdout.write(`${c.gray}${chunk.text}${c.reset}`);
        } else {
          process.stderr.write(`${c.red}${chunk.text}${c.reset}`);
        }
      },
      emitter: (event: RuntimeEvent) => {
        // Lifecycle events — could render in cockpit
        if (event.subtype === "agent_tool_call") {
          const toolId = (event.data as { toolId?: string }).toolId ?? "unknown";
          console.log(`\n${c.blue}○${c.reset} Tool call: ${c.bold}${toolId}${c.reset}`);
        } else if (event.subtype === "agent_tool_result") {
          const success = (event.data as { success?: boolean }).success;
          const icon = success ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
          console.log(`${icon} Tool result`);
        }
      },
    });

    console.log(`\n\n${c.green}■${c.reset} Agent completed (${result.rounds} rounds, ${result.toolCalls.length} tool calls, ${result.durationMs}ms)`);

    if (result.termination === "max_rounds") {
      warn("Stopped at max rounds — agent may not have finished.");
    }

    return result.termination === "complete" ? 0 : 1;
  } catch (err) {
    fail(`Agent error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

// ─── Heuristic fallback (no API key) ──────────────────────────────

function heuristicAnalysis(question: string, project: ReturnType<typeof detectProject>): number {
  console.log(`${label("Project:")} ${value(String(project.packageJson?.name ?? "unnamed"), c.bold)}`);
  console.log(`${label("Framework:")} ${value(project.framework ?? "unknown", c.cyan)}`);
  console.log(`${label("Question:")} ${value(question, c.yellow)}`);
  console.log();

  const lowerQ = question.toLowerCase();

  if (lowerQ.includes("build") || lowerQ.includes("compile")) {
    const scripts = (project.packageJson?.scripts ?? {}) as Record<string, string>;
    if (scripts.build) {
      ok(`Build command: ${project.packageManager} run build`);
      console.log(`  ${c.dim}Runs: ${scripts.build}${c.reset}`);
    } else {
      warn("No build script found in package.json");
    }
  }

  if (lowerQ.includes("test")) {
    const scripts = (project.packageJson?.scripts ?? {}) as Record<string, string>;
    if (scripts.test) {
      ok(`Test command: ${project.packageManager} test`);
    } else {
      warn("No test script found");
    }
  }

  if (lowerQ.includes("type") || lowerQ.includes("tsc") || lowerQ.includes("typescript")) {
    if (project.hasTsConfig) {
      ok("TypeScript is configured");
      ok("Type-check: npx tsc --noEmit");
    } else {
      warn("No tsconfig.json found");
    }
  }

  if (lowerQ.includes("fix") || lowerQ.includes("error") || lowerQ.includes("bug")) {
    ok("Suggested steps:");
    console.log(`  1. Run ${c.cyan}npx tsc --noEmit${c.reset} to check for type errors`);
    console.log(`  2. Run ${c.cyan}${project.packageManager} run lint${c.reset} to check for lint errors`);
    console.log(`  3. Run ${c.cyan}${project.packageManager} test${c.reset} to run tests`);
    console.log(`  4. Run ${c.cyan}${project.packageManager} run build${c.reset} to verify the build`);
  }

  return 0;
}

// Local helpers to avoid extra import
function label(text: string): string {
  return `${c.bold}${text.padEnd(12)}${c.reset}`;
}
function value(text: string, color?: string): string {
  return color ? `${color}${text}${c.reset}` : text;
}
