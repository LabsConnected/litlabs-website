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
 * A configured provider or discovered local model runs the full agent
 * loop through the ExecutionGateway. Explicit model overrides use the
 * runtime's strict pinned route; unconfigured requests use heuristics.
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
import { hasAnyProviderKey, resolveProviderAdapter, providerLabel } from "../lib/model-provider.js";
import { ModelRuntime } from "../lib/model-runtime.js";
import { probeLocalLane } from "../lib/local-lane.js";
import {
  localRoutePolicy,
  resolveLocalModel,
  localRoutedModel,
  isLocalModelId,
} from "../lib/local-model-resolution.js";
import { resolveExecutionTarget, resolveLocalOnly } from "../lib/execution-target.js";
import { ok, fail, warn, header, c, detectProject } from "../lib/utils.js";
import { resolveActiveProject } from "../lib/active-project.js";
import type { RuntimeSession } from "../lib/runtime-session.js";
import { getAuthSession } from "../lib/auth/auth-session.js";
import { getTerminalUrl } from "../lib/auth/auth-config.js";

export async function askCommand(args: string[], session?: RuntimeSession): Promise<number> {
  const question = args.join(" ").trim();

  if (!question) {
    fail("Please provide a question. Example: litt ask \"How do I fix the build?\"");
    return 1;
  }

  let project = detectProject();

  if (!project.hasPackageJson) {
    // Recover via the canonical resolution pipeline instead of dying.
    const resolved = await resolveActiveProject();
    if (!resolved) {
      fail("No package.json found. Run this command from your project root.");
      return 1;
    }
    project = resolved.project;
  }

  header("LiTT Ask");

  // A credential-less Ollama daemon is a real provider lane. Only drop to
  // heuristic analysis when neither hosted/BYOK credentials nor a proven
  // local model are available.
  const providerConfigured = hasAnyProviderKey();
  const localLane = providerConfigured ? null : await probeLocalLane();
  const selectedModel = process.env.LITT_MODEL?.trim() || process.env.OPENROUTER_MODEL?.trim() || null;

  if (!providerConfigured && !localLane?.available) {
    if (selectedModel) {
      fail(`Cannot serve selected model "${selectedModel}": ${localLane?.reason ?? "no provider available"}`);
      return 1;
    }
    warn("No provider API key and no local model available — using local heuristic analysis (no agent loop).");
    console.log(`${c.dim}Run 'litt login' for managed keys, configure a BYOK provider, or start Ollama with a local model.${c.reset}\n`);
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
  });

  try {
    // Resolve auth + REMOTE state so the model knows who it's acting for
    // and whether the REMOTE transport is available. Without this, the
    // agent cannot truthfully answer "am I authenticated?" or "is REMOTE
    // reachable?" — it would guess or say "unable to determine."
    const authSession = getAuthSession();
    const authState = await authSession.getAuthState();
    const remoteUrl = getTerminalUrl();

    // Route through the same ModelRuntime as the TUI — picks the best
    // available provider (OpenAI direct, OpenRouter, Groq, etc.) and passes
    // native tool schemas so the model can call tools.
    // In remote mode (signed in), the server holds all provider keys.
    // BUT: when a local BYOK key is present, use local mode so the router
    // only selects models the CLI can actually serve locally. This prevents
    // the router from selecting OpenAI models (LiTT defaults) when only
    // Groq is configured locally.
    const hasLocalKey = !!(
      process.env.GROQ_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.MISTRAL_API_KEY
    );
    const executionTarget = resolveExecutionTarget();
    const localOnly = resolveLocalOnly();
    const modelRuntime = new ModelRuntime(authState.signedIn && !hasLocalKey);
    await modelRuntime.refresh();

    // Determine whether the local daemon must serve this request.
    // When executionTarget=local (LITT_LOCAL_MODE=1, --local, or default),
    // the local daemon (Ollama/LM Studio) is the ONLY provider lane.
    // A persisted or env-selected remote model is never used in LOCAL mode.
    const requestedLocalModel = process.env.LITT_MODEL?.trim()
      || (isLocalModelId(selectedModel) ? selectedModel : null);
    const policy = localRoutePolicy({
      executionTarget,
      localOnly,
      signedIn: authState.signedIn,
      requestedLocalModel,
      hasCloudCredential: hasLocalKey,
    });

    let routed;
    let routingMode: "auto" | "fixed";
    if (policy.kind === "local-required") {
      // LOCAL mode: route through the local daemon.
      const lane = await probeLocalLane();
      routed = modelRuntime.routeLocal(lane, requestedLocalModel);
      routingMode = "fixed";
    } else {
      // REMOTE/BYOK mode: route through the cloud catalog.
      const selectedId = selectedModel && (
        modelRuntime.registry.getById(selectedModel)?.canonicalId ??
        modelRuntime.registry.getAll().find((entry) =>
          entry.providerModelId === selectedModel || entry.openRouterModelId === selectedModel,
        )?.canonicalId ?? selectedModel
      );
      routingMode = selectedId ? "fixed" : "auto";
      routed = modelRuntime.route(routingMode, selectedId, question);
    }
    const model = resolveProviderAdapter(routed, {
      tools: tools.list(),
      routingMode,
    });

    console.log(`${c.dim}Provider: ${providerLabel(model.providerId)} | Model: ${model.configuredModel}${c.reset}`);
    console.log(`${c.cyan}▶${c.reset} Asking: ${c.bold}${question}${c.reset}\n`);

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
    if (model.activeModel) {
      console.log(`${c.dim}Served by: ${providerLabel(model.providerId)} | Model: ${model.activeModel}${c.reset}`);
    }

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
