import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPcPairingService } from "@/lib/pc-pairing-runtime";
import { rateLimit } from "@/lib/rate-limiter";
import { sameOriginMutation } from "@/lib/pc-pairing-http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await rateLimit(request, 10, 3600)).success)
    return NextResponse.json({ error: "Too many pairing attempts" }, { status: 429 });
  const service = getPcPairingService();
  if (!service) return NextResponse.json({ error: "Pairing unavailable" }, { status: 503 });
  try {
    const pairing = await service.createCode(userId);
    return NextResponse.json(pairing,
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Pairing unavailable" }, { status: 503 });
  }
}
