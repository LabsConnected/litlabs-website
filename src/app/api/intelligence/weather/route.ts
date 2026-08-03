import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserContext } from "@/lib/litt-intelligence/user-context";
import { fetchWeatherForUser } from "@/lib/litt-intelligence/weather-tool";

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const type = req.nextUrl.searchParams.get("type") ?? "current";

  if (type !== "current" && type !== "hourly" && type !== "daily") {
    return NextResponse.json(
      { error: "Invalid type. Use: current, hourly, or daily" },
      { status: 400 },
    );
  }

  try {
    const ctx = await getUserContext(userId, {
      capabilities: ["weather.current", "weather.hourly", "weather.daily"],
    });
    const result = await fetchWeatherForUser(ctx, { type });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }

    return NextResponse.json({
      data: result.data,
      formatted: result.formatted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
