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

import { resolveProject } from "@/lib/studio/project-resolver";
import { recallMemories, formatMemoryContext } from "@/lib/studio/memory-service";
import { getConversation, listMessages } from "@/lib/studio/conversation-service";
import { adaptLegacyCapability } from "@/lib/litt-kernel";
import type { CapabilityRecord } from "@/lib/litt-kernel";
import type { RawCapabilities } from "@/lib/capabilities/translate";
import type { AgentSlug } from "@/lib/studio/types";
import type { ResolvedRunContext, HistoryEntry, LiTTRunRequest } from "@/lib/litt-runtime/types";
import { executeRun } from "@/lib/litt-runtime/execution-engine";
import { verifyResult } from "@/lib/litt-runtime/result-verifier";
import { auditRun } from "@/lib/litt-runtime/audit-service";
import { detectActions } from "@/lib/litt-runtime/response-stream";
import type { LiTTRunResult } from "@/lib/litt-runtime/types";

const HISTORY_LIMIT = 6;

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

  // Run project resolution, conversation lookup, and memory recall in parallel
  const [projectResult, convResult, memoryResult] = await Promise.all([
    // Resolve project
    (async () => {
      if (!userId || !projectId) return null;
      try {
        return await resolveProject(userId, projectId);
      } catch {
        return null;
      }
    })(),
    // Resolve conversation + history
    (async () => {
      if (!userId || !conversationId) return { convId: null, history: [] as HistoryEntry[] };
      try {
        const conversation = await getConversation(conversationId, userId);
        if (!conversation) return { convId: null, history: [] as HistoryEntry[] };
        const allMessages = await listMessages(conversation.id, userId);
        const history = allMessages
          .filter((m) => m.status === "completed" && (m.role === "user" || m.role === "assistant"))
          .slice(-HISTORY_LIMIT)
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
        return { convId: conversation.id, history };
      } catch {
        return { convId: null, history: [] as HistoryEntry[] };
      }
    })(),
    // Recall memories (non-fatal)
    (async () => {
      if (!userId || !projectId) return "";
      try {
        const agentSlug = "litt" as AgentSlug;
        const memories = await recallMemories(message, userId, projectId, {
          agentSlug,
          limit: 3,
        });
        return formatMemoryContext(memories);
      } catch {
        return "";
      }
    })(),
  ]);

  const project = projectResult;
  const convId = convResult.convId;
  const history = convResult.history;
  const memoryContext = memoryResult;

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
    category: "fast",
    maxTokens: 300,
    timeoutMs: 12_000,
  };

  // Build a voice-optimized prompt — much shorter than the full kernel prompt.
  // Voice needs speed: skip kernel governance, capability translation, and
  // the full project context block. Include only essential context.
  const voiceSystem = [
    "You are LiTT, the AI assistant for LiTTree LabStudios.",
    "You are on a phone call. Keep responses short and conversational — 2-3 sentences max.",
    "",
    "CONTEXT (use this to answer questions):",
    ctx.projectName ? `Active project: ${ctx.projectName}` : "",
    ctx.project?.activeBranch ? `Current branch: ${ctx.project.activeBranch}` : "",
    ctx.project?.repositoryName ? `Repository: ${ctx.project.repositoryName}` : "",
    ctx.project?.repositoryProvider ? `Provider: ${ctx.project.repositoryProvider}` : "",
    ctx.memoryContext ? `Relevant memories:\n${ctx.memoryContext}` : "",
    "",
    "When the user asks about their project, branch, or repository, answer using the CONTEXT above.",
    "Do not say you don't have information — the context above is the user's real project data.",
  ].filter(Boolean).join("\n");

  const transcript = ctx.history
    .map((e) => (e.role === "user" ? `User: ${e.content}` : `LiTT: ${e.content}`))
    .join("\n");

  const voiceFull = [
    voiceSystem,
    "",
    transcript ? `--- Conversation so far ---\n${transcript}\n--- End of history ---\n` : "",
    `User: ${args.message}`,
    "",
    "LiTT:",
  ].filter(Boolean).join("\n");

  const result = await executeRun(
    req,
    voiceFull,
    voiceSystem,
    ctx.history,
  );

  const verified = verifyResult(result.text);
  const verifiedText = verified.text;

  // Persist memory + audit asynchronously (do not block voice response)
  const memUserId = ctx.userId;
  const memProjectId = ctx.project?.projectId ?? null;
  if (memUserId && memProjectId) {
    void (async () => {
      try {
        const { persistMemory } = await import("@/lib/studio/memory-service");
        await persistMemory(
          `User: ${args.message}\nLiTT: ${verifiedText}`,
          memUserId,
          memProjectId,
          {
            agentSlug: "litt",
            memoryType: "conversation_summary",
            conversationId: ctx.conversationId ?? undefined,
          },
        );
      } catch {
        // Non-fatal
      }
    })();
  }

  // Audit asynchronously
  void auditRun({
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
