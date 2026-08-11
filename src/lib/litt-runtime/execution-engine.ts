/**
 * LiTT Runtime — Execution Engine
 *
 * Calls the model provider via the centralized @/lib/llm layer. Supports
 * both non-streaming (generate) and streaming modes. Multimodal (image)
 * inputs are routed to Gemini's native multimodal API.
 *
 * The execution engine does NOT own memory, persistence, or tool dispatch —
 * those are handled by the runtime orchestrator. It only produces text.
 */

import { generateText, streamText } from "@/lib/llm";
import type { LLMOptions } from "@/lib/llm";
import type { Part } from "@google/generative-ai";
import type { LiTTRunRequest, HistoryEntry } from "./types";
import { selectModelOptions, resolveGeminiVisionModel } from "./provider-router";

export interface ExecutionResult {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  reasoning?: string;
}

export interface StreamCallbacks {
  onText: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
}

function dataUrlToInlineData(dataUrl: string): Part | null {
  const match = dataUrl.match(/^data:([a-zA-Z0-9+/\-._]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1];
  if (!mimeType.startsWith("image/")) return null;
  return { inlineData: { mimeType, data: match[2] } };
}

/**
 * Multimodal path: send image snapshots directly to Gemini.
 * Used when attachments contain images and streaming is not requested.
 */
async function generateWithImages(
  systemPrompt: string,
  userText: string,
  history: HistoryEntry[],
  images: string[],
  modelName: string,
): Promise<ExecutionResult> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  if (!key) throw new Error("Gemini API key not configured");
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: systemPrompt });

  const contents: { role: "user" | "model"; parts: Part[] }[] = [];
  for (const entry of history.slice(-12)) {
    contents.push({
      role: entry.role === "user" ? "user" : "model",
      parts: [{ text: entry.content }],
    });
  }
  const parts: Part[] = [{ text: userText }];
  for (const image of images) {
    const inline = dataUrlToInlineData(image);
    if (inline) parts.push(inline);
  }
  contents.push({ role: "user", parts });

  const t0 = Date.now();
  const result = await model.generateContent({ contents });
  return { text: result.response.text(), provider: "gemini", model: modelName, latencyMs: Date.now() - t0 };
}

/**
 * Non-streaming execution.
 */
export async function executeRun(
  req: LiTTRunRequest,
  fullPrompt: string,
  systemPrompt: string,
  history: HistoryEntry[],
): Promise<ExecutionResult> {
  const options = selectModelOptions(req);

  const imageAttachments = (req.attachments ?? [])
    .filter((a) => a.type === "image")
    .map((a) => a.dataUrl);

  if (imageAttachments.length > 0 && !req.stream) {
    const modelName = resolveGeminiVisionModel(req);
    return generateWithImages(systemPrompt, req.message, history, imageAttachments, modelName);
  }

  const r = await generateText(fullPrompt, options, systemPrompt);
  return { text: r.text, provider: r.provider, model: r.model, latencyMs: r.latencyMs };
}

/**
 * Streaming execution. Returns the final result after the stream completes.
 */
export async function executeRunStream(
  req: LiTTRunRequest,
  fullPrompt: string,
  systemPrompt: string,
  callbacks: StreamCallbacks,
): Promise<ExecutionResult> {
  const options: LLMOptions = { ...selectModelOptions(req) };
  const r = await streamText(
    fullPrompt,
    callbacks.onText,
    options,
    undefined,
    callbacks.onReasoning,
  );
  return { provider: r.provider, model: r.model, latencyMs: r.latencyMs, text: "" };
}
