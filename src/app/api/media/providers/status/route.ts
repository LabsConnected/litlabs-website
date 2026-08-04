import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { MediaProviderId } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderStatus = {
  id: MediaProviderId;
  configured: boolean;
  model?: string;
  region?: string;
};

/**
 * GET /api/media/providers/status
 *
 * Returns configuration status for all image providers WITHOUT
 * exposing secrets. Image Studio uses this to enable/disable
 * provider buttons dynamically instead of hardcoding ready:false.
 */
export async function GET(req: Request) {
  const { userId } = await auth(req as never);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const providers: ProviderStatus[] = [
    {
      id: "gemini",
      configured: !!process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image",
    },
    {
      id: "alibaba",
      configured:
        !!process.env.ALIBABA_DASHSCOPE_API_KEY &&
        !!process.env.ALIBABA_MODELSTUDIO_WORKSPACE_ID,
      region: process.env.ALIBABA_MODELSTUDIO_REGION || "ap-southeast-1",
      model: process.env.ALIBABA_IMAGE_MODEL || "qwen-image-2.0",
    },
    {
      id: "cloudflare",
      configured:
        !!process.env.CLOUDFLARE_ACCOUNT_ID &&
        !!process.env.CLOUDFLARE_AI_API_TOKEN,
      model:
        process.env.CLOUDFLARE_IMAGE_MODEL ||
        "@cf/black-forest-labs/flux-1-schnell",
    },
    {
      id: "fal",
      configured: !!process.env.FAL_KEY,
    },
    {
      id: "together",
      configured: !!process.env.TOGETHER_API_KEY,
    },
    {
      id: "openai",
      configured: !!process.env.OPENAI_API_KEY,
    },
    {
      id: "recraft",
      configured: !!process.env.RECRAFT_API_KEY,
    },
    {
      id: "pollinations",
      configured: true, // always available, no key needed
    },
    {
      id: "huggingface",
      configured: !!process.env.HUGGING_FACE_API_KEY,
    },
  ];

  return NextResponse.json(
    { providers },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
