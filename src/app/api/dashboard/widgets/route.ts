import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { resolveRecentCreations } from "@/lib/dashboard/recent-creations";
import { resolveGalleryWidgetData } from "@/lib/dashboard/gallery-widget-data";
import { resolveDiscoverFeedWidget } from "@/lib/dashboard/discover-widget-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/widgets
 *
 * Returns data for dashboard widgets that need server-side resolution.
 * Each widget is resolved independently — a failure in one doesn't block others.
 *
 * Query params:
 * - widgets: comma-separated list of widget IDs to fetch
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth(request).catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requested = request.nextUrl.searchParams.get("widgets") ?? "";
  const widgetIds = requested.split(",").map((s) => s.trim()).filter(Boolean);

  const results: Record<string, unknown> = {};

  // Resolve each widget in parallel — failures are isolated
  await Promise.allSettled([
    (async () => {
      if (!widgetIds.length || widgetIds.includes("recent-creations")) {
        results["recent-creations"] = await resolveRecentCreations(userId);
      }
    })(),
    (async () => {
      if (!widgetIds.length || widgetIds.includes("my-gallery") || widgetIds.includes("trending-gallery")) {
        results["gallery"] = await resolveGalleryWidgetData(userId, widgetIds);
      }
    })(),
    (async () => {
      if (!widgetIds.length || widgetIds.includes("discover-feed")) {
        results["discover-feed"] = await resolveDiscoverFeedWidget(userId);
      }
    })(),
  ]);

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}
