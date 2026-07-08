// Shared agent metadata for homepage, marketplace, and detail pages
export interface AgentDetail {
  id: string;
  slug: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  examples: string[];
  color: string;
  emoji: string;
  rating: number;
  installs: number;
  personality: string;
}

export const CORE_AGENTS: AgentDetail[] = [
  {
    id: "1",
    slug: "director",
    name: "LiTTree",
    role: "Core AI Copilot & Navigator",
    description:
      "The main AI brain of LiTTree OS. Routes tasks across your entire agent workforce, remembers your projects, and ships alongside you from idea to deployment.",
    capabilities: [
      "Natural-language task routing",
      "Project memory across sessions",
      "Build, deploy, and connect workflows",
      "General strategy and planning",
      "Agent orchestration",
    ],
    examples: [
      "Build a landing page for my new product",
      "Connect Stripe and set up the pricing flow",
      "Summarize what I shipped last week",
      "Route this to the best agent for the job",
    ],
    color: "#22d3ee",
    emoji: "🤖",
    rating: 4.9,
    installs: 12400,
    personality: "Direct, technical, action-oriented",
  },
  {
    id: "2",
    slug: "forge",
    name: "Forge",
    role: "Engineer & Architect",
    description:
      "Senior engineer that writes, reviews, and ships production-ready code. Thinks in systems, catches security issues, and adapts to your stack.",
    capabilities: [
      "Full-stack code generation",
      "API and database design",
      "Debugging and refactoring",
      "Security and performance review",
      "DevOps and deployment scripts",
    ],
    examples: [
      "Create a Next.js API route with Supabase RLS",
      "Debug this TypeScript error",
      "Set up a Stripe webhook handler",
      "Review my React component for performance",
    ],
    color: "#a3f546",
    emoji: "⚡",
    rating: 4.8,
    installs: 8900,
    personality: "Precise, opinionated, ships fast",
  },
  {
    id: "3",
    slug: "pixel-forge",
    name: "Visionary",
    role: "Creative Director & Visual AI",
    description:
      "Crafts image prompts, brand identities, UI direction, and visual campaigns. Bridges the gap between 'something cool' and a prompt that produces exactly that.",
    capabilities: [
      "Prompt engineering for image generation",
      "Brand identity and color palettes",
      "UI/UX direction and feedback",
      "Album art, social assets, logos",
      "Moodboards and visual storytelling",
    ],
    examples: [
      "Generate a cyberpunk album cover",
      "Design a brand palette for my startup",
      "Create a scroll-stopping Instagram visual",
      "Critique my landing page layout",
    ],
    color: "#e879f9",
    emoji: "🎨",
    rating: 4.8,
    installs: 7200,
    personality: "Visually fluent, warm, inspiring",
  },
  {
    id: "4",
    slug: "social-pilot",
    name: "SocialPilot",
    role: "Social Media Growth",
    description:
      "Platform-native content agent for Instagram, X, TikTok, LinkedIn, Reddit, and Bluesky. Plans calendars, writes hooks, and grows your audience.",
    capabilities: [
      "Platform-specific content calendars",
      "Hook writing and copy editing",
      "Hashtag and trend research",
      "Posting schedules and cadence",
      "Audience growth tactics",
    ],
    examples: [
      "Write a week's worth of X posts",
      "Create a TikTok script for my product",
      "Plan a LinkedIn thought-leadership series",
      "Turn this blog post into a carousel",
    ],
    color: "#fb923c",
    emoji: "📱",
    rating: 4.7,
    installs: 5400,
    personality: "Energetic, native, platform-savvy",
  },
  {
    id: "5",
    slug: "data-slayer",
    name: "Data Slayer",
    role: "Analytics & Insights",
    description:
      "Turns raw numbers into actionable decisions. Interprets metrics, builds dashboards, and tells you the 'so what' behind the data.",
    capabilities: [
      "Metric interpretation and reporting",
      "Cohort and retention analysis",
      "Dashboard suggestions",
      "A/B test design and readouts",
      "Correlation vs causation checks",
    ],
    examples: [
      "Explain why my churn spiked last week",
      "Build a KPI dashboard for my app",
      "Design an A/B test for the pricing page",
      "What metrics should I track pre-launch?",
    ],
    color: "#fbbf24",
    emoji: "📊",
    rating: 4.8,
    installs: 4800,
    personality: "Curious, skeptical, clarity-driven",
  },
  {
    id: "6",
    slug: "music-producer",
    name: "Music Producer",
    role: "Audio & Sound",
    description:
      "Composition, mixing, and sound design on demand. Helps with tracks, prompts for audio models, and sonic branding.",
    capabilities: [
      "Music composition guidance",
      "Sound design and mixing notes",
      "Prompts for audio AI models",
      "Sonic branding",
      "Loop and sample direction",
    ],
    examples: [
      "Write a prompt for an upbeat lo-fi track",
      "Design a sound logo for my brand",
      "Plan the structure of an electronic EP",
      "Suggest mixing fixes for this demo",
    ],
    color: "#a78bfa",
    emoji: "🎵",
    rating: 4.7,
    installs: 4100,
    personality: "Musical, detail-oriented, creative",
  },
];

export const AGENTS_BY_SLUG: Record<string, AgentDetail> = Object.fromEntries(
  CORE_AGENTS.map((a) => [a.slug, a])
);
