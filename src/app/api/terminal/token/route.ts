import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createTerminalToken } from "@/lib/terminal-auth";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(createTerminalToken(userId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[terminal/token] Terminal authentication is not configured", error);
    return NextResponse.json(
      { error: "Terminal authentication is unavailable" },
      { status: 503 },
    );
  }
}
