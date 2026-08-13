/**
 * Hacker News provider — MANUAL mode (Phase 1a).
 *
 * HN has no authenticated write API — manual submission is the only
 * honest path (and will remain so even in API mode for other providers).
 *
 * prepare() formats the content as a "Show HN" submission and returns
 * the HN submit URL. The user posts by hand.
 */

import "server-only";

import type {
  GrowthProvider,
  PrepareInput,
  PreparedPost,
  ProviderHealth,
} from "../types";

export const HackernewsProvider: GrowthProvider = {
  id: "hackernews",
  label: "Hacker News",
  mode: "manual",

  async validate(): Promise<ProviderHealth> {
    return { healthy: true, mode: "manual" };
  },

  async prepare(input: PrepareInput): Promise<PreparedPost> {
    const { title, url } = parseShowHn(input.content, input.utmUrl);
    // HN submit accepts ?u=URL&t=title
    const params = new URLSearchParams();
    if (url) params.set("u", url);
    params.set("t", title);
    const composeUrl = `https://news.ycombinator.com/submit?${params.toString()}`;

    return {
      provider: "hackernews",
      platformLabel: "Hacker News",
      text: input.content,
      composeUrl,
      clipboardPayload: input.content,
      notes:
        "Submit as a 'Show HN' post. If the content has a URL, use the URL field; " +
        "otherwise submit as a text post with the body as the first comment. " +
        "HN has no API — you must submit manually.",
    };
  },
};

/**
 * Parse content into an HN title + optional URL.
 * Expects "Show HN: <name> – <tagline>" format, optionally with a URL.
 */
function parseShowHn(
  content: string,
  utmUrl?: string,
): { title: string; url?: string } {
  const firstLine = content.split("\n")[0]?.trim() ?? content.trim();
  // If the first line contains a URL, extract it.
  const urlMatch = firstLine.match(/(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    const url = urlMatch[1];
    const title = firstLine.replace(url, "").replace(/\s+[-–—]\s*$/, "").trim();
    return { title: title.slice(0, 80) || "Show HN", url };
  }
  // No URL in content — use the UTM URL if provided.
  const title = firstLine.slice(0, 80);
  return { title, url: utmUrl };
}
