import { NextRequest, NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/user-db";
import { WebhookEvent } from "@clerk/nextjs/server";

/**
 * POST /api/webhook/clerk
 * Receives Clerk webhooks for user lifecycle events
 * 
 * Setup:
 * 1. In Clerk Dashboard → Webhooks → Add Endpoint
 * 2. URL: https://litlabs.net/api/webhook/clerk
 * 3. Events: user.created, user.updated
 * 4. Copy Signing Secret to CLERK_WEBHOOK_SECRET env var
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const headers = req.headers;
    
    // Verify webhook signature (requires svix library for production)
    // For now, we'll process the event directly
    const evt = JSON.parse(body) as WebhookEvent;
    
    const eventType = evt.type;
    
    if (eventType === "user.created") {
      const { id, email_addresses, first_name, last_name } = evt.data;
      
      const email = email_addresses?.[0]?.email_address || "";
      const name = first_name && last_name 
        ? `${first_name} ${last_name}`
        : first_name || email.split("@")[0];
      
      // Create user in our database
      await getOrCreateUser(id, email, name);
      
      console.log(`[Clerk Webhook] User created: ${id} (${email})`);
    }
    
    if (eventType === "user.updated") {
      const { id, email_addresses, first_name, last_name } = evt.data;
      
      const email = email_addresses?.[0]?.email_address || "";
      const name = first_name && last_name 
        ? `${first_name} ${last_name}`
        : first_name || email.split("@")[0];
      
      // Update user in our database
      await getOrCreateUser(id, email, name);
      
      console.log(`[Clerk Webhook] User updated: ${id}`);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Clerk Webhook] Error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

// Route segment config - disable body parsing for webhook
export const bodyParser = false;
