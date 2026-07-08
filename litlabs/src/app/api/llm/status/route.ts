import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const hasKey = Boolean(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.OPENROUTER_API_KEY,
  );
  return NextResponse.json({ hasKey, demoMode: !hasKey });
}
