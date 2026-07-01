// POST /api/auth/clerk
// Clerk webhook — syncs new users into Supabase immediately on signup.
// Register this endpoint in Clerk Dashboard → Webhooks:
//   URL: https://litlabs.net/api/auth/clerk
//   Events: user.created, user.updated
//
// Required env var: CLERK_WEBHOOK_SECRET (from Clerk Dashboard → Webhooks → Signing Secret)

import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getOrCreateUser } from "@/lib/user-db";
import { isAdminSupabaseConfigured } from "@/lib/supabase-admin";

/** Verify Clerk's svix webhook signature */
function verifyClerkWebhook(
  body: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string,
): boolean {
  // Clerk uses svix — signed payload is: `{svix-id}.{svix-timestamp}.{body}`
  const toSign = `${svixId}.${svixTimestamp}.${body}`;
  // Secret is base64 after stripping "whsec_" prefix
  const rawSecret = Buffer.from(secret.replace("whsec_", ""), "base64");
  const expected = createHmac("sha256", rawSecret).update(toSign).digest("base64");

  // svix-signature may be a comma-separated list of "v1,<sig>" pairs
  const signatures = svixSignature.split(" ").map((s) => s.replace(/^v1,/, ""));
  return signatures.some((sig) => sig === expected);
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Not configured — log and accept to avoid Clerk retries disrupting other things
    return NextResponse.json({ received: true, warning: "CLERK_WEBHOOK_SECRET not set" });
  }

  const svixId = req.headers.get("svix-id") || "";
  const svixTimestamp = req.headers.get("svix-timestamp") || "";
  const svixSignature = req.headers.get("svix-signature") || "";

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const body = await req.text();

  const valid = verifyClerkWebhook(body, svixId, svixTimestamp, svixSignature, webhookSecret);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: { type?: string; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = payload.type;
  const userData = payload.data || {};

  if (eventType === "user.created" || eventType === "user.updated") {
    const clerkId = String(userData.id || "");
    const emailObj = Array.isArray(userData.email_addresses)
      ? (userData.email_addresses as { email_address?: string }[]).find(Boolean)
      : null;
    const email = emailObj?.email_address || `${clerkId}@noemail.local`;
    const firstName = String(userData.first_name || "");
    const lastName = String(userData.last_name || "");
    const name = [firstName, lastName].filter(Boolean).join(" ") || null;

    if (clerkId && isAdminSupabaseConfigured()) {
      try {
        await getOrCreateUser(clerkId, email, name);
        // getOrCreateUser already creates the wallet row with 500 starting coins for new users
      } catch {
        // Non-fatal — Clerk will retry if we return a 5xx, so return 200 and log
      }
    }
  }

  return NextResponse.json({ received: true, type: eventType });
}
