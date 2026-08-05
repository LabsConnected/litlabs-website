import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";

async function handler() {
  return NextResponse.json({ error: "Skybox generation coming soon" }, { status: 503 });
}

export const POST = withRateLimit(handler, 10, 60);

export const dynamic = "force-dynamic";
