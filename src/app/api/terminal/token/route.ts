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
    const { token, expiresAt } = createTerminalToken(userId);
    // baseUrl is the absolute URL of the terminal-server. The client
    // uses it to open the Socket.IO connection and to call /run for
    // one-shot commands. Defaults to localhost:4001 in dev; production
    // callers should set TERMINAL_SERVER_URL.
    const baseUrl =
      process.env.TERMINAL_SERVER_URL ||
      process.env.NEXT_PUBLIC_TERMINAL_URL ||
      process.env.NEXT_PUBLIC_TERMINAL_WS_URL?.replace(/^wss:/, "https:").replace(/^ws:/, "http:") ||
      "http://localhost:4001";
    return NextResponse.json(
      { token, expiresAt, baseUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[terminal/token] Terminal authentication is not configured", error);
    return NextResponse.json(
      { error: "Terminal authentication is unavailable" },
      { status: 503 },
    );
  }
}
