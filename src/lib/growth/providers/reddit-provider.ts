/**
 * Reddit provider — MANUAL mode (Phase 1a).
 *
 * prepare() splits the content into title + body (Reddit requires a
 * separate title) and returns a reddit.com/submit URL with title
 * pre-filled. The body is in the clipboard payload for pasting.
 *
 * Subreddit selection guidance is included in notes from
 * growth_rules.metadata.preferred_subreddits.
 */

import "server-only";

import type {
  GrowthProvider,
  PrepareInput,
  PreparedPost,
  ProviderHealth,
} from "../types";

export const RedditProvider: GrowthProvider = {
  id: "reddit",
  label: "Reddit",
  mode: "manual",

  async validate(): Promise<ProviderHealth> {
    return { healthy: true, mode: "manual" };
  },

  async prepare(input: PrepareInput): Promise<PreparedPost> {
    const { title, body } = splitTitleAndBody(input.content);
    const composeUrl = `https://www.reddit.com/submit?title=${encodeURIComponent(title)}`;

    const preferredSubreddits = readPreferredSubreddits(input.metadata);
    const notes = preferredSubreddits.length
      ? `Post to: r/${preferredSubreddits.join(", r/")}. Paste the body into the text field. Follow each subreddit's rules.`
      : "Choose an appropriate subreddit, paste the body into the text field, and follow the subreddit's rules.";

    return {
      provider: "reddit",
      platformLabel: "Reddit",
      text: input.content,
      composeUrl,
      // If there's no body (single-line post), use the full content so the
      // clipboard is never empty — the user still has something to paste.
      clipboardPayload: body || input.content,
      notes,
    };
  },
};

/**
 * Split content into a Reddit title (first line or first ~100 chars)
 * and body (the rest).
 */
function splitTitleAndBody(content: string): { title: string; body: string } {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { title: "", body: content };
  const firstLine = lines[0].trim();
  // Reddit titles max 300 chars; keep it punchy.
  const title = firstLine.slice(0, 300);
  const body = lines.length > 1 ? lines.slice(1).join("\n").trim() : "";
  return { title, body };
}

function readPreferredSubreddits(
  metadata?: Record<string, unknown>,
): string[] {
  if (!metadata) return [];
  const raw = metadata.preferred_subreddits;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string").slice(0, 5);
}
