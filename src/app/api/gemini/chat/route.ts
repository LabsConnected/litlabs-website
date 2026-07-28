import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { streamText, generateText, type ModelCategory } from "@/lib/llm";
import { AGENTS, Agent } from "@/lib/agents";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Part } from "@google/generative-ai";
import { translateCapabilities, type RawCapabilities } from "@/lib/capabilities/translate";
import { detectCanvasActions, detectSuggestedActions } from "@/lib/canvas/actions";
import { routeKernel, composeSystemPrompt, adaptLegacyCapability } from "@/lib/litt-kernel";
import type { CapabilityRecord } from "@/lib/litt-kernel";

export const runtime = "nodejs";
export const maxDuration = 60;

type HistoryEntry = { role: "user" | "assistant"; content: string };

const DEFAULT_AGENT_SLUG = "litt";
const HISTORY_LIMIT = 12;

async function fetchMemories(query: string, userId: string): Promise<string> {
  try {
    const smKey = process.env.SUPERMEMORY_API_KEY;
    if (!smKey) return "";
    const { Supermemory } = await import("supermemory");
    const sm = new Supermemory({ apiKey: smKey });
    const results = await sm.search.memories({ q: query, containerTag: userId, limit: 5 });
    const memories = (results.results || []).map((m: { memory?: string; chunk?: string }) => m.memory || m.chunk || "").filter(Boolean);
    if (!memories.length) return "";
    return `\n\nRELEVANT MEMORIES FROM PREVIOUS SESSIONS:\n${memories.join("\n")}\n---`;
  } catch {
    return "";
  }
}

async function saveMemory(content: string, userId: string, agentId: string): Promise<void> {
  try {
    const smKey = process.env.SUPERMEMORY_API_KEY;
    if (!smKey) return;
    const { Supermemory } = await import("supermemory");
    const sm = new Supermemory({ apiKey: smKey });
    await sm.add({ content, containerTag: userId, metadata: { type: "agent-chat", agent: agentId } });
  } catch {
    // non-fatal
  }
}

function sanitizeOutput(text: string): string {
  return text.replace(/\{\{?userName\}?\}/gi, "there");
}

function dataUrlToInlineData(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9+/\-._]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1];
  const base64 = match[2];
  // Only accept common image MIME types
  if (!mimeType.startsWith("image/")) return null;
  return { inlineData: { mimeType, data: base64 } };
}

async function generateWithImages(
  systemPrompt: string,
  userText: string,
  history: HistoryEntry[],
  images: string[],
  modelName = "gemini-2.5-flash",
): Promise<{ text: string; provider: string; model: string; latencyMs: number }> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  if (!key) throw new Error("Gemini API key not configured");
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  });

  const contents: { role: "user" | "model"; parts: Part[] }[] = [];
  for (const entry of history.slice(-HISTORY_LIMIT)) {
    contents.push({
      role: entry.role === "user" ? "user" : "model",
      parts: [{ text: entry.content }],
    });
  }

  const parts: Part[] = [{ text: userText }];
  for (const image of images) {
    const inline = dataUrlToInlineData(image);
    if (inline) parts.push(inline as Part);
  }
  contents.push({ role: "user", parts });

  const t0 = Date.now();
  const result = await model.generateContent({ contents });
  const text = result.response.text();
  return { text, provider: "gemini", model: modelName, latencyMs: Date.now() - t0 };
}

function buildPrompt(
  agent: Agent,
  message: string,
  history: HistoryEntry[],
  memoryContext: string,
  userName?: string,
  capabilities?: Record<string, unknown>,
): string {
  const recentHistory = history.slice(-HISTORY_LIMIT);

  const transcript = recentHistory
    .map((entry) =>
      entry.role === "user"
        ? `User: ${entry.content}`
        : `${agent.name}: ${entry.content}`,
    )
    .join("\n");

  const resolvedName = userName?.trim() || "Member";
  const systemPrompt = agent.systemPrompt.replace(/\{\{?userName\}?\}/g, resolvedName);

  const rawCaps: RawCapabilities = {
    repository: capabilities?.repository as string | undefined,
    repositoryIndexed: capabilities?.repositoryIndexed as boolean | undefined,
    terminalExecution: capabilities?.terminalExecution as string | undefined,
    writeAccess: capabilities?.writeAccess as boolean | undefined,
    connectedProviders: capabilities?.connectedProviders as string[] | undefined,
    availableTools: capabilities?.availableTools as string[] | undefined,
    connectionSummary: capabilities?.connectionSummary as string | undefined,
    voiceTransportConnected: capabilities?.voiceTransportConnected as boolean | undefined,
    voiceMicrophoneOn: capabilities?.voiceMicrophoneOn as boolean | undefined,
  };
  const translated = translateCapabilities(rawCaps);

  return [
    systemPrompt,
    translated.contextBlock,
    memoryContext,
    "",
    transcript ? `--- Conversation so far ---\n${transcript}\n--- End of history ---\n` : "",
    `User: ${message}`,
    "",
    `${agent.name}:`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

async function logConversation(
  agent: Agent,
  userId: string | null,
  userMessage: string,
  responseText: string,
) {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return; // Build-safe: null when env keys unavailable
    await admin.from("agent_logs").insert({
      agent_id: agent.id,
      level: "info",
      message: "Agent chat",
      metadata: {
        userId,
        userMessage,
        responseText,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // Failed to log agent chat:
  }
}

/**
 * POST /api/gemini/chat
 * Body: { agentSlug, message, history?, provider?, stream?: boolean }
 */
async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { userId } = await auth();
    const body = await req.json();
    const {
      agentSlug = DEFAULT_AGENT_SLUG,
      message,
      history = [],
      provider,
      category,
      model: requestedModel,
      stream = false,
      userName,
      images = [],
      capabilities = {},
      pageContext,
    } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const agent =
      AGENTS[agentSlug as keyof typeof AGENTS] ??
      AGENTS[DEFAULT_AGENT_SLUG as keyof typeof AGENTS];

    const uid = userId || "anonymous-dev";
    const memoryContext = userId ? await fetchMemories(message, uid) : "";

    // ─── LiTT Kernel routing ──────────────────────────────────
    // The Kernel classifies intent, checks capabilities, and composes
    // a system prompt with mode-specific guidance + verified capabilities.
    // This replaces the static agent prompt with a context-aware one.
    const kernelCapabilities: CapabilityRecord[] = (() => {
      // Adapt the legacy capability format from the client into
      // CapabilityRecord objects for the Kernel.
      const caps = capabilities as Record<string, unknown>;
      const records: CapabilityRecord[] = [];
      if (caps.repository === "connected") {
        records.push(adaptLegacyCapability({ id: "github", status: "ready", name: "Repository" }));
      }
      if (caps.terminalExecution === "available") {
        records.push(adaptLegacyCapability({ id: "pty", status: "ready", name: "Terminal" }));
      }
      if (caps.voiceTransportConnected) {
        records.push(adaptLegacyCapability({ id: "voice", status: "ready", name: "Voice" }));
      }
      return records;
    })();

    const kernelResult = routeKernel({
      message,
      userId: userId ?? null,
      conversationId: null, // not yet wired from session
      projectId: (capabilities as Record<string, unknown>)?.projectId as string | null ?? null,
      missionId: null,
      canvasId: (body.activeCanvasId as string) ?? null,
      capabilities: kernelCapabilities,
    });

    // Compose the Kernel system prompt (Constitution + mode guidance +
    // verified capabilities). Falls back to the legacy agent prompt if
    // the Kernel fails for any reason.
    const kernelSystemPrompt = composeSystemPrompt(kernelResult.decision, kernelCapabilities);

    // Use the Kernel prompt as the base, then layer on the legacy
    // capability translation block + memory + history (same as before).
    const rawCaps: RawCapabilities = {
      repository: capabilities?.repository as string | undefined,
      repositoryIndexed: capabilities?.repositoryIndexed as boolean | undefined,
      terminalExecution: capabilities?.terminalExecution as string | undefined,
      writeAccess: capabilities?.writeAccess as boolean | undefined,
      connectedProviders: capabilities?.connectedProviders as string[] | undefined,
      availableTools: capabilities?.availableTools as string[] | undefined,
      connectionSummary: capabilities?.connectionSummary as string | undefined,
      voiceTransportConnected: capabilities?.voiceTransportConnected as boolean | undefined,
      voiceMicrophoneOn: capabilities?.voiceMicrophoneOn as boolean | undefined,
      voiceHealth: capabilities?.voiceHealth as RawCapabilities["voiceHealth"],
    };
    const translated = translateCapabilities(rawCaps);

    // Build page context block for the global companion
    const pageContextBlock = pageContext?.surface === "global_companion"
      ? [
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
        ].filter(Boolean).join("\n")
      : null;

    const systemPrompt = [
      kernelSystemPrompt,
      translated.contextBlock,
      pageContextBlock,
      memoryContext,
    ]
      .filter(Boolean)
      .join("\n");

    const geminiModel =
      typeof requestedModel === "string" && requestedModel.startsWith("gemini")
        ? requestedModel
        : "gemini-2.5-flash";

    // Multimodal path: send image snapshots directly to Gemini
    const imageArray = Array.isArray(images) ? images : [];
    if (imageArray.length > 0 && !stream) {
      const r = await generateWithImages(systemPrompt, message, history, imageArray, geminiModel);
      const cleanText = sanitizeOutput(r.text);
      if (userId) {
        await saveMemory(`User: ${message}\n${agent.name}: ${cleanText}`, uid, agent.id);
      }
      return NextResponse.json({
        response: cleanText,
        provider: r.provider,
        model: r.model,
        latencyMs: r.latencyMs,
      });
    }

    // Build the full prompt using the Kernel-composed system prompt +
    // transcript + user message (same structure as buildPrompt, but
    // with the Kernel's context-aware system prompt instead of the
    // static agent prompt).
    const recentHistory = history.slice(-HISTORY_LIMIT);
    const transcript = recentHistory
      .map((entry: HistoryEntry) =>
        entry.role === "user"
          ? `User: ${entry.content}`
          : `${agent.name}: ${entry.content}`,
      )
      .join("\n");
    const prompt = [
      systemPrompt,
      "",
      transcript ? `--- Conversation so far ---\n${transcript}\n--- End of history ---\n` : "",
      `User: ${message}`,
      "",
      `${agent.name}:`,
    ]
      .filter((line) => line !== undefined)
      .join("\n");

    if (!stream) {
      const r = await generateText(
        prompt,
        {
          task: "chat",
          provider: category ? undefined : provider,
          category: category as ModelCategory | undefined,
          maxTokens: 2048,
          modelOverride: requestedModel && provider ? { [provider]: requestedModel } : undefined,
        },
        undefined,
      );
      const cleanText = sanitizeOutput(r.text);
      await logConversation(agent, userId, message, cleanText);
      if (userId) {
        await saveMemory(`User: ${message}\n${agent.name}: ${cleanText}`, uid, agent.id);
      }

      // Detect canvas actions from the user message (explicit) and
      // from the response (suggested). Explicit actions are ready to
      // execute; suggested actions are shown as chips.
      const activeCanvasId = (body.activeCanvasId as string) ?? null;
      const explicitActions = detectCanvasActions(message, activeCanvasId);
      const suggestedActions = detectSuggestedActions(cleanText);
      // Deduplicate — if explicit actions exist, don't also suggest
      const actions = explicitActions.length > 0 ? explicitActions : suggestedActions;

      return NextResponse.json({
        response: cleanText,
        provider: r.provider,
        model: r.model,
        latencyMs: r.latencyMs,
        actions,
      });
    }

    const encoder = new TextEncoder();
    const sse = new ReadableStream({
      async start(controller) {
        let assistantText = "";
        try {
          const r = await streamText(
            prompt,
            (chunk) => {
              const cleanChunk = sanitizeOutput(chunk);
              assistantText += cleanChunk;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: cleanChunk })}\n\n`),
              );
            },
            {
              task: "chat",
              provider: category ? undefined : provider,
              category: category as ModelCategory | undefined,
              maxTokens: 2048,
              modelOverride: requestedModel && provider ? { [provider]: requestedModel } : undefined,
            },
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                done: true,
                provider: r.provider,
                model: r.model,
                latencyMs: r.latencyMs,
                actions: (() => {
                  const activeCanvasId = (body.activeCanvasId as string) ?? null;
                  const explicit = detectCanvasActions(message, activeCanvasId);
                  const suggested = detectSuggestedActions(assistantText);
                  return explicit.length > 0 ? explicit : suggested;
                })(),
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          const msg = err instanceof Error ? err.message : "stream error";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
          );
        } finally {
          controller.close();
          if (assistantText) {
            await logConversation(agent, userId, message, assistantText);
            if (userId) {
              await saveMemory(`User: ${message}\n${agent.name}: ${assistantText}`, uid, agent.id);
            }
          }
        }
      },
    });

    return new Response(sse, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    // LLM chat route error:
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
