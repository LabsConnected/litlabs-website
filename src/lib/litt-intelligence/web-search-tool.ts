/**
 * LiTT Web Search Tool
 *
 * Combines user context, permission gate, and the Brave Search provider
 * into a single callable tool — mirrors the weather-tool pattern.
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
    }
  | {
      success: false;
      error: string;
    };

export async function executeWebSearch(
  ctx: UserContext,
  query: string,
): Promise<WebSearchToolResponse> {
  const perm = checkPermission(ctx, "web.search");
  if (!perm.allowed) {
    return { success: false, error: perm.message };
  }

  if (!isWebSearchAvailable()) {
    return {
      success: false,
      error: "Web search is not available right now. The search API key is not configured.",
    };
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

    return { success: true, data: result, formatted };
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
