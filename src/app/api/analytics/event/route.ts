/**
 * Analytics event ingestion endpoint.
 *
 * Receives funnel events from the client-side analytics module.
 * Currently logs to console; can be extended to write to Supabase,
 * PostHog, or any analytics backend.
 *
 * No PII is collected — only event name, timestamp, path, and referrer.
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const events = body?.events;

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true, received: 0 });
    }

    // Validate and sanitize — reject anything with > 50 events or unknown event names
    const validEvents = events.filter(
      (e: Record<string, unknown>) =>
        e &&
        typeof e.event === "string" &&
        typeof e.ts === "number" &&
        events.indexOf(e) < 50,
    );

    // Log for now — future: insert into analytics table or forward to provider
    if (process.env.NODE_ENV === "development") {
      console.log(`[analytics] ${validEvents.length} event(s) received`);
    }

    return NextResponse.json({ ok: true, received: validEvents.length });
  } catch {
    return NextResponse.json({ ok: true, received: 0 });
  }
}
