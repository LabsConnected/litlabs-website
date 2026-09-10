/**
 * Analytics event ingestion endpoint.
 *
 * Receives funnel events from the client-side analytics module and persists
 * them to the analytics_events table using the service-role Supabase client.
 *
 * No PII is collected — only event name, timestamp, path, referrer, and
 * explicitly provided properties (e.g., plan or project type).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";

export const runtime = "nodejs";

const ALLOWED_EVENT_NAMES = new Set([
  "homepage_view",
  "signup_started",
  "signup_completed",
  "project_created",
  "project_selected",
  "studio_opened",
  "first_successful_prompt",
  "pricing_viewed",
  "checkout_started",
  "checkout_completed",
  "plan_activated",
  "returning_user",
]);

interface AnalyticsEventRow {
  event: string;
  ts: number;
  path?: string;
  referrer?: string;
  properties?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const events = body?.events;

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true, received: 0 });
    }

    // Validate and sanitize — enforce a max batch size, required fields, and
    // a known event name whitelist to keep ingestion predictable.
    const rows: AnalyticsEventRow[] = [];
    for (const e of events) {
      if (
        e &&
        typeof e.event === "string" &&
        ALLOWED_EVENT_NAMES.has(e.event) &&
        typeof e.ts === "number" &&
        Number.isFinite(e.ts) &&
        rows.length < 50
      ) {
        const { event, ts, path, referrer, ...rest } = e as Record<string, unknown>;
        const properties = Object.keys(rest).length > 0 ? rest : undefined;
        const row: AnalyticsEventRow = { event, ts };
        if (typeof path === "string") row.path = path;
        if (typeof referrer === "string") row.referrer = referrer;
        if (properties) row.properties = properties;
        rows.push(row);
      }
    }

    if (rows.length > 0 && isAdminSupabaseConfigured()) {
      try {
        const sb = getAdminSupabase();
        await sb.from("analytics_events").insert(rows);
      } catch (err) {
        // Best-effort persistence. Don't fail the client request if storage
        // is temporarily unavailable; otherwise we lose real-time conversion
        // signals and spam the user with errors they can't act on.
        if (process.env.NODE_ENV === "development") {
          console.error("[analytics] failed to persist events", err);
        }
      }
    }

    if (process.env.NODE_ENV === "development") {
      console.log(`[analytics] ${rows.length} event(s) received`);
    }

    return NextResponse.json({ ok: true, received: rows.length });
  } catch {
    return NextResponse.json({ ok: true, received: 0 });
  }
}
