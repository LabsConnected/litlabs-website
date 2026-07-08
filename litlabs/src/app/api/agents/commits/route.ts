import { NextResponse } from "next/server";

const FALLBACK_COMMITS = [
  "d85ae75 feat: upgrade AgentTool (boardroom, markdown, rich cards)",
  "8226761 feat: remove top controls bar, move theme/CRT to profile card",
  "7f3a219 feat: merge social feed into home page center column",
  "6b1e4c0 feat: responsive design overhaul — fluid typography, safe areas",
  "5d92f8a feat: AnimatedBackground with holo orbs, aurora, particles",
  "4c87e3b fix: social/page.tsx redirect — resolve duplicate export error",
  "3a74d21 feat: gallery Lightbox component with keyboard nav",
  "2f65b10 feat: PageShell wrapper applied to all pages",
  "1e53a09 feat: Pollinations image generation (free, no key)",
  "0d41c97 feat: LiTBit Coins wallet with Supabase sync",
];

export async function GET() {
  // Serverless-safe: no execSync, no git binary dependency.
  // In a Vercel/deployed environment we cannot shell out to `git`.
  // For local self-hosted environments, an admin can wire a real git
  // log query through a service-role endpoint if needed.
  return NextResponse.json(FALLBACK_COMMITS);
}
