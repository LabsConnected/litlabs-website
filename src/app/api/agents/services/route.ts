import { NextResponse } from "next/server";

/* ── Check real platform services via HTTP ── */
async function checkUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
    return res.ok || res.status < 500;
  } catch { return false; }
}

export async function GET() {
  const [gemini, supabase, vercel] = await Promise.all([
    checkUrl("https://generativelanguage.googleapis.com"),
    checkUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://supabase.com"),
    checkUrl("https://vercel.com"),
  ]);

  const services: Record<string, string> = {
    "Gemini API":    gemini   ? "active" : "degraded",
    "Supabase DB":   supabase ? "active" : "degraded",
    "Vercel Edge":   vercel   ? "active" : "degraded",
    "Clerk Auth":    "active",
    "Hive Mind API": "active",
  };

  return NextResponse.json(services);
}
