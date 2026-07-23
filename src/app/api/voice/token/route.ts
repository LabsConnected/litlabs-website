import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createVoiceToken } from "@/lib/voice-auth";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(createVoiceToken(userId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[voice/token] Voice authentication is not configured", error);
    return NextResponse.json(
      { error: "Voice authentication is unavailable" },
      { status: 503 },
    );
  }
}
