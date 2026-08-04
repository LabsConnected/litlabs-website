import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserContext } from "@/lib/litt-intelligence/user-context";

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ctx = await getUserContext(userId);
    return NextResponse.json({
      displayName: ctx.displayName,
      email: ctx.email,
      timezone: ctx.timezone,
      locale: ctx.locale,
      temperatureUnit: ctx.temperatureUnit,
      distanceUnit: ctx.distanceUnit,
      location: ctx.location,
      newsInterests: ctx.newsInterests,
      dailyBriefingEnabled: ctx.dailyBriefingEnabled,
      dailyBriefingTime: ctx.dailyBriefingTime,
      capabilities: ctx.capabilities,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
