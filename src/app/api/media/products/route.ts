import { NextResponse } from "next/server";
import { LITT_PRODUCTS } from "@/lib/generation/cost-engine";

export const runtime = "nodejs";

/**
 * GET /api/media/products
 *
 * Returns the LiTT product catalog — user-facing aliases that hide
 * underlying provider names. The UI should show these instead of
 * raw provider names (Gemini, Veo, ElevenLabs, etc.).
 *
 * Provider names only appear under "Advanced" or "Details" views.
 */
export async function GET() {
  return NextResponse.json(
    { products: LITT_PRODUCTS },
    {
      headers: { "Cache-Control": "public, max-age=300" },
    },
  );
}
