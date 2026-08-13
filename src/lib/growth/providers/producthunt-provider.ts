/**
 * Product Hunt provider — MANUAL mode (Phase 1a).
 *
 * Product Hunt API v2 write access requires app approval and verified
 * maker status. In 1a, prepare() returns the launch assets (tagline,
 * description, maker comment) formatted for manual submission.
 *
 * The compose URL points to Product Hunt's submit page. The clipboard
 * payload carries the full formatted copy.
 */

import "server-only";

import type {
  GrowthProvider,
  PrepareInput,
  PreparedPost,
  ProviderHealth,
} from "../types";

export const ProductHuntProvider: GrowthProvider = {
  id: "producthunt",
  label: "Product Hunt",
  mode: "manual",

  async validate(): Promise<ProviderHealth> {
    return { healthy: true, mode: "manual" };
  },

  async prepare(input: PrepareInput): Promise<PreparedPost> {
    const { tagline, description, makerComment } = parsePhAssets(input.content);
    const composeUrl = "https://www.producthunt.com/posts/new";

    const clipboardPayload = [
      `TAGLINE: ${tagline}`,
      "",
      "DESCRIPTION:",
      description,
      "",
      "MAKER COMMENT (post as first comment after launch):",
      makerComment,
    ].join("\n");

    return {
      provider: "producthunt",
      platformLabel: "Product Hunt",
      text: input.content,
      composeUrl,
      clipboardPayload,
      notes:
        "Prepare the launch assets but do NOT submit until you're ready to launch. " +
        "Product Hunt launches can only happen once — timing matters. " +
        "Post the maker comment as the first comment after the product goes live.",
    };
  },
};

/**
 * Parse PH-formatted content into tagline / description / maker comment.
 * Expects the content engine to produce sections labeled TAGLINE, DESCRIPTION,
 * MAKER COMMENT. Falls back to line-based splitting if labels are absent.
 */
function parsePhAssets(content: string): {
  tagline: string;
  description: string;
  makerComment: string;
} {
  const taglineMatch = content.match(/TAGLINE:\s*(.+)/i);
  const descMatch = content.match(/DESCRIPTION:\s*([\s\S]*?)(?=MAKER COMMENT:|$)/i);
  const makerMatch = content.match(/MAKER COMMENT:\s*([\s\S]*)/i);

  if (taglineMatch || descMatch || makerMatch) {
    return {
      tagline: (taglineMatch?.[1] ?? "").trim().slice(0, 60),
      description: (descMatch?.[1] ?? "").trim(),
      makerComment: (makerMatch?.[1] ?? "").trim(),
    };
  }

  // Fallback: first line = tagline, rest = description, no maker comment.
  const lines = content.split("\n").filter((l) => l.trim());
  return {
    tagline: (lines[0] ?? "").trim().slice(0, 60),
    description: lines.slice(1).join("\n").trim(),
    makerComment: "",
  };
}
