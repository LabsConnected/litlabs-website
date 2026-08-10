/**
 * LiTT Runtime — Prompt Builder
 *
 * Single source of truth for assembling the LiTT system + full prompt.
 * Shared by /api/litt/run, /api/gemini/chat (adapter), and the Studio
 * messages route. Composes:
 *   1. Kernel system prompt (Constitution + mode guidance + capabilities)
 *   2. Runtime agent system prompt (marketplace) OR builtin agent prompt
 *   3. Server-resolved project context block
 *   4. Conversation context line
 *   5. Translated capability block (live terminal/voice signals)
 *   6. Page context block (global companion only)
 *   7. Project-scoped memory context
 *   8. Transcript + current user message
 */

import { routeKernel, composeSystemPrompt } from "@/lib/litt-kernel";
import type { KernelResult } from "@/lib/litt-kernel";
import { translateCapabilities } from "@/lib/capabilities/translate";
import { resolveAgent } from "@/lib/studio/agent-registry";
import { buildProjectContextBlock } from "@/lib/studio/project-resolver";
import type { RuntimeAgent } from "@/lib/agent-runtime";
import type { ResolvedRunContext, BuiltPrompt, LiTTRunRequest, PageContextHint } from "./types";
import { HISTORY_LIMIT } from "./request-context";

function sanitizeOutput(text: string): string {
  return text.replace(/\{\{?userName\}?\}/gi, "there");
}

/**
 * Build the page-context block for the global companion surface.
 * Reminds the LLM it is NOT in Studio and cannot edit files or run commands.
 */
function buildPageContextBlock(pageContext: PageContextHint | undefined): string | null {
  if (pageContext?.surface !== "global_companion") return null;
  return [
    "",
    "CURRENT PAGE CONTEXT (global companion — the user is NOT in Studio):",
    `Page: ${pageContext.pageTitle || "Unknown"}`,
    `Route: ${pageContext.route || "/"}`,
    pageContext.activeEntity
      ? `Viewing: ${pageContext.activeEntity.type.replace("_", " ")} — ${pageContext.activeEntity.name}`
      : null,
    pageContext.authenticated ? "User is signed in." : "User is not signed in.",
    "You are in the global companion panel. You can answer questions, explain features,",
    "navigate, and suggest actions. If the user needs deep work (files, code, terminal,",
    "canvas, deployments), suggest they open Studio. Do NOT claim you can edit files",
    "or run commands from here — those require Studio.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Build the strict companion prompt for unauthenticated users.
 * No Kernel routing, no capabilities, no tools, no project context.
 */
function buildAnonymousCompanionPrompt(
  ctx: ResolvedRunContext,
  req: LiTTRunRequest,
  agentDisplayName: string,
): BuiltPrompt {
  const transcript = ctx.history
    .map((entry) => (entry.role === "user" ? `User: ${entry.content}` : `${agentDisplayName}: ${entry.content}`))
    .join("\n");

  const pageContextBlock = buildPageContextBlock(req.pageContext);

  const systemPrompt = [
    "You are LiTT, the AI guide and builder behind LiTTree LabStudios.",
    "You are currently operating in Public Demo Mode for a visitor who is not signed in.",
    "",
    "Your job is to let them genuinely experience LiTT's intelligence and understand what LiTTree can do.",
    "",
    "Talk naturally. Understand their idea. Ask useful questions when necessary.",
    "Explain how you would turn ideas into projects, media, brands, apps, games, music, websites or other work inside LiTTree.",
    "",
    "You may explain, brainstorm, recommend, demonstrate workflows and create hypothetical plans.",
    "You can answer questions about LiTTree LabStudios, Studio, Create/media capabilities, Music, Images, Video, Games, Marketplace, Gallery/Discover, projects, agents, pricing and free signup.",
    "You can understand the page the visitor is currently viewing and recommend the correct LiTTree surface.",
    "You can remember the short in-browser conversation during this session.",
    "You can explain how you would approach an idea and demonstrate how a request would flow through LiTTree.",
    "You can encourage opening Studio when execution is required.",
    "",
    "You have NO access to private projects, repositories, files, persistent memory, terminals, deployments, connected providers or write tools in Public Demo Mode.",
    "Never claim you performed an action you could not perform.",
    "Never claim a file, project or deployment exists when it does not.",
    "Never silently unlock Studio capabilities.",
    "",
    "When execution is required, explain what you would do and offer Studio as the next step.",
    "Do not interrupt every conversation with signup prompts — let them experience LiTT first.",
    "",
    "Stay primarily focused on LiTTree LabStudios, its capabilities and how it could help the visitor.",
    "Do not become an unlimited general-purpose anonymous chatbot.",
    "",
    "Keep responses useful, conversational and reasonably concise.",
    pageContextBlock,
  ]
    .filter(Boolean)
    .join("\n");

  const fullPrompt = [
    systemPrompt,
    "",
    transcript ? `--- Conversation so far ---\n${transcript}\n--- End of history ---\n` : "",
    `User: ${req.message}`,
    "",
    `${agentDisplayName}:`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  // Anonymous companion has no Kernel decision; synthesize an ok=true shell
  // that matches the KernelResult type exactly — no unsafe casts.
  const shellDecision: KernelResult = {
    ok: true,
    decision: {
      requestId: `anon_${Date.now()}`,
      createdAt: new Date().toISOString(),
      routing: {
        mode: "learn",
        domains: [],
        requiresProject: false,
        requiresCurrentInformation: false,
        requiresPrivateData: false,
        requiresExecution: false,
      },
      epistemics: {
        expectedTruthClasses: ["opinion"],
        minimumConfidence: 0,
        verificationRequired: false,
      },
      context: {
        sourceTypes: ["conversation"],
        conversationId: "",
        memoryIds: [],
        connectorIds: [],
      },
      execution: {
        skillIds: [],
        capabilityIds: [],
        modelProfileId: "companion",
        toolIds: [],
        budget: {
          maximumCostCents: 0,
          maximumLatencyMs: 10000,
          minimumQuality: 0,
          maximumToolCalls: 0,
          maximumAgents: 1,
          maximumReflectionPasses: 0,
        },
      },
      planning: { required: false, specialistRoles: [], parallelAllowed: false },
      governance: { risk: "low", approvalRequired: false, reflection: "light" },
    },
    systemPrompt,
  };

  return {
    systemPrompt,
    fullPrompt,
    kernelResult: shellDecision,
    agentDisplayName,
    memoryContext: "",
    projectBlock: null,
  };
}

/**
 * Build the full prompt for an authenticated (or dev) run.
 */
export function buildPrompt(
  ctx: ResolvedRunContext,
  req: LiTTRunRequest,
  runtimeAgent: RuntimeAgent | null,
): BuiltPrompt {
  const agentSlug = (req.agentSlug ?? "litt") as import("@/lib/studio/types").AgentSlug;
  const builtinAgent = resolveAgent(agentSlug);
  const agentDisplayName = runtimeAgent?.displayName || builtinAgent?.displayName || "LiTT";

  // Anonymous companion: strict limited contract.
  if (ctx.isAnonymousCompanion) {
    return buildAnonymousCompanionPrompt(ctx, req, agentDisplayName);
  }

  // Route through the Kernel.
  const kernelResult = routeKernel({
    message: req.message,
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    projectId: ctx.projectId,
    missionId: req.missionId ?? null,
    canvasId: req.activeCanvasId ?? null,
    capabilities: ctx.kernelCapabilities,
  });

  const kernelSystemPrompt = composeSystemPrompt(kernelResult.decision, ctx.kernelCapabilities);

  // Project context block (server-resolved).
  const projectBlock = ctx.project
    ? buildProjectContextBlock({
        userId: ctx.userId ?? "",
        projectId: ctx.project.projectId,
        conversationId: ctx.conversationId ?? "",
        projectName: ctx.project.projectName,
        projectDescription: ctx.project.projectDescription,
        repositoryProvider: ctx.project.repositoryProvider,
        repositoryOwner: ctx.project.repositoryOwner,
        repositoryName: ctx.project.repositoryName,
        repositoryDefaultBranch: ctx.project.repositoryDefaultBranch,
        activeBranch: ctx.project.activeBranch,
        framework: ctx.project.framework,
        scanStatus: ctx.project.scanStatus,
        scanSummary: ctx.project.scanSummary,
        activeAgentSlug: agentSlug,
        activeAgentMode: "standard",
        agentInstanceId: req.agentInstanceId ?? null,
        capabilities: ctx.project.capabilities,
      })
    : null;

  const translated = translateCapabilities(ctx.capabilities);
  const pageContextBlock = buildPageContextBlock(req.pageContext);

  // Compose the identity/governance block:
  // - Built-in agents: Kernel governance + built-in agent personality (BOTH)
  // - Marketplace agents: Kernel governance + marketplace agent prompt (BOTH)
  // Never either/or — the Kernel governance must always be present.
  const identityBlock = runtimeAgent?.systemPrompt
    ? `${kernelSystemPrompt}\n\n${runtimeAgent.systemPrompt}`
    : `${kernelSystemPrompt}\n\n${builtinAgent?.systemPrompt ?? ""}`;

  const systemPrompt = [
    identityBlock,
    projectBlock,
    ctx.conversationId ? `CURRENT CONVERSATION: ${ctx.conversationId}` : null,
    translated.contextBlock,
    pageContextBlock,
    ctx.memoryContext,
  ]
    .filter(Boolean)
    .join("\n");

  const transcript = ctx.history
    .map((entry) => (entry.role === "user" ? `User: ${entry.content}` : `${agentDisplayName}: ${entry.content}`))
    .join("\n");

  const fullPrompt = [
    systemPrompt,
    "",
    transcript ? `--- Conversation so far ---\n${transcript}\n--- End of history ---\n` : "",
    `User: ${req.message}`,
    "",
    `${agentDisplayName}:`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  return {
    systemPrompt,
    fullPrompt,
    kernelResult,
    agentDisplayName,
    memoryContext: ctx.memoryContext,
    projectBlock,
  };
}

export { sanitizeOutput, HISTORY_LIMIT };
