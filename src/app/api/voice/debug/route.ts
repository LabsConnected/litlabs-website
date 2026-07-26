import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.INWORLD_API_KEY;
  const wsUrl = process.env.NEXT_PUBLIC_VOICE_WS_URL;
  const littVoice = process.env.INWORLD_LITT_VOICE;
  const sparkVoice = process.env.INWORLD_SPARK_VOICE;
  const authSecret = process.env.VOICE_AUTH_SECRET;

  // Test Inworld connection
  let inworldStatus: string;
  try {
    if (!apiKey) {
      inworldStatus = "NO_API_KEY";
    } else {
      // Just check if we can reach the Inworld endpoint
      // We can't use WebSocket in Node.js route easily, so just check the key format
      inworldStatus = `KEY_PRESENT (length: ${apiKey.length}, starts with: ${apiKey.substring(0, 6)}...)`;
    }
  } catch (e) {
    inworldStatus = `ERROR: ${e instanceof Error ? e.message : "unknown"}`;
  }

  return NextResponse.json({
    wsUrl: wsUrl || "(not set)",
    wsUrlLength: (wsUrl || "").length,
    littVoice: littVoice ? `${littVoice.substring(0, 10)}... (length: ${littVoice.length})` : "(not set)",
    sparkVoice: sparkVoice ? `${sparkVoice.substring(0, 10)}... (length: ${sparkVoice.length})` : "(not set)",
    authSecretLength: (authSecret || "").length,
    inworldStatus,
  });
}
