/**
 * OpenAI native function-name compatibility boundary.
 *
 * PROBLEM
 *   LiTT's canonical ToolRegistry IDs use dotted names (e.g. `project.status`,
 *   `project.build`, `project.run`). Those are valid internally but INVALID as
 *   OpenAI function names. OpenAI requires:
 *
 *     ^[a-zA-Z0-9_-]+$   and   length <= 64
 *
 *   Sending `project.status` produces:
 *     400 Invalid 'tools[0].function.name': string does not match pattern.
 *
 * FIX (provider boundary — do NOT rename canonical tools)
 *   canonical LiTT ID  ->  OpenAI-safe function name
 *     project.status   ->  project_status
 *     project.run      ->  project_run
 *
 *   And the reverse on the way back: when OpenAI calls `project_status`,
 *   map it back to `project.status` before ToolRegistry.execute() so the
 *   agent loop's single parser still sees the canonical ID.
 *
 * This module is the ONE place that translation happens. Both the
 * OpenRouterModelProvider and OpenAICompatibleModelProvider adapters use it
 * because both serialize to the OpenAI-compatible `tools` request field and
 * both parse native `tool_calls` responses.
 */

import type { ToolDefinition } from "@litt/agent-core";

/** OpenAI's required pattern for function names. */
export const OPENAI_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** OpenAI's maximum function-name length. */
export const MAX_OPENAI_NAME_LEN = 64;

/**
 * Sanitize a canonical LiTT tool ID into an OpenAI-safe function name.
 *
 * Replaces every character that is not `A-Z a-z 0-9 _ -` with `_`.
 *   project.status   ->  project_status
 *   project.run      ->  project_run
 *   namespace:foo    ->  namespace_foo
 *   a/b/c            ->  a_b_c
 *
 * Does NOT truncate or validate length here — `buildOpenAiToolNameMap`
 * performs the length + collision checks once for the whole tool set.
 * Kept pure so it is trivially testable.
 */
export function sanitizeOpenAiToolName(canonicalId: string): string {
  return canonicalId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Reverse mapping table: OpenAI-safe function name -> canonical LiTT tool ID.
 *
 * Built once per provider construction so native `tool_calls` responses can
 * be translated back to the canonical ID the ToolRegistry expects.
 */
export interface OpenAiToolNameMap {
  /** canonical LiTT ID -> OpenAI-safe function name (outgoing request). */
  readonly forward: ReadonlyMap<string, string>;
  /** OpenAI-safe function name -> canonical LiTT ID (incoming tool_calls). */
  readonly reverse: ReadonlyMap<string, string>;
}

/** Error thrown when a set of tools cannot be safely mapped to OpenAI names. */
export class OpenAiToolNameMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAiToolNameMappingError";
  }
}

/**
 * Build the bidirectional name map for a set of tools, failing deterministically
 * BEFORE any API request when:
 *   - two canonical IDs sanitize to the same OpenAI name (collision), or
 *   - a sanitized name still does not match `^[a-zA-Z0-9_-]+$` (should be
 *     impossible after sanitizeOpenAiToolName, but defended anyway), or
 *   - a sanitized name exceeds 64 characters.
 *
 * Collisions are fatal rather than silently routing to the wrong tool: if
 * `foo.bar` and `foo_bar` both map to `foo_bar`, the model's call could
 * dispatch to either — we refuse to construct the request instead.
 */
export function buildOpenAiToolNameMap(
  tools: readonly ToolDefinition[],
): OpenAiToolNameMap {
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();

  for (const tool of tools) {
    const canonical = tool.id;
    if (!canonical || typeof canonical !== "string") {
      throw new OpenAiToolNameMappingError(
        `Tool has an invalid canonical id: ${JSON.stringify(canonical)}`,
      );
    }
    const openaiName = sanitizeOpenAiToolName(canonical);

    if (!OPENAI_NAME_RE.test(openaiName)) {
      throw new OpenAiToolNameMappingError(
        `Sanitized OpenAI function name "${openaiName}" (from "${canonical}") ` +
          `does not match required pattern ^[a-zA-Z0-9_-]+$.`,
      );
    }
    if (openaiName.length > MAX_OPENAI_NAME_LEN) {
      throw new OpenAiToolNameMappingError(
        `Sanitized OpenAI function name "${openaiName}" (from "${canonical}") ` +
          `exceeds the ${MAX_OPENAI_NAME_LEN} character limit ` +
          `(length=${openaiName.length}).`,
      );
    }

    const priorCanonical = reverse.get(openaiName);
    if (priorCanonical !== undefined && priorCanonical !== canonical) {
      // Collision: two distinct canonical IDs sanitize to the same OpenAI
      // name. Routing the model's call would be ambiguous — fail closed.
      throw new OpenAiToolNameMappingError(
        `OpenAI function name collision: canonical tool IDs ` +
          `"${priorCanonical}" and "${canonical}" both sanitize to ` +
          `"${openaiName}". Refusing to send an ambiguous tool set to OpenAI.`,
      );
    }

    forward.set(canonical, openaiName);
    reverse.set(openaiName, canonical);
  }

  return { forward, reverse };
}

/**
 * Resolve an incoming native `tool_calls` function name back to the canonical
 * LiTT tool ID. Falls back to the raw name when no mapping is known so the
 * agent loop can still surface the call (and a clear "unknown tool" error)
 * rather than silently dropping it.
 */
export function resolveCanonicalToolId(
  openaiName: string,
  map: OpenAiToolNameMap | null,
): string {
  if (map) {
    const canonical = map.reverse.get(openaiName);
    if (canonical !== undefined) return canonical;
  }
  return openaiName;
}

/**
 * OpenAI-compatible native function schema (the `tools` request field).
 * Mirrors the shape both adapters already serialize.
 */
export interface NativeToolSchema {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Convert LiTT ToolDefinitions into OpenAI-compatible `tools` schemas with
 * sanitized function names. Throws (via buildOpenAiToolNameMap) on collision
 * or invalid names — never emits an invalid outgoing tool.
 *
 * Returns `{ schemas, map }` so the caller can keep the reverse map for
 * incoming tool_calls translation.
 */
export function toOpenAiToolSchemas(
  tools: readonly ToolDefinition[],
): { schemas: NativeToolSchema[]; map: OpenAiToolNameMap } {
  const map = buildOpenAiToolNameMap(tools);
  const schemas: NativeToolSchema[] = tools.map((t) => ({
    type: "function",
    function: {
      name: map.forward.get(t.id)!,
      description: t.description,
      parameters: (t.inputSchema ?? { type: "object", properties: {} }) as Record<
        string,
        unknown
      >,
    },
  }));
  return { schemas, map };
}
