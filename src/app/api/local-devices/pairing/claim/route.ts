import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPcPairingService } from "@/lib/pc-pairing-runtime";
import { sameOriginMutation } from "@/lib/pc-pairing-http";
import { PairingBodyTooLarge, readPairingJson } from "@/lib/pc-pairing-body";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const service = getPcPairingService();
  if (!service) return NextResponse.json({ error: "Pairing unavailable" }, { status: 503 });
  try {
    const pairingId = request.nextUrl.searchParams.get("id") ?? "";
    return NextResponse.json({ claim: await service.peekClaim(userId, pairingId) },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Pairing unavailable" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: { pairingId?: string };
  try { body = await readPairingJson(request) as { pairingId?: string }; } catch (error) {
    return NextResponse.json({ error: "Invalid request" },
      { status: error instanceof PairingBodyTooLarge ? 413 : 400 });
  }
  if (typeof body?.pairingId !== "string")
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const service = getPcPairingService();
  if (!service) return NextResponse.json({ error: "Pairing unavailable" }, { status: 503 });
  try {
    const device = await service.completePairing(userId, body.pairingId);
    return NextResponse.json(device ? { device } : { error: "Pairing unavailable or expired" },
      { status: device ? 200 : 409, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Pairing unavailable" }, { status: 503 });
  }
}
