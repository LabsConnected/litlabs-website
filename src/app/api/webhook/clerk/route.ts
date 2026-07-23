import { NextRequest, NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/user-db";
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

      await getOrCreateUser(id, email, name);
      // User event processed
    }

    if (eventType === "user.deleted") {
      // User deleted — handle cleanup if needed
      // Optional: delete from Supabase here
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
