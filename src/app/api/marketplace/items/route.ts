import { NextRequest, NextResponse } from "next/server";
import { getPublicMarketplaceItems } from "@/lib/public-marketplace";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const itemType = searchParams.get("type");
    const assistant = searchParams.get("assistant");

    const itemsWithInstallable = await getPublicMarketplaceItems({ category, itemType, assistant });

    return NextResponse.json({
      items: itemsWithInstallable,
      total: itemsWithInstallable.length,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch marketplace items" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler);
