import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runAI } from "@/lib/ai/providers";
import { emitLlmMetering } from "@/lib/metering";
import {
  buildJarvisPrompt,
  collectJarvisContext,
  JarvisContext,
  JarvisAction,
  parseJarvisActions,
} from "@/lib/litt-context";
import { detectAndExecuteTool, detectToolIntent } from "@/lib/litt-intelligence/tool-executor";
import { withRateLimit } from "@/lib/rate-limiter";

async function handler(req: NextRequest) {
  const { userId, clerkId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const message = body.message as string;
    const contextRaw = body.context as Partial<JarvisContext> & { route: string };

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    // ── Real-time tool routing ──────────────────────────────────
    // Check for tool intent (weather, etc.) before calling the LLM.
    // If a tool fires, return the live result directly.
    if (detectToolIntent(message)) {
      const toolResult = await detectAndExecuteTool(userId, message);
      if (toolResult.executed) {
        return NextResponse.json({
          answer: toolResult.text,
          actions: [] as JarvisAction[],
          tool: toolResult.metadata,
        });
      }
    }

    const context = collectJarvisContext(contextRaw || { route: "/litt" });
    const prompt = buildJarvisPrompt(message, context);

    const messages = [
      {
        role: "system" as const,
        content:
          "You are LiTT, the AI operating layer for LiTTree-LabStudios. " +
          "You may be connected to a terminal, file explorer, logs, and agent runner — but only if the context below shows live data. " +
          "If the context shows no terminal output, no files, and no logs, do NOT claim you are connected to those systems. " +
          "Inspect the provided context, diagnose issues, and give prioritized fixes with commands. " +
          "When you include a command, wrap it in a bash code block. " +
          "Never claim voice, microphone, terminal, or any capability is working unless the context proves it. " +
          "Do not ask vague follow-up questions unless absolutely necessary.",
      },
      { role: "user" as const, content: prompt },
    ];

    // ── Canonical metering ──────────────────────────────────
    // runAI is a direct-fetch provider layer (NOT llm.ts), so it never
    // emits metering itself. We emit one usage_event per attempt, tied
    // with retry_sequence + original_request_id. P0 invariant: only the
    // SUCCESSFUL attempt in the retry chain is the billable usage_event;
    // failed attempts are billable=false with the error recorded. runAI
    // does not surface token counts, so the event records that the
    // attempt happened (tokens 0, provider cost from the engine).
    const meteringRequestId = crypto.randomUUID();
    const meteringStartedAt = new Date();
    const emitThinkAttempt = (
      seq: number,
      provider: string,
      model: string,
      status: "success" | "failed",
      error?: string,
    ) =>
      void emitLlmMetering({
        clerkId: clerkId ?? undefined,
        feature: "litt-think",
        provider,
        model,
        status,
        billable: status === "success",
        error,
        chargedBits: 0,
        idempotencyKey: `metering:litt-think:${meteringRequestId}:${seq}`,
        retrySequence: seq,
        originalRequestId: meteringRequestId,
        startedAt: meteringStartedAt,
        finishedAt: new Date(),
      });

    let answer: string;
    try {
      answer = await runAI({ provider: "ollama", model: "llama3.2:3b", messages });
      emitThinkAttempt(0, "ollama", "llama3.2:3b", "success");
    } catch (ollamaErr: unknown) {
      emitThinkAttempt(
        0,
        "ollama",
        "llama3.2:3b",
        "failed",
        String(ollamaErr instanceof Error ? ollamaErr.message : ollamaErr).slice(0, 500),
      );
      try {
        answer = await runAI({
          provider: "openrouter",
          model: "google/gemini-2.5-flash",
          messages,
        });
        emitThinkAttempt(1, "openrouter", "google/gemini-2.5-flash", "success");
      } catch (openrouterErr: unknown) {
        emitThinkAttempt(
          1,
          "openrouter",
          "google/gemini-2.5-flash",
          "failed",
          String(openrouterErr instanceof Error ? openrouterErr.message : openrouterErr).slice(0, 500),
        );
        throw openrouterErr;
      }
    }

    const parsed = parseJarvisActions(answer);

    const actions: JarvisAction[] = parsed.length > 0 ? parsed : [];

    const lower = message.toLowerCase();
    if (lower.includes("scan") && context.websocketStatus !== "connected") {
      actions.unshift({
        type: "insert_command",
        label: "Check terminal server URL",
        command: "echo $NEXT_PUBLIC_TERMINAL_WS_URL",
      });
    }

    if (lower.includes("fix") && context.terminalOutput.includes("error")) {
      actions.unshift({
        type: "insert_command",
        label: "Run build to see errors",
        command: "pnpm build",
      });
    }

    return NextResponse.json({ answer, actions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 10, 60);
