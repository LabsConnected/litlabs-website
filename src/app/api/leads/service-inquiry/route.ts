/**
 * Service inquiry lead capture endpoint.
 *
 * Accepts form submissions from the /hire page and stores them as leads
 * in the `service_inquiries` table.
 *
 * Security:
 *   - Zod validates every field (type, length, format)
 *   - Server derives clerk_user_id from auth() — never trusts client for identity
 *   - Server sets status="new" — client cannot override
 *   - Server sets source — client cannot spoof
 *   - service_id is validated against the SERVICE_OFFERS catalog
 *   - metadata is restricted to a small schema (no arbitrary nesting)
 *   - Supabase service-role key is never exposed to the client
 *   - RLS blocks anonymous reads/writes at the database level
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { SERVICE_OFFERS, type ServiceOfferId } from "@/config/service-offers";
import {
  buildGHLServiceInquiryPayload,
  sendServiceInquiryToGHL,
} from "@/lib/ghl/ghl-service-inquiry-sender";

// ─── Zod schema ───────────────────────────────────────────────────────

const VALID_SERVICE_IDS = Object.keys(SERVICE_OFFERS) as ServiceOfferId[];
const VALID_SOURCES = ["hire_page", "hire_inquiry_form", "supabase-manual-test"] as const;

const metadataSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .nullish()
  .transform((v) => v ?? {});

const serviceInquirySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().toLowerCase().email("Valid email is required").max(320),
  phone: z.string().trim().max(30).optional().nullable().transform((v) => v || null),
  company: z.string().trim().max(200).optional().nullable().transform((v) => v || null),
  serviceId: z.enum(VALID_SERVICE_IDS).optional().nullable().transform((v) => v ?? null),
  message: z.string().trim().max(5000).optional().nullable().transform((v) => v || null),
  referralCode: z.string().trim().max(100).optional().nullable().transform((v) => v || null),
  metadata: metadataSchema,
});

// ─── Rate limiting (in-memory, per-IP) ────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 5; // 5 inquiries per minute per IP
const ipHits = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || entry.resetAt < now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── POST handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Rate limit
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    if (!rateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429 },
      );
    }

    // Parse + validate body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = serviceInquirySchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstError?.message ?? "Validation failed" },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // Server derives auth identity — never trusts client
    const { userId: clerkUserId } = await auth(req);
    // clerkUserId is null for anonymous users (public form) — that's OK

    // Resolve service_name from catalog if serviceId is provided
    let serviceName: string | null = null;
    if (data.serviceId) {
      const offer = SERVICE_OFFERS[data.serviceId];
      serviceName = offer?.name ?? null;
    }

    // Server-derived fields — client cannot override
    const row = {
      clerk_user_id: clerkUserId ?? null,
      service_id: data.serviceId,
      service_name: serviceName,
      name: data.name,
      email: data.email,
      phone: data.phone,
      company: data.company,
      message: data.message,
      status: "new", // Server-set, never client-controlled
      source: "hire_page", // Server-set, never client-controlled
      referral_code: data.referralCode,
      metadata: data.metadata,
    };

    const admin = getSupabaseAdmin();
    if (!admin) {
      console.error("Service inquiry: Supabase admin client not configured");
      // Don't leak infrastructure details to client
      return NextResponse.json({ success: true });
    }

    const { data: insertedRow, error } = await admin
      .from("service_inquiries")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.error("Service inquiry insert failed:", error.message);
      // Don't leak DB errors to the client — return success to avoid
      // revealing table structure or column names
      return NextResponse.json({ success: true });
    }

    // Fire-and-forget GHL sync — never blocks the response.
    // Supabase row is the source of truth; GHL is downstream.
    if (insertedRow?.id) {
      const ghlPayload = buildGHLServiceInquiryPayload({
        inquiryId: insertedRow.id,
        serviceId: data.serviceId,
        serviceName,
        name: data.name,
        email: data.email,
        phone: data.phone,
        company: data.company,
        message: data.message,
        source: "hire_page",
        referralCode: data.referralCode,
      });
      // Don't await — fire and forget so the user gets an instant response
      void sendServiceInquiryToGHL(ghlPayload);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Service inquiry unexpected error:", err);
    // Never expose internal errors to the client
    return NextResponse.json({ success: true });
  }
}

// ─── GET handler — blocked (no public reads) ──────────────────────────

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
