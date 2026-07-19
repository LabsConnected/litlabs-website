import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ enabled: false }, { status: 401 });
  }

  return NextResponse.json(
    { enabled: process.env.STUDIO_HYBRID_ENABLED === "true" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
