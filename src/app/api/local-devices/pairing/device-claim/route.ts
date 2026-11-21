import { NextRequest, NextResponse } from "next/server";
import { getPcPairingService } from "@/lib/pc-pairing-runtime";
import { verifyPcClaim, type SignedPcClaim } from "@/lib/pc-pairing-proof";
import { rateLimit } from "@/lib/rate-limiter";
import { PairingBodyTooLarge, readPairingJson } from "@/lib/pc-pairing-body";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!(await rateLimit(request, 20, 3600)).success)
    return NextResponse.json({ error: "Too many pairing attempts" }, { status: 429 });
  let claim: SignedPcClaim;
  try { claim = await readPairingJson(request) as SignedPcClaim; } catch (error) {
    return NextResponse.json({ error: "Invalid claim" },
      { status: error instanceof PairingBodyTooLarge ? 413 : 400 });
  }
  if (!claim || typeof claim.code !== "string" || typeof claim.publicKey !== "string" ||
      typeof claim.fingerprint !== "string" || typeof claim.name !== "string" ||
      typeof claim.signature !== "string" || !verifyPcClaim(claim))
    return NextResponse.json({ error: "Invalid claim" }, { status: 400 });
  const service = getPcPairingService();
  if (!service) return NextResponse.json({ error: "Pairing unavailable" }, { status: 503 });
  try {
    const accepted = await service.claimFromAgent(claim.code, claim);
    return NextResponse.json({ accepted }, { status: accepted ? 202 : 404,
      headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Pairing unavailable" }, { status: 503 });
  }
}
