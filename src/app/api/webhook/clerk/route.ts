import { NextRequest, NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/user-db";
import { anonymizeUser } from "@/lib/user-deletion";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { getSupabaseAdmin } from "@/lib/supabase";
import { Webhook } from "svix";

/**
 * POST /api/webhook/clerk
 * Receives Clerk webhooks for user lifecycle events
 *
 * Setup:
 * 1. In Clerk Dashboard → Webhooks → Add Endpoint
 * 2. URL: https://litlabs.net/api/webhook/clerk
 * 3. Events: user.created, user.updated, user.deleted
 * 4. Copy Signing Secret to CLERK_WEBHOOK_SECRET env var
 */
export async function POST(req: NextRequest) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    // CLERK_WEBHOOK_SECRET not set — reject
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  // Get the headers Svix needs
  const svix_id = req.headers.get("svix-id");
  const svix_timestamp = req.headers.get("svix-timestamp");
  const svix_signature = req.headers.get("svix-signature");

  // If headers missing, reject
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return NextResponse.json(
      { error: "Missing Svix headers" },
      { status: 400 },
    );
  }

  // Get the raw body
  const payload = await req.text();

  // Verify signature
  let evt: { type: string; data: Record<string, unknown> };
  try {
    const wh = new Webhook(WEBHOOK_SECRET);
    evt = wh.verify(payload, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as { type: string; data: Record<string, unknown> };
  } catch {
    // Signature verification failed — reject
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 400 },
    );
  }

  // Process event
  try {
    const eventType = evt.type;

    if (eventType === "user.created" || eventType === "user.updated") {
      const data = evt.data;
      const id = data.id as string;
      const email_addresses =
        (data.email_addresses as Array<{ email_address: string }>) || [];
      const first_name = (data.first_name as string) || "";
      const last_name = (data.last_name as string) || "";

      const email = email_addresses[0]?.email_address || "";
      const name =
        first_name && last_name
          ? `${first_name} ${last_name}`
          : first_name || email.split("@")[0];

      const { isNew } = await getOrCreateUser(id, email, name);

      // Grant the starter 500 LiTTBits to NEW users via the canonical
      // credit_ledger. This is idempotent (grant_credits RPC deduplicates
      // by idempotency_key = "starter:{userId}"), so even if the webhook
      // fires twice or getCreditBalances also tries to grant, the second
      // call is a no-op. Without this, a new user who goes straight to a
      // marketplace agent chat (without first loading /api/wallet) would
      // see 0 BITS and be blocked — the lazy grant in getCreditBalances
      // only fires on wallet read.
      if (isNew && eventType === "user.created") {
        try {
          const admin = getSupabaseAdmin();
          if (admin) {
            // Look up the internal user ID (clerk_id → users.id)
            const { data: userRow } = await admin
              .from("users")
              .select("id")
              .eq("clerk_id", id)
              .single();
            if (userRow?.id) {
              // Pre-check to avoid an unnecessary RPC round-trip
              const { data: existingGrant } = await admin
                .from("credit_ledger")
                .select("id")
                .eq("user_id", userRow.id)
                .eq("idempotency_key", `starter:${userRow.id}`)
                .limit(1)
                .maybeSingle();
              if (!existingGrant) {
                await admin.rpc("grant_credits", {
                  p_user_id: userRow.id,
                  p_amount: 500,
                  p_category: "subscription_grant",
                  p_balance_bucket: "monthly",
                  p_description: "Starter one-time grant — 500 LiTTBits (webhook)",
                  p_idempotency_key: `starter:${userRow.id}`,
                  p_reference_type: "starter_plan",
                  p_reference_id: "one_time",
                });
              }
            }
          }
        } catch {
          // Starter grant failed — the lazy grant in getCreditBalances
          // will retry on the next wallet read. Don't fail the webhook.
        }
      }
    }

    if (eventType === "user.deleted") {
      // User deleted in Clerk — anonymize PII and purge personal data.
      // Retains billing/legal records (transactions, credit_ledger, audit_events).
      // Idempotent: safe for duplicate webhook delivery.
      const data = evt.data;
      const clerkUserId = data.id as string;
      if (clerkUserId) {
        try {
          const db = getAdminSupabase();
          await anonymizeUser(db, clerkUserId);
        } catch {
          // If Supabase isn't configured or fails, we still return success
          // so Clerk doesn't retry indefinitely. The user is already gone
          // from Clerk; we'll catch up on next sign-in attempt or manual cleanup.
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    // Webhook processing error — reject
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}

// Ensure route is dynamic (no static optimization)
export const dynamic = "force-dynamic";
