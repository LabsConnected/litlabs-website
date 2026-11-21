import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPcPairingService } from "@/lib/pc-pairing-runtime";
import { sameOriginMutation } from "@/lib/pc-pairing-http";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ deviceId: string }> }) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { deviceId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(deviceId))
    return NextResponse.json({ error: "Invalid device" }, { status: 400 });
  const service = getPcPairingService();
  if (!service) return NextResponse.json({ error: "Pairing unavailable" }, { status: 503 });
  try {
    const revoked = await service.revokeDevice(userId, deviceId);
    return NextResponse.json(revoked ? { revoked: true } : { error: "Device not found" },
      { status: revoked ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Pairing unavailable" }, { status: 503 });
  }
}
