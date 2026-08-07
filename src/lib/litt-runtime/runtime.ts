/**
 * LiTT Runtime — Orchestrator
 *
 * The canonical execution pipeline. Every interface (Studio, companion,
 * voice, CLI, mobile) calls runLiTT() — no interface should contain its
 * own duplicated orchestration logic.
 *
 * Pipeline:
 *   1. Authenticate + resolve context (request-context)
 *   2. Resolve runtime agent (marketplace instance or builtin)
 *   3. Build prompt (prompt-builder) via LiTT Kernel
 *   4. Build tool plan (tool-planner)
 *   5. Execute via provider router + execution engine
 *   6. Verify result (result-verifier)
 *   7. Persist memory + audit
 *   8. Return streamed or normal response
 *
 * Persistence of conversation messages (studio_conversation_messages) is
 * handled by the Studio messages route, which owns the revision RPC. The
 * runtime itself is persistence-optional so it can serve companion/voice
 * surfaces that don't have a Studio conversation.
 */

import type { NextRequest, NextResponse } from "next/server";
import { resolveRuntimeAgent, type RuntimeAgent } from "@/lib/agent-runtime";
import { parseAgentSelection } from "@/lib/agent-selection";
import { persistMemory } from "@/lib/studio/memory-service";
import type { AgentSlug } from "@/lib/studio/types";
import { resolveRequestContext } from "./request-context";
import { buildPrompt, sanitizeOutput } from "./prompt-builder";
import { buildToolPlan } from "./tool-planner";
import { executeRun, executeRunStream, type ExecutionResult } from "./execution-engine";
import { verifyResult } from "./result-verifier";
import { auditRun } from "./audit-service";
import { detectActions, createLiTTStream, buildSseHeaders } from "./response-stream";
import type { LiTTRunRequest, LiTTRunResult, ResolvedRunContext, BuiltPrompt } from "./types";

export interface RunLiTTOptions {
  httpRequest: NextRequest;
  req: LiTTRunRequest;
}

export interface RunLiTTOutcome {
  ctx: ResolvedRunContext;
  prompt: BuiltPrompt;
  runtimeAgent: RuntimeAgent | null;
  result: ExecutionResult;
  verifiedText: string;
}

/**
 * Resolve the runtime agent for a marketplace agent instance, if supplied.
 * Returns null for builtin agents (the prompt builder falls back to the
 * builtin agent prompt + Kernel system prompt).
 */
async function resolveAgentForRun(
  ctx: ResolvedRunContext,
  req: LiTTRunRequest,
): Promise<RuntimeAgent | null> {
  if (!req.agentInstanceId || !ctx.clerkId) return null;
  const selection = parseAgentSelection(req.agentInstanceId);
  if (!selection) return null;
  const result = await resolveRuntimeAgent({ clerkId: ctx.clerkId, selection });
  if (!result.ok || !result.agent) return null;
  return result.agent;
}

/**
 * Persist a conversation-summary memory for authenticated runs with a
 * project. Non-blocking.
 */
function persistRunMemory(
  ctx: ResolvedRunContext,
  req: LiTTRunRequest,
  runtimeAgent: RuntimeAgent | null,
  verifiedText: string,
): void {
  if (!ctx.userId || !ctx.project) return;
  const agentSlug = (req.agentSlug ?? "litt") as AgentSlug;
  void persistMemory(
    `User: ${req.message}\n${runtimeAgent?.displayName || "LiTT"}: ${verifiedText}`,
    ctx.userId,
    ctx.project.projectId,
    {
      agentSlug,
      agentInstanceId: runtimeAgent?.agentInstanceId || undefined,
      memoryNamespace: runtimeAgent?.memoryNamespace,
      conversationId: ctx.conversationId ?? undefined,
      memoryType: "conversation_summary",
    },
  );
}

/**
 * Run the LiTT pipeline in non-streaming mode.
 *
 * Returns a NextResponse-compatible JSON body. Callers wrap it in
 * NextResponse.json() with the appropriate status.
 */
export async function runLiTT(options: RunLiTTOptions): Promise<{
  status: number;
  body: LiTTRunResult & { actions?: unknown[] };
  outcome: RunLiTTOutcome;
}> {
  const ctx = await resolveRequestContext(options.httpRequest, options.req);

  // Auth gate: unauthenticated non-companion requests are rejected.
  // (resolveRequestContext already enforces this for the anonymous companion
  // path; here we reject anything else unauthenticated.)
  if (!ctx.isAuthenticated && !ctx.isDev && !ctx.isAnonymousCompanion) {
    return {
      status: 401,
      body: { text: "", provider: "", model: "", latencyMs: 0 },
      outcome: { ctx, prompt: {} as BuiltPrompt, runtimeAgent: null, result: {} as ExecutionResult, verifiedText: "" },
    };
  }

  const runtimeAgent = await resolveAgentForRun(ctx, options.req);
  const prompt = buildPrompt(ctx, options.req, runtimeAgent);
  const toolPlan = buildToolPlan(prompt.kernelResult, ctx);

  // Phase 1: toolPlan.advertisedToolIds is always empty. When the Kernel
  // flags approvalRequired and requiresTools, we still let the LLM respond
  // (it will explain the action and request approval). Phase 5 wires real
  // tool dispatch through the Tool Registry.
  void toolPlan;

  const result = await executeRun(
    options.req,
    prompt.fullPrompt,
    prompt.systemPrompt,
    ctx.history,
  );

  const verified = verifyResult(result.text);
  const verifiedText = verified.text;

  persistRunMemory(ctx, options.req, runtimeAgent, verifiedText);
  auditRun({
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    projectId: ctx.projectId,
    mode: ctx.mode,
    agentSlug: options.req.agentSlug,
    agentInstanceId: runtimeAgent?.agentInstanceId ?? undefined,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    status: verified.ok ? "completed" : "failed",
    errorClass: verified.warning,
  });

  const actions = detectActions(options.req.message, verifiedText, options.req.activeCanvasId);

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
    outcome: { ctx, prompt, runtimeAgent, result, verifiedText },
  };
}

/**
 * Run the LiTT pipeline in streaming mode. Returns a Response whose body is
 * an SSE stream. The caller returns it directly from the route handler.
 */
export async function runLiTTStream(options: RunLiTTOptions): Promise<Response> {
  const ctx = await resolveRequestContext(options.httpRequest, options.req);

  if (!ctx.isAuthenticated && !ctx.isDev && !ctx.isAnonymousCompanion) {
    return new Response(
      JSON.stringify({ error: "Authentication required" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const runtimeAgent = await resolveAgentForRun(ctx, options.req);
  const prompt = buildPrompt(ctx, options.req, runtimeAgent);
  const toolPlan = buildToolPlan(prompt.kernelResult, ctx);
  void toolPlan;

  const { event, done } = createLiTTStream();
  const req = options.req;

  const stream = new ReadableStream({
    async start(controller) {
      let assistantText = "";
      let reasoningText = "";
      try {
        const result = await executeRunStream(
          req,
          prompt.fullPrompt,
          prompt.systemPrompt,
          {
            onText: (chunk) => {
              const clean = sanitizeOutput(chunk);
              assistantText += clean;
              controller.enqueue(event({ type: "text", text: clean }));
            },
            onReasoning: (chunk) => {
              reasoningText += chunk;
              controller.enqueue(event({ type: "reasoning", text: chunk }));
            },
          },
        );

        const verified = verifyResult(assistantText);
        persistRunMemory(ctx, req, runtimeAgent, verified.text);
        auditRun({
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          projectId: ctx.projectId,
          mode: ctx.mode,
          agentSlug: req.agentSlug,
          agentInstanceId: runtimeAgent?.agentInstanceId ?? undefined,
          provider: result.provider,
          model: result.model,
          latencyMs: result.latencyMs,
          status: verified.ok ? "completed" : "failed",
          errorClass: verified.warning,
        });

        const actions = detectActions(req.message, verified.text, req.activeCanvasId);
        controller.enqueue(
          event({
            type: "done",
            provider: result.provider,
            model: result.model,
            latencyMs: result.latencyMs,
            actions,
            reasoning: reasoningText || undefined,
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "stream error";
        controller.enqueue(
          event({ type: "error", message, partialText: assistantText || undefined }),
        );
      } finally {
        controller.enqueue(done());
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: buildSseHeaders() });
}

export type { NextResponse };
