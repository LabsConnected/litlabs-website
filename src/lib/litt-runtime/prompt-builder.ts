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

  const systemPrompt = [
    "You are LiTT, the LiTTree LabStudios companion.",
    "You are NOT in Studio. You cannot edit files, run commands, access projects,",
    "or use any tools. You can answer questions, explain features, navigate, and",
    "suggest actions. If the user needs deep work (files, code, terminal, canvas,",
    "deployments), suggest they sign in and open Studio.",
    "Keep responses concise and helpful. Do not claim capabilities you do not have.",
  ].join("\n");

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

  // Anonymous companion has no Kernel decision; synthesize an ok=true shell.
  const shellDecision = {
    ok: true as const,
    decision: {
      requestId: `anon_${Date.now()}`,
      createdAt: new Date().toISOString(),
      routing: {
        mode: "companion" as const,
        domains: [] as string[],
        requiresProject: false,
        requiresCurrentInformation: false,
        requiresPrivateData: false,
        requiresExecution: false,
      },
      epistemics: {
        expectedTruthClasses: ["opinion"] as const,
        minimumConfidence: 0,
        verificationRequired: false,
      },
      context: {
        sourceTypes: ["conversation"] as const,
        conversationId: "",
        memoryIds: [] as string[],
      },
      execution: {
        skillIds: [] as string[],
        capabilityIds: [] as string[],
        modelProfileId: "companion",
        toolIds: [] as string[],
        budget: { minimumQuality: 0, maxSteps: 1, maxTokens: 1024 },
      },
      planning: { required: false, specialistRoles: [] as string[], parallelAllowed: false },
      governance: { risk: "low" as const, approvalRequired: false, reflection: "light" as const },
    },
    systemPrompt,
  } as unknown as KernelResult;

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

  const systemPrompt = [
    // Marketplace agent version prompt takes precedence; else Kernel prompt.
    runtimeAgent?.systemPrompt || kernelSystemPrompt,
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
