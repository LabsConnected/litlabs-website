import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import crypto from "node:crypto";

export const runtime = "nodejs";

/**
 * GET /api/media/apple/token
 * Generates a server-side Apple Music developer JWT token.
 *
 * Requires these environment variables:
 *   APPLE_MUSIC_TEAM_ID
 *   APPLE_MUSIC_KEY_ID
 *   APPLE_MUSIC_PRIVATE_KEY (PEM format)
 *
 * Returns { developerToken: string } or { error, configured: false }
 * if Apple Music is not configured.
 */
export async function GET() {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  const privateKeyPem = process.env.APPLE_MUSIC_PRIVATE_KEY;

  if (!teamId || !keyId || !privateKeyPem) {
    return NextResponse.json({
      error: "Apple Music not configured. Requires APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, and APPLE_MUSIC_PRIVATE_KEY.",
      configured: false,
    }, { status: 501 });
  }

  try {
    // Create the JWT header and payload
    const header = { alg: "ES256", typ: "JWT", kid: keyId };
    const payload = {
      iss: teamId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 30), // 30 days
    };

    const base64Url = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    const headerB64 = base64Url(header);
    const payloadB64 = base64Url(payload);
    const signingInput = `${headerB64}.${payloadB64}`;

    // Sign with ES256 (ECDSA P-256)
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(signingInput);
    // The private key is in PEM format
    const key = privateKeyPem.replace(/\\n/g, "\n");
    const signature = sign.sign(key);
    const signatureB64 = signature
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const developerToken = `${signingInput}.${signatureB64}`;

    return NextResponse.json({ developerToken, configured: true });
  } catch (err) {
    return NextResponse.json({
      error: "Failed to generate Apple Music token.",
      detail: err instanceof Error ? err.message : "Unknown error",
      configured: false,
    }, { status: 500 });
  }
}
