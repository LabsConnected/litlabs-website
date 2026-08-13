import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { listDrafts } from "@/lib/growth/growth-repository";
import { isGrowthProviderId } from "@/lib/growth/types";

// GET /api/growth/content — list content drafts
async function getHandler(req: NextRequest) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaign_id") ?? undefined;
  const providerRaw = url.searchParams.get("provider") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;

  let provider;
  if (providerRaw) {
    if (!isGrowthProviderId(providerRaw)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    provider = providerRaw;
  }

  const drafts = await listDrafts(clerkId, {
    campaignId,
    provider,
    status: (status as "draft" | "approved" | "rejected" | "published" | "archived" | undefined),
    limit: 50,
  });

  return NextResponse.json({ drafts });
}

export const GET = withRateLimit(getHandler);
