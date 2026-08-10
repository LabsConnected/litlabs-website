/**
 * LiTT Web Search Provider — Brave Search API
 *
 * Fetches real web search results from the Brave Search API.
 * Requires BRAVE_SEARCH_API_KEY environment variable.
 *
 * Capability: web.search
 */

import "server-only";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string | null;
}

export interface WebSearchResponse {
  results: WebSearchResult[];
  query: string;
  fetchedAt: number;
}

function getApiKey(): string | null {
  return process.env.BRAVE_SEARCH_API_KEY ?? null;
}

export function isWebSearchAvailable(): boolean {
  return getApiKey() !== null;
}

export async function searchWeb(
  query: string,
  count = 5,
): Promise<WebSearchResponse> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Web search is not configured. Set BRAVE_SEARCH_API_KEY.");
  }

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(count, 20)),
    country: "us",
    safesearch: "moderate",
  });

  const resp = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
    signal: AbortSignal.timeout(10000),
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!resp.ok) {
    throw new Error(`Web search failed: ${resp.status}`);
  }

  const data = (await resp.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        age?: string | null;
      }>;
    };
  };

  const results: WebSearchResult[] = (data.web?.results ?? [])
    .filter((r) => r.title && r.url)
    .slice(0, count)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      description: r.description ?? "",
      age: r.age ?? null,
    }));

  return {
    results,
    query,
    fetchedAt: Date.now(),
  };
}

export function formatSearchResults(
  response: WebSearchResponse,
  maxResults = 5,
): string {
  if (response.results.length === 0) {
    return `I searched for "${response.query}" but didn't find any results.`;
  }

  const lines: string[] = [`Here's what I found for "${response.query}":`];
  const shown = response.results.slice(0, maxResults);

  for (let i = 0; i < shown.length; i++) {
    const r = shown[i];
    lines.push(`\n${i + 1}. ${r.title}`);
    if (r.description) {
      lines.push(`   ${r.description.slice(0, 200)}`);
    }
    lines.push(`   ${r.url}`);
  }

  return lines.join("\n");
}
