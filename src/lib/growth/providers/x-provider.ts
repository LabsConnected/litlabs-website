/**
 * X (Twitter) provider — MANUAL mode (Phase 1a).
 *
 * prepare() returns the final text + a Twitter compose URL with the
 * text pre-filled. The user opens the link, reviews, and posts by hand.
 *
 * Forward-compatible: when this provider flips to api mode (1b+),
 * publish() will call POST /2/tweets with an OAuth bearer token
 * resolved from Supabase Vault. The prepare() output stays the same.
 */

import "server-only";

import type {
  GrowthProvider,
  PrepareInput,
  PreparedPost,
  ProviderHealth,
} from "../types";

export const XProvider: GrowthProvider = {
  id: "x",
  label: "X (Twitter)",
  mode: "manual",

  async validate(): Promise<ProviderHealth> {
    return { healthy: true, mode: "manual" };
  },

  async prepare(input: PrepareInput): Promise<PreparedPost> {
    // X compose URL with text pre-filled.
    // twitter.com/compose/post?text=... opens the compose dialog.
    const text = input.utmUrl
      ? appendUtmIfLinkPresent(input.content, input.utmUrl)
      : input.content;
    const composeUrl = `https://twitter.com/compose/post?text=${encodeURIComponent(text)}`;

    return {
      provider: "x",
      platformLabel: "X (Twitter)",
      text,
      composeUrl,
      clipboardPayload: text,
      notes:
        "Open the compose link, review the post, and click Post. " +
        "If the text is too long, split into a thread (first tweet as hook).",
    };
  },
};

/**
 * If the content already contains a link, leave it. If not and a UTM URL
 * is provided, append it. This keeps the post natural rather than
 * double-linking.
 */
function appendUtmIfLinkPresent(content: string, utmUrl: string): string {
  const hasLink = /https?:\/\//i.test(content);
  if (hasLink) return content;
  return `${content}\n\n${utmUrl}`;
}
