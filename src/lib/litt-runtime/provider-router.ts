/**
 * LiTT Runtime — Provider Router
 *
 * Centralizes model/provider selection. The user may request a specific
 * provider/model, but "Auto Best" remains the default. Provider complexity
 * is not exposed unnecessarily — the router maps the request into the
 * existing LLMOptions contract consumed by @/lib/llm.
 */

import type { LLMOptions, LLMProvider, ModelCategory } from "@/lib/llm";
import type { LiTTRunRequest } from "./types";

const VALID_CATEGORIES: ModelCategory[] = ["auto", "free", "fast", "code", "creative", "vision", "byok"];

function isModelCategory(value: unknown): value is ModelCategory {
  return typeof value === "string" && (VALID_CATEGORIES as string[]).includes(value);
}

/**
 * Select LLM options for a run.
 *
 * Routing guidelines (mirrors the platform provider registry):
 *   - Gemini: everyday chat, vision, fast project questions, multimodal (default)
 *   - OpenAI: advanced reasoning, structured outputs, tool-heavy (via category/byok)
 *   - Claude: large codebase review, long-context code analysis (via byok)
 *   - Groq: fast lightweight responses, classification (via "fast")
 *
 * The actual failover chain lives in @/lib/llm; this router only decides
 * the options to pass.
 */
export function selectModelOptions(req: LiTTRunRequest): LLMOptions {
  const category = isModelCategory(req.category) ? req.category : "auto";
  const provider = typeof req.requestedProvider === "string"
    ? (req.requestedProvider as LLMProvider)
    : undefined;

  const modelOverride =
    typeof req.requestedModel === "string" && provider
      ? ({ [provider]: req.requestedModel } as Partial<Record<LLMProvider, string>>)
      : undefined;

  return {
    task: "chat",
    // When a category is chosen (not auto), let the category drive the chain
    // and don't pin a provider. When auto, honor an explicit provider pin.
    provider: category === "auto" ? provider : undefined,
    category,
    maxTokens: req.maxTokens ?? 2048,
    modelOverride,
  };
}

/**
 * Resolve the Gemini model id for the multimodal (image) path.
 * Falls back to gemini-2.5-flash when the requested model isn't a Gemini id.
 */
export function resolveGeminiVisionModel(req: LiTTRunRequest): string {
  return typeof req.requestedModel === "string" && req.requestedModel.startsWith("gemini")
    ? req.requestedModel
    : "gemini-2.5-flash";
}
