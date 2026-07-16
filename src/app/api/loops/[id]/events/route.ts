/**
 * /api/loops/[id]/events
 *
 *   GET — list the events recorded for a loop, oldest first.
 *         Supports a `since` query param (ISO timestamp) to fetch only
 *         the events that arrived after the last poll.
 */

import { NextResponse } from "next/server";
import { listEvents } from "@/lib/project-loops/store";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const since = url.searchParams.get("since") || undefined;
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") ?? "200")),
  );
  const events = await listEvents(id, { since, limit });
  return NextResponse.json({ events });
}
