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
import { callLLMWithTools, type ToolDefinition as LLMToolDefinition } from "@/lib/litt-intelligence/llm-tool-calling";
import { executeProjectTool, getProjectToolDefinitions, PROJECT_TOOLS } from "@/lib/project-tools/registry";
import { LITT_BEHAVIOR_CONTRACT } from "@/lib/vapi-tool-definitions";

const HISTORY_LIMIT = 6;
const MAX_TOOL_ROUNDS = 8; // Allows full dev workflows: get_active_project → search_code → read_file → edit_file → run_project_checks → browser_test → commit → push
const VOICE_TOTAL_TIMEOUT_MS = 45_000; // Hard cap across all tool rounds — voice needs to respond within Vapi's timeout
const MAX_REPEAT_CALLS = 2; // Max times the same tool+args can be called before the loop breaks (prevents infinite loops)

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

  // ── Voice-optimized system prompt ──────────────────────────────
  //
  // The voice runtime CAN dispatch tools via the shared project tool
  // registry. Tools are advertised to the LLM via native function
  // calling (callLLMWithTools). The LLM decides whether a tool is
  // needed; if so, we execute it through the registry and feed the
  // result back. If no tools are needed, we return text directly.
  //
  // The behavior contract is included to enforce honesty: never claim
  // an action happened unless its tool returned success.
  const voiceSystem = [
    "You are LiTT, the AI assistant for LiTTree LabStudios.",
    "You are on a phone call. Keep responses short and conversational — 2-3 sentences max.",
    "",
    LITT_BEHAVIOR_CONTRACT,
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
    "",
    "TOOLS:",
    "You have tools available to inspect code, edit files, run tests, create branches,",
    "commit, push, create pull requests, search code, remember context, test pages in",
    "the browser, send email, and request approvals.",
    "IMPORTANT: When the user asks you to DO something (inspect, read, edit, search,",
    "test, create, commit, push, send), you MUST call the appropriate tool — do not",
    "just describe what you would do. Actually invoke the tool function.",
    "If a tool returns failure, tell the caller honestly what went wrong.",
    "If a tool requires a project_id and you don't have one, call get_active_project first.",
    "After a tool returns, summarize the result for the caller in 1-2 sentences.",
    "",
    "The site URL is https://litlabs.net.",
  ].filter(Boolean).join("\n");

  const transcript = ctx.history
    .map((e) => (e.role === "user" ? `User: ${e.content}` : `LiTT: ${e.content}`))
    .join("\n");

  // ── Tool dispatch loop ─────────────────────────────────────────
  //
  // 1. Call the LLM with tools advertised via native function calling.
  // 2. If the LLM returns tool_calls, execute them through the shared
  //    registry and feed results back to the LLM.
  // 3. Repeat until the LLM returns text only (no tool_calls) or we
  //    hit the max rounds safety limit.
  // 4. If no tools are needed (the LLM returns text immediately),
  //    skip the loop entirely and use the text directly.
  //
  // Voice needs speed: if the OPENROUTER_API_KEY is not configured,
  // fall back to the text-only executeRun path (no tool dispatch).

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  let finalText: string;
  let finalProvider: string;
  let finalModel: string;
  let finalLatencyMs: number;

  if (openRouterKey && ctx.userId) {
    // ── Native tool-calling path ──
    const toolDefs = getProjectToolDefinitions();
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      ...ctx.history.slice(-HISTORY_LIMIT).map((e) => ({
        role: e.role as "user" | "assistant",
        content: e.content,
      })),
      { role: "user" as const, content: args.message },
    ];

    const t0 = Date.now();
    let roundText = "";
    const roundProvider = "openrouter";
    let roundModel = "google/gemini-2.5-flash";
    // Track repeated tool calls to detect infinite loops
    const toolCallCounts = new Map<string, number>();

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        // Total timeout check — voice must respond within Vapi's window
        if (Date.now() - t0 > VOICE_TOTAL_TIMEOUT_MS) {
          roundText = "I'm still working on that but I'm running low on time. Let me finish this up and get back to you.";
          break;
        }

        const llmResp = await callLLMWithTools(
          voiceSystem,
          messages,
          toolDefs as LLMToolDefinition[],
          {
            model: roundModel,
            maxTokens: 500,
            temperature: 0.2,
          },
        );

        roundModel = llmResp.model;
        roundText = llmResp.text;

        // No tool calls → we're done, return the text
        if (llmResp.toolCalls.length === 0) {
          break;
        }

        // Add the assistant's tool-call message to the conversation
        messages.push({
          role: "assistant",
          content: roundText || `[Calling ${llmResp.toolCalls.length} tool(s)]`,
        });

        // Execute each tool call through the shared registry
        for (const tc of llmResp.toolCalls) {
          // callLLMWithTools converts tool names: underscores → dots (for
          // business tools like business.services.list). Project tools use
          // underscores natively (get_active_project). Try both forms.
          const toolName = tc.toolId.includes(".")
            ? tc.toolId.replace(/\./g, "_")
            : tc.toolId;
          const toolEntry = PROJECT_TOOLS[toolName];
          if (!toolEntry) {
            messages.push({
              role: "assistant",
              content: `Tool "${tc.toolId}" is not available. Valid tools: ${Object.keys(PROJECT_TOOLS).slice(0, 8).join(", ")}...`,
            });
            continue;
          }

          // Inject project_id from context if the tool is project-scoped
          // and the LLM didn't provide one
          const toolArgs = { ...tc.inputs };
          if (toolEntry.metadata.projectScoped && !toolArgs.project_id && ctx.projectId) {
            toolArgs.project_id = ctx.projectId;
          }

          // Repeated-call detection: if the same tool+args has been called
          // too many times, stop the loop to prevent infinite cycling
          const callKey = `${toolName}:${JSON.stringify(toolArgs)}`;
          const callCount = (toolCallCounts.get(callKey) ?? 0) + 1;
          toolCallCounts.set(callKey, callCount);
          if (callCount > MAX_REPEAT_CALLS) {
            messages.push({
              role: "assistant",
              content: `I've already tried "${toolName}" with these arguments ${MAX_REPEAT_CALLS} times and it didn't resolve the issue. Let me summarize what I know so far.`,
            });
            // Force a final text response by calling without tools
            const finalResp = await callLLMWithTools(
              voiceSystem,
              messages,
              [],
              { model: roundModel, maxTokens: 300, temperature: 0.2 },
            );
            roundText = finalResp.text;
            break;
          }

          try {
            const result = await executeProjectTool(toolName, ctx.userId, toolArgs);
            const resultText = result.success
              ? `SUCCESS: ${result.message} ${JSON.stringify(result.data).slice(0, 500)}`
              : `FAILED: ${result.message}`;
            messages.push({ role: "assistant", content: resultText });
          } catch (err) {
            messages.push({
              role: "assistant",
              content: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }

        // If we broke out of the inner loop due to repeated calls, exit the outer loop too
        if (toolCallCounts.values().some((c) => c > MAX_REPEAT_CALLS)) {
          break;
        }

        // On the last round, force a text response
        if (round === MAX_TOOL_ROUNDS - 1) {
          // Call one more time without tools to get a final text response
          const finalResp = await callLLMWithTools(
            voiceSystem,
            messages,
            [],
            { model: roundModel, maxTokens: 300, temperature: 0.2 },
          );
          roundText = finalResp.text;
        }
      }
    } catch (err) {
      // Tool-calling path failed — fall back to text-only
      roundText = `I ran into an issue processing that. ${err instanceof Error ? err.message : "Please try again."}`;
    }

    finalText = roundText;
    finalProvider = roundProvider;
    finalModel = roundModel;
    finalLatencyMs = Date.now() - t0;
  } else {
    // ── Text-only fallback path (no OPENROUTER_API_KEY) ──
    const voiceFull = [
      voiceSystem,
      "",
      transcript ? `--- Conversation so far ---\n${transcript}\n--- End of history ---\n` : "",
      `User: ${args.message}`,
      "",
      "LiTT:",
    ].filter(Boolean).join("\n");

    const result = await executeRun(req, voiceFull, voiceSystem, ctx.history);
    finalText = result.text;
    finalProvider = result.provider;
    finalModel = result.model;
    finalLatencyMs = result.latencyMs;
  }

  const verified = verifyResult(finalText);
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
    provider: finalProvider,
    model: finalModel,
    latencyMs: finalLatencyMs,
    status: verified.ok ? "completed" : "failed",
    errorClass: verified.warning,
  });

  const actions = detectActions(args.message, verifiedText, undefined);

  return {
    status: 200,
    body: {
      text: verifiedText,
      provider: finalProvider,
      model: finalModel,
      latencyMs: finalLatencyMs,
      reasoning: undefined,
      actions,
    },
  };
}
