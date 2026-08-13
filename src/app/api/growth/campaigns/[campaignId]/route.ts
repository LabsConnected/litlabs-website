import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getCampaign } from "@/lib/growth/growth-repository";

// GET /api/growth/campaigns/[campaignId] — get a single campaign
async function getHandler(req: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { campaignId } = await params;
  const campaign = await getCampaign(clerkId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  return NextResponse.json({ campaign });
}

export const GET = withRateLimit(getHandler);
