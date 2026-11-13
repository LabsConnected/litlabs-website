/**
 * LiTT Web Search Tool
 *
 * Combines user context, permission gate, and the web search providers
 * into a single callable tool — mirrors the weather-tool pattern.
 *
 * Provider order:
 *  1. Brave Search (web-search-provider) when BRAVE_SEARCH_API_KEY is set.
 *  2. The shared keyless implementation — the tool registry's `web.search`
 *     / `web.fetch` handlers, which delegate to @litt/agent-core
 *     (DuckDuckGo Instant Answers + SSRF-safe fetch). This is the ONE
 *     implementation the rest of the codebase standardized on
 *     (see capabilities.ts: "No API keys, no per-user wiring — always
 *     available wherever the loop runs"). Before this fallback existed,
 *     the chat realtime path silently returned "not executed" whenever
 *     the Brave key was absent, so the in-Studio agent had NO working
 *     web tool in chat at all and honestly answered that it could not
 *     browse — while the keyless tool sat registered but unreachable
 *     outside the V2 workspace loop.
 */

import "server-only";
import type { UserContext } from "./user-context";
import { checkPermission, recordToolCall } from "./permission-gate";
import {
  searchWeb,
  formatSearchResults,
  isWebSearchAvailable,
  type WebSearchResponse,
} from "./web-search-provider";

export type WebSearchToolResponse =
  | {
      success: true;
      data: WebSearchResponse;
      formatted: string;
      provider: "brave_search" | "duckduckgo";
    }
  | {
      success: false;
      error: string;
    };

export type WebFetchToolResponse =
  | {
      success: true;
      formatted: string;
      provider: "agent_core_safe_fetch";
    }
  | {
      success: false;
      error: string;
    };

/** Shape of @litt/agent-core's webSearch result (WebSearchResult). */
interface CoreWebSearchResult {
  query: string;
  answer: string | null;
  abstract: string | null;
  abstractSource: string | null;
  abstractUrl: string | null;
  relatedTopics: Array<{ text: string; url?: string }>;
  empty: boolean;
}

/** Shape of @litt/agent-core's safeFetch result (SafeFetchResult). */
interface CoreSafeFetchResult {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  content: string;
  truncated: boolean;
}

/**
 * Format the keyless (DuckDuckGo Instant Answers) result for direct
 * display, WITH source URLs so the answer cites where it came from.
 */
export function formatCoreSearchResults(result: CoreWebSearchResult): string {
  const lines: string[] = [];

  if (result.answer) {
    lines.push(result.answer);
  }

  if (result.abstract) {
    if (lines.length > 0) lines.push("");
    const source = result.abstractSource ?? "source";
    lines.push(result.abstract);
    if (result.abstractUrl) {
      lines.push(`— ${source}: ${result.abstractUrl}`);
    }
  }

  if (result.relatedTopics.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Related sources:");
    for (const topic of result.relatedTopics.slice(0, 5)) {
      lines.push(topic.url ? `• ${topic.text} (${topic.url})` : `• ${topic.text}`);
    }
  }

  if (lines.length === 0) {
    return `I searched the web for "${result.query}" but found no instant answer or sources to cite. Try rephrasing the question or naming a specific site.`;
  }

  return lines.join("\n");
}

/**
 * Execute a registry realtime-internet tool (`web.search` / `web.fetch`)
 * through the canonical ToolRegistry — the same lazy-import pattern the
 * V1 agent loop uses (agent-loop.ts) to avoid an import cycle. The
 * registry enforces the tool's declared capabilities; the resolver is
 * the single source of truth for what this deployment can satisfy.
 */
async function executeRegistryWebTool(
  toolId: "web.search" | "web.fetch",
  inputs: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const [{ toolRegistry }, { resolveAvailableCapabilities }] = await Promise.all([
    import("./tool-registry"),
    import("./capabilities"),
  ]);
  return toolRegistry.execute(toolId, inputs, {
    hasApproval: true, // read-only tools auto-approve (agent-loop.ts precedent)
    availableCapabilities: resolveAvailableCapabilities(),
  });
}

/** Keyless web search via the shared @litt/agent-core implementation. */
async function executeCoreWebSearch(
  ctx: UserContext,
  query: string,
): Promise<WebSearchToolResponse> {
  try {
    const res = await executeRegistryWebTool("web.search", { query });
    if (!res.ok) {
      await recordToolCall(ctx.userId, {
        capabilityId: "web.search",
        provider: "duckduckgo",
        action: "web.search",
        success: false,
        inputSummary: { query },
        outputSummary: { error: res.error },
      });
      return { success: false, error: res.error };
    }

    const core = res.result as CoreWebSearchResult;
    const formatted = formatCoreSearchResults(core);

    await recordToolCall(ctx.userId, {
      capabilityId: "web.search",
      provider: "duckduckgo",
      action: "web.search",
      success: true,
      inputSummary: { query },
      outputSummary: { resultCount: core.relatedTopics.length + (core.abstract ? 1 : 0) },
    });

    // Adapt to the Brave-shaped data contract existing callers read.
    const data: WebSearchResponse = {
      query,
      fetchedAt: Date.now(),
      results: [
        ...(core.abstract
          ? [
              {
                title: core.abstractSource ?? "Web result",
                url: core.abstractUrl ?? "",
                description: core.abstract,
              },
            ]
          : []),
        ...core.relatedTopics.map((t) => ({
          title: t.text.slice(0, 120),
          url: t.url ?? "",
          description: t.text,
        })),
      ],
    };

    return { success: true, data, formatted, provider: "duckduckgo" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Web search failed";
    await recordToolCall(ctx.userId, {
      capabilityId: "web.search",
      provider: "duckduckgo",
      action: "web.search",
      success: false,
      inputSummary: { query },
      outputSummary: { error: message },
    });
    return { success: false, error: message };
  }
}

export async function executeWebSearch(
  ctx: UserContext,
  query: string,
): Promise<WebSearchToolResponse> {
  const perm = checkPermission(ctx, "web.search");
  if (!perm.allowed) {
    return { success: false, error: perm.message };
  }

  // Keyless fallback FIRST-CLASS: when no Brave key is configured, use
  // the shared agent-core search instead of reporting search unavailable.
  if (!isWebSearchAvailable()) {
    return executeCoreWebSearch(ctx, query);
  }

  try {
    const result = await searchWeb(query);
    const formatted = formatSearchResults(result);

    await recordToolCall(ctx.userId, {
      capabilityId: "web.search",
      provider: "brave_search",
      action: "web.search",
      success: true,
      inputSummary: { query },
      outputSummary: { resultCount: result.results.length },
    });

    return { success: true, data: result, formatted, provider: "brave_search" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Web search failed";
    await recordToolCall(ctx.userId, {
      capabilityId: "web.search",
      provider: "brave_search",
      action: "web.search",
      success: false,
      inputSummary: { query },
      outputSummary: { error: message },
    });
    return { success: false, error: message };
  }
}

/** Max characters of fetched page content returned to chat. */
const WEB_FETCH_MAX_CHARS = 6000;

/**
 * Fetch a URL's content via the registry's SSRF-safe `web.fetch` tool
 * (agent-core safeFetch). Used by the chat realtime path when the user
 * asks LiTT to read a specific page.
 */
export async function executeWebFetch(
  ctx: UserContext,
  url: string,
): Promise<WebFetchToolResponse> {
  const perm = checkPermission(ctx, "web.fetch");
  if (!perm.allowed) {
    return { success: false, error: perm.message };
  }

  try {
    const res = await executeRegistryWebTool("web.fetch", { url });
    if (!res.ok) {
      await recordToolCall(ctx.userId, {
        capabilityId: "web.fetch",
        provider: "agent_core_safe_fetch",
        action: "web.fetch",
        success: false,
        inputSummary: { url },
        outputSummary: { error: res.error },
      });
      return { success: false, error: res.error };
    }

    const fetched = res.result as CoreSafeFetchResult;
    const content = (fetched.content ?? "").trim();
    const clipped =
      content.length > WEB_FETCH_MAX_CHARS
        ? `${content.slice(0, WEB_FETCH_MAX_CHARS)}\n… [truncated]`
        : content;

    await recordToolCall(ctx.userId, {
      capabilityId: "web.fetch",
      provider: "agent_core_safe_fetch",
      action: "web.fetch",
      success: true,
      inputSummary: { url },
      outputSummary: { status: fetched.status, chars: content.length },
    });

    return {
      success: true,
      provider: "agent_core_safe_fetch",
      formatted: content
        ? `Content from ${fetched.url} (HTTP ${fetched.status}):\n\n${clipped}`
        : `I fetched ${fetched.url} (HTTP ${fetched.status}) but it returned no readable text content.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Web fetch failed";
    await recordToolCall(ctx.userId, {
      capabilityId: "web.fetch",
      provider: "agent_core_safe_fetch",
      action: "web.fetch",
      success: false,
      inputSummary: { url },
      outputSummary: { error: message },
    });
    return { success: false, error: message };
  }
}
