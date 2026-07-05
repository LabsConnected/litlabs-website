/**
 * LiTTree SocialPilot — prompt templates for content generation.
 *
 * Uses OpenRouter via the existing LLM client. The system prompt
 * captures brand voice and platform-specific rules so a single
 * generate call returns all seven platform variants.
 */

export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "tiktok",
  "reddit",
  "bluesky",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X / Twitter",
  tiktok: "TikTok",
  reddit: "Reddit",
  bluesky: "Bluesky",
};

/** Core system prompt injected into every generation call. */
export function buildSocialPilotSystemPrompt(brand: {
  name: string;
  voice: string;
  target_audience: string;
  main_offers: string[];
}): string {
  return `You are LiTTree SocialPilot, the social media growth agent for ${brand.name}.

Your job is to create platform-specific content that promotes AI agents, AI website building, social media tools, creative apps, marketplace features, music tools, game tools, and the LiTTree brand.

Brand voice:
${brand.voice || `- Futuristic
- High-energy
- Founder-led
- Cyberpunk AI lab
- Direct and exciting
- Not corporate
- Built for creators, builders, entrepreneurs, and AI users`}

Target audience: ${brand.target_audience || "Creators, builders, entrepreneurs, AI enthusiasts"}

Key offers / features:
${brand.main_offers?.length ? brand.main_offers.map((o) => `- ${o}`).join("\n") : "- AI-powered creator operating system\n- Social distribution platform\n- Digital marketplace\n- Creative studio with image/video/audio/code generation\n- Multi-agent AI system"}

Rules:
- Never sound generic or corporate.
- Make each platform version genuinely unique in tone and format.
- LinkedIn: more polished, thought-leadership style.
- X: short, punchy, 280 chars max. Hook + value + CTA.
- Instagram: visual, hype-focused, use line breaks.
- Facebook: conversational, community-building.
- TikTok: write a short energetic video script (hook + body + CTA).
- Reddit: authentic, value-first, avoid sounding like an ad.
- Bluesky: casual, community-first, tech-savvy audience.
- Include a strong CTA in every post.
- Include 3-5 hashtags only where the platform uses them (Instagram, X, TikTok, LinkedIn).
- Include ONE image prompt for the whole campaign.

IMPORTANT: Respond ONLY with valid JSON. No markdown fences, no explanation.`;
}

/** The user prompt that triggers multi-platform generation. */
export function buildGeneratePrompt(context: {
  pageContent: string;
  topic?: string;
  campaignGoal?: string;
}): string {
  const topic = context.topic
    ? `\nFocus topic: ${context.topic}`
    : "";
  const goal = context.campaignGoal
    ? `\nCampaign goal: ${context.campaignGoal}`
    : "";

  return `Based on this website content, generate social media posts for all 7 platforms.
${topic}${goal}

Website content:
---
${context.pageContent.slice(0, 6000)}
---

Return a JSON object with this exact shape:
{
  "image_prompt": "A single image generation prompt for this campaign",
  "posts": {
    "facebook": { "caption": "...", "hashtags": [] },
    "instagram": { "caption": "...", "hashtags": ["#tag1", "#tag2"] },
    "linkedin": { "caption": "...", "hashtags": ["#tag1"] },
    "x": { "caption": "...", "hashtags": ["#tag1"] },
    "tiktok": { "caption": "...", "hashtags": ["#tag1"] },
    "reddit": { "caption": "...", "hashtags": [] },
    "bluesky": { "caption": "...", "hashtags": [] }
  }
}`;
}

/** Prompt for site scanning / brand extraction. */
export function buildScanPrompt(htmlContent: string): string {
  return `Analyze this website and extract brand information. Return ONLY valid JSON, no markdown.

Website HTML:
---
${htmlContent.slice(0, 8000)}
---

Return JSON:
{
  "name": "Brand name",
  "voice": "Brand voice description (2-3 sentences)",
  "target_audience": "Who this is for",
  "main_offers": ["offer 1", "offer 2", "offer 3"],
  "summary": "One paragraph summary of what this site does"
}`;
}
