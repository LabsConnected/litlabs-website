import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateJSON } from "@/lib/llm";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { buildScanPrompt } from "@/lib/social-agent-prompts";

export const runtime = "nodejs";

type ScanBody = { url?: string };

type ScanResult = {
  name: string;
  voice: string;
  target_audience: string;
  main_offers: string[];
  summary: string;
};

function extractText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

async function handler(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ScanBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url } = body;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "LiTTree SocialPilot Bot" },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status}`);
    }

    const html = await res.text();
    const text = extractText(html);
    const result = await generateJSON<ScanResult>(buildScanPrompt(text), { task: "json" });

    const payload = {
      user_id: userId,
      website_url: url,
      name: result.name,
      voice: result.voice,
      target_audience: result.target_audience,
      main_offers: result.main_offers,
    };

    const { data: existing } = await supabaseAdmin
      .from("brand_profiles")
      .select("id")
      .eq("user_id", userId)
      .eq("website_url", url)
      .maybeSingle();

    const { data: profile, error } = existing
      ? await supabaseAdmin.from("brand_profiles").update(payload).eq("id", existing.id).select().single()
      : await supabaseAdmin.from("brand_profiles").insert(payload).select().single();

    if (error) throw error;

    return NextResponse.json({ profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 10, 60);
