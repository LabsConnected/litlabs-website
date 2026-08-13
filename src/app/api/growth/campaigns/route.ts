import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  createCampaign,
  listCampaigns,
} from "@/lib/growth/growth-repository";
import { isGrowthProviderId } from "@/lib/growth/types";

// GET /api/growth/campaigns — list the user's campaigns
async function getHandler(req: NextRequest) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaigns = await listCampaigns(clerkId, 20);
  return NextResponse.json({ campaigns });
}

// POST /api/growth/campaigns — create a new campaign
async function postHandler(req: NextRequest) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name : "";
  const eventSummary = typeof b.event_summary === "string" ? b.event_summary : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!eventSummary) return NextResponse.json({ error: "event_summary is required" }, { status: 400 });

  const objective = typeof b.objective === "string" ? b.objective : undefined;
  const targetProvidersRaw = Array.isArray(b.target_providers) ? b.target_providers : ["x"];
  const targetProviders = targetProvidersRaw.filter(
    (p): p is "x" | "reddit" | "hackernews" | "producthunt" =>
      typeof p === "string" && isGrowthProviderId(p),
  );
  if (targetProviders.length === 0) {
    return NextResponse.json({ error: "target_providers must include at least one valid provider" }, { status: 400 });
  }

  const campaign = await createCampaign(clerkId, {
    name,
    objective,
    event_summary: eventSummary,
    target_providers: targetProviders,
  });

  if (!campaign) {
    return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 });
  }

  return NextResponse.json({ campaign });
}

export const GET = withRateLimit(getHandler);
export const POST = withRateLimit(postHandler);
