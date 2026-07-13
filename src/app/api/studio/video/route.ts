import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { withRateLimit } from "@/lib/rate-limiter";

const POLLINATIONS_VIDEO_BASE = "https://gen.pollinations.ai/video";

async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { prompt, model = "veo", duration = 4 } = body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return NextResponse.json(
        { error: "Prompt must be at least 3 characters" },
        { status: 400 },
      );
    }

    const url = `${POLLINATIONS_VIDEO_BASE}/${encodeURIComponent(prompt.trim())}?model=${encodeURIComponent(model)}&duration=${encodeURIComponent(String(duration))}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const upstream = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: `Video provider error: ${upstream.status} ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const blob = await upstream.blob();
    const headers = new Headers();
    headers.set("Content-Type", blob.type || "video/mp4");
    headers.set("Content-Length", String(blob.size));
    headers.set("Cache-Control", "public, max-age=86400");

    return new Response(blob, { status: 200, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Video generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 60, 60);
