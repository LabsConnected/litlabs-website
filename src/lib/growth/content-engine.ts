/**
 * Growth Engine — Content Engine.
 *
 * Generates platform-native content for one provider from a campaign's
 * event_summary. Same underlying event → completely different presentation
 * per platform. This is the core differentiator vs. a scheduler.
 *
 * Uses the existing OpenRouter LLM client pattern (src/lib/llm-completion.ts).
 * In 1a, content is generated as text only (no media). Semantic dedup is
 * deferred to 1b; a string-similarity check guards against exact duplicates.
 */

import "server-only";

import { complete } from "@/lib/llm-completion";
import type { GrowthCampaign, GrowthProviderId } from "./types";

export interface GeneratedContent {
  provider: GrowthProviderId;
  content: string;
  contentType: "text" | "thread" | "link" | "gallery";
}

/**
 * Generate platform-native content for a single provider.
 */
export async function generateContent(
  campaign: GrowthCampaign,
  provider: GrowthProviderId,
): Promise<GeneratedContent> {
  const prompt = buildPrompt(campaign, provider);
  const result = await complete({
    provider: "openrouter",
    model: "google/gemini-2.5-flash",
    prompt,
    maxTokens: 800,
    temperature: 0.7,
  });
  const content = result.text.trim();
  const contentType = inferContentType(provider, content);
  return { provider, content, contentType };
}

/**
 * Generate content for all target providers of a campaign in parallel.
 */
export async function generateAllContent(
  campaign: GrowthCampaign,
): Promise<GeneratedContent[]> {
  const providers = campaign.target_providers;
  const results = await Promise.all(
    providers.map((p) => generateContent(campaign, p).catch(() => null)),
  );
  return results.filter((r): r is GeneratedContent => r !== null);
}

// ─── Prompt construction ────────────────────────────────────────

function buildPrompt(campaign: GrowthCampaign, provider: GrowthProviderId): string {
  const platformGuidance = PLATFORM_GUIDANCE[provider] ?? "";
  const objective = campaign.objective ?? "general";

  return `You are a growth marketer writing platform-native social content.

CAMPAIGN
Name: ${campaign.name}
Objective: ${objective}
Event: ${campaign.event_summary}

PLATFORM: ${provider}

${platformGuidance}

RULES
- Write content NATIVE to ${provider}. Do not cross-post the same text.
- Be honest. No hype words ("game-changer", "revolutionary"). No fake claims.
- No emoji spam. One emoji max if it fits naturally.
- Do not promise features that aren't in the event summary.
- Output ONLY the post text. No preamble, no "Here is your post:", no quotes around it.

OUTPUT FORMAT
${OUTPUT_FORMAT[provider] ?? "Plain text post."}`;
}

const PLATFORM_GUIDANCE: Record<GrowthProviderId, string> = {
  x: `Write a punchy X post (≤280 characters). Lead with a hook. If announcing a feature, show the value in one line. If a demo/video exists, reference it. A short thread (2-3 tweets) is acceptable if needed — separate tweets with "---TWEET---".`,
  reddit: `Write a Reddit post in a build-in-public founder voice. Start with "I've been building..." or similar. Be technical and honest. Explain what it does and why. Ask for feedback/criticism. First line = title (no more than ~100 chars). Then a blank line, then the body. Do NOT include a subreddit name.`,
  hackernews: `Write a "Show HN" submission. Format: "Show HN: <Product Name> – <one-line description>". Then a short comment (2-3 paragraphs) explaining what it is, the technical approach, and what feedback you want. Be concise and technical. No marketing language.`,
  producthunt: `Write Product Hunt launch assets. Use this exact format:
TAGLINE: <one punchy line, ≤60 chars>
DESCRIPTION: <2-3 paragraphs describing the product, what problem it solves, who it's for>
MAKER COMMENT: <a personal first-comment to post after launch — thank people, share the story of why you built it>`,
};

const OUTPUT_FORMAT: Record<GrowthProviderId, string> = {
  x: "The post text (or tweets separated by ---TWEET---). No quotes.",
  reddit: "First line: the title. Blank line. Then: the post body.",
  hackernews: 'First line: "Show HN: ...". Blank line. Then: the comment body.',
  producthunt:
    "TAGLINE: ...\n\nDESCRIPTION: ...\n\nMAKER COMMENT: ...",
};

function inferContentType(
  provider: GrowthProviderId,
  content: string,
): "text" | "thread" | "link" | "gallery" {
  if (provider === "x" && content.includes("---TWEET---")) return "thread";
  if (provider === "hackernews" && /https?:\/\//i.test(content)) return "link";
  return "text";
}

// ─── Duplicate detection (string similarity, 1a) ────────────────

/**
 * Check whether new content is too similar to existing approved content
 * for the same campaign. Uses a simple Jaccard similarity on word sets.
 * Semantic dedup (embeddings) is deferred to 1b.
 */
export function isDuplicate(
  newText: string,
  existingTexts: string[],
  threshold = 0.85,
): boolean {
  const newWords = new Set(tokenize(newText));
  for (const existing of existingTexts) {
    const existingWords = new Set(tokenize(existing));
    const sim = jaccard(newWords, existingWords);
    if (sim >= threshold) return true;
  }
  return false;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
