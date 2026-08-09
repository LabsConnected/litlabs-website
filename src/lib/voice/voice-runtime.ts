/**
 * LiTT Voice Runtime Adapter
 *
 * Bridges voice provider turns (Vapi, Twilio, etc.) to the canonical
 * LiTT Runtime pipeline. Instead of relying on Clerk cookie auth
 * (which voice providers don't have), it accepts a pre-resolved
 * userId + projectId + conversationId from the voice session and
 * builds a ResolvedRunContext directly.
 *
 * This means voice turns go through the exact same prompt builder,
 * execution engine, memory recall, and audit as Studio text turns.
 * One brain, one tool system, one conversation memory.
 */

import { resolveProject, buildProjectContextBlock } from "@/lib/studio/project-resolver";
import { recallMemories, formatMemoryContext } from "@/lib/studio/memory-service";
import { getConversation, listMessages } from "@/lib/studio/conversation-service";
import { adaptLegacyCapability } from "@/lib/litt-kernel";
import type { CapabilityRecord } from "@/lib/litt-kernel";
import type { RawCapabilities } from "@/lib/capabilities/translate";
import type { AgentSlug } from "@/lib/studio/types";
import type { ResolvedRunContext, HistoryEntry, LiTTRunRequest } from "@/lib/litt-runtime/types";
import { buildPrompt } from "@/lib/litt-runtime/prompt-builder";
import { executeRun } from "@/lib/litt-runtime/execution-engine";
import { verifyResult } from "@/lib/litt-runtime/result-verifier";
import { auditRun } from "@/lib/litt-runtime/audit-service";
import { detectActions } from "@/lib/litt-runtime/response-stream";
import type { LiTTRunResult } from "@/lib/litt-runtime/types";

const HISTORY_LIMIT = 12;

/**
 * Build a ResolvedRunContext for a voice turn.
 *
 * This mirrors resolveRequestContext but takes a pre-resolved userId
 * (from the voice session) instead of extracting it from Clerk auth.
 */
export async function resolveVoiceContext(args: {
  userId: string | null;
  projectId: string | null;
  conversationId: string | null;
  message: string;
}): Promise<ResolvedRunContext> {
  const { userId, projectId, conversationId, message } = args;

  // Resolve project server-side when a projectId is supplied.
  let project: ResolvedRunContext["project"] = null;
  if (userId && projectId) {
    project = await resolveProject(userId, projectId);
  }

  // Resolve conversation + DB history
  let convId: string | null = conversationId;
  let history: HistoryEntry[] = [];
  if (userId && convId) {
    const conversation = await getConversation(convId, userId);
    if (conversation) {
      convId = conversation.id;
      const allMessages = await listMessages(conversation.id, userId);
      history = allMessages
        .filter((m) => m.status === "completed" && (m.role === "user" || m.role === "assistant"))
        .slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    } else {
      convId = null;
    }
  }

  // Recall project-scoped memories
  let memoryContext = "";
  if (userId && project) {
    const agentSlug = "litt" as AgentSlug;
    try {
      const memories = await recallMemories(message, userId, project.projectId, {
        agentSlug,
        limit: 5,
      });
      memoryContext = formatMemoryContext(memories);
    } catch {
      // Non-fatal
    }
  }

  // Build capabilities from project state
  const capabilities: RawCapabilities = {
    repository: project?.capabilities.repositoryConnected ? "connected" : undefined,
    repositoryIndexed: project?.capabilities.repositoryConnected,
    repositoryName: project?.repositoryName ?? undefined,
    activeBranch: project?.activeBranch ?? undefined,
    writeAccess: undefined,
    workspaceStatus: undefined,
    terminalExecution: project?.capabilities.terminalConnected ? "available" : "unavailable",
    connectedProviders: project?.capabilities.availableTools,
    availableTools: project?.capabilities.availableTools,
    connectionSummary: project?.capabilities.connectionSummary,
    voiceTransportConnected: true,
  };

  // Kernel capability records
  const kernelCapabilities: CapabilityRecord[] = [];
  if (project?.capabilities.repositoryConnected) {
    kernelCapabilities.push(adaptLegacyCapability({ id: "github", status: "ready", name: "Repository" }));
  }

  return {
    userId: userId ?? null,
    clerkId: userId,
    isAuthenticated: Boolean(userId),
    isAnonymousCompanion: false,
    isDev: false,
    mode: "voice",
    projectId: project?.projectId ?? projectId ?? null,
    projectName: project?.projectName ?? null,
    conversationId: convId,
    project,
    capabilities,
    kernelCapabilities,
    history,
    memoryContext,
  };
}

/**
 * Run the LiTT pipeline for a voice turn.
 *
 * This is the voice equivalent of runLiTT() — same pipeline, same
 * prompt builder, same execution engine, same memory + audit. The
 * only difference is that auth comes from the voice session instead
 * of Clerk cookies.
 */
export async function runLiTTForVoice(args: {
  userId: string | null;
  projectId: string | null;
  conversationId: string | null;
  message: string;
}): Promise<{
  status: number;
  body: LiTTRunResult & { actions?: unknown[] };
}> {
  const ctx = await resolveVoiceContext(args);

  if (!ctx.userId) {
    return {
      status: 200,
      body: {
        text: "I don't have this phone number linked to a LiTT account yet. Would you like to learn about LiTTree Lab Studios?",
        provider: "system",
        model: "voice-gateway",
        latencyMs: 0,
      },
    };
  }

  const req: LiTTRunRequest = {
    message: args.message,
    conversationId: ctx.conversationId ?? undefined,
    projectId: ctx.projectId ?? undefined,
    agentMode: "voice",
    agentSlug: "litt",
  };

  const prompt = buildPrompt(ctx, req, null);

  const result = await executeRun(
    req,
    prompt.fullPrompt,
    prompt.systemPrompt,
    ctx.history,
  );

  const verified = verifyResult(result.text);
  const verifiedText = verified.text;

  // Persist memory (non-blocking)
  if (ctx.userId && ctx.project) {
    const { persistMemory } = await import("@/lib/studio/memory-service");
    void persistMemory(
      `User: ${args.message}\nLiTT: ${verifiedText}`,
      ctx.userId,
      ctx.project.projectId,
      {
        agentSlug: "litt",
        memoryType: "conversation_summary",
        conversationId: ctx.conversationId ?? undefined,
      },
    );
  }

  // Audit
  auditRun({
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    projectId: ctx.projectId,
    mode: "voice",
    agentSlug: "litt",
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    status: verified.ok ? "completed" : "failed",
    errorClass: verified.warning,
  });

  const actions = detectActions(args.message, verifiedText, undefined);

  return {
    status: 200,
    body: {
      text: verifiedText,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      reasoning: result.reasoning,
      actions,
    },
  };
}
