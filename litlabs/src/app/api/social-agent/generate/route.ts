import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateJSON } from "@/lib/llm";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  buildSocialPilotSystemPrompt,
  buildGeneratePrompt,
  SOCIAL_PLATFORMS,
  SocialPlatform,
} from "@/lib/social-agent-prompts";

export const runtime = "nodejs";

type GenerateBody = {
  brandId?: string;
  topic?: string;
  campaignGoal?: string;
};

type GeneratedPost = {
  caption: string;
  hashtags: string[];
};

type GeneratedContent = {
  image_prompt: string;
  posts: Record<SocialPlatform, GeneratedPost>;
};

type BrandProfile = {
  id: string;
  name: string;
  voice: string;
  target_audience: string;
  main_offers: string[];
};

const DEFAULT_BRAND = {
  name: "LiTTree LabStudios",
  voice:
    "Futuristic, high-energy, founder-led, cyberpunk AI lab. Direct and exciting. Not corporate. Built for creators, builders, entrepreneurs, and AI users.",
  target_audience: "Creators, builders, entrepreneurs, AI enthusiasts",
  main_offers: [
    "AI-powered creator operating system",
    "Social distribution platform",
    "Digital marketplace",
    "Creative studio with image/video/audio/code generation",
    "Multi-agent AI system",
  ],
};

async function handler(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: GenerateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { brandId, topic, campaignGoal } = body;

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    let brand = DEFAULT_BRAND;
    if (brandId) {
      const { data: profile, error } = await supabaseAdmin
        .from("brand_profiles")
        .select("id, name, voice, target_audience, main_offers")
        .eq("id", brandId)
        .eq("user_id", userId)
        .single<BrandProfile>();

      if (!error && profile) {
        const offers = Array.isArray(profile.main_offers)
          ? profile.main_offers.filter((o): o is string => typeof o === "string")
          : DEFAULT_BRAND.main_offers;
        brand = { name: profile.name, voice: profile.voice, target_audience: profile.target_audience, main_offers: offers };
      }
    }

    const systemPrompt = buildSocialPilotSystemPrompt(brand);
    const userPrompt = buildGeneratePrompt({
      pageContent: brand.main_offers.join("\n"),
      topic,
      campaignGoal,
    });

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const result = await generateJSON<GeneratedContent>(fullPrompt, { task: "creative" });

    const { data: run, error: runError } = await supabaseAdmin
      .from("content_runs")
      .insert({
        brand_id: brandId ?? null,
        user_id: userId,
        prompt: fullPrompt,
        result,
        post_count: SOCIAL_PLATFORMS.length,
      })
      .select()
      .single();

    if (runError) throw runError;

    const posts = SOCIAL_PLATFORMS.map((platform) => {
      const post = result.posts[platform];
      return {
        brand_id: brandId ?? null,
        user_id: userId,
        platform,
        caption: post?.caption ?? "",
        image_prompt: result.image_prompt,
        hashtags: post?.hashtags ?? [],
        status: "draft" as const,
        run_id: run?.id,
      };
    });

    const { data: inserted, error: postsError } = await supabaseAdmin.from("social_posts").insert(posts).select();

    if (postsError) throw postsError;

    return NextResponse.json({ run, posts: inserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 10, 60);
