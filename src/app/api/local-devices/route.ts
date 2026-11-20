import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPcPairingService } from "@/lib/pc-pairing-runtime";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const service = getPcPairingService();
  if (!service) return NextResponse.json({ error: "Pairing unavailable" }, { status: 503 });
  try {
    const devices = await service.listDevices(userId);
    return NextResponse.json({ devices }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Pairing unavailable" }, { status: 503 });
  }
}
