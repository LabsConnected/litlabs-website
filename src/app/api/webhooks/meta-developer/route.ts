import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import crypto from "crypto";

// GET — Meta webhook verification
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (!verifyToken) {
    return NextResponse.json({ error: "Webhook verify token not configured" }, { status: 500 });
  }

  if (mode === "subscribe" && token === verifyToken) {
    return NextResponse.json(parseInt(challenge || "0", 10));
  }

  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

// POST — Meta webhook events
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256") || "";

  // Verify signature
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: "App secret not configured" }, { status: 500 });
  }

  const expectedSignature = "sha256=" + crypto.createHmac("sha256", appSecret).update(body).digest("hex");
  if (signature !== expectedSignature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const data = JSON.parse(body);
  const objectType = data.object;
  const entries = data.entry || [];

  for (const entry of entries) {
    const pageId = entry.id;
    const changes = entry.changes || [];

    // Find user by page ID in integration_accounts metadata
    const { data: accounts } = await supabaseAdmin
      .from("integration_accounts")
      .select("id, user_id, metadata")
      .eq("provider", "meta")
      .limit(100);

    const account = accounts?.find((a) => {
      const pages = (a.metadata as Record<string, unknown>)?.pages as Array<Record<string, unknown>> | undefined;
      return pages?.some((p) => p.id === pageId);
    });

    if (!account) {
      continue;
    }

    for (const change of changes) {
      const field = change.field;
      const value = change.value;

      let eventType = "meta_webhook";
      let title = `Meta webhook: ${field}`;
      let severity = "info";

      if (field === "feed") {
        if (value?.item === "post") {
          eventType = "meta_post";
          title = `New post on page: ${value?.message?.slice(0, 80) || "untitled"}`;
          severity = "info";
        } else if (value?.item === "comment") {
          eventType = "meta_comment";
          title = `New comment on post ${value?.post_id}`;
          severity = "info";
        } else if (value?.item === "reaction") {
          eventType = "meta_reaction";
          title = `New ${value?.reaction_type} reaction`;
          severity = "info";
        }
      } else if (field === "mentions") {
        eventType = "meta_mention";
        title = `New mention: ${value?.message?.slice(0, 80) || ""}`;
        severity = "info";
      } else if (field === "ratings") {
        eventType = "meta_rating";
        title = `New page rating: ${value?.rating || "unknown"} stars`;
        severity = "info";
      }

      try {
        await supabaseAdmin.from("integration_events").insert({
          user_id: account.user_id,
          integration_project_id: null,
          provider: "meta",
          event_type: eventType,
          title,
          description: JSON.stringify(value).slice(0, 500),
          severity,
          actor: value?.from?.name || value?.sender?.name || null,
          url: value?.permalink_url || null,
          metadata: { field, page_id: pageId, raw: value },
          created_at: new Date().toISOString(),
        });
      } catch {
        // Non-fatal
      }
    }
  }

  return NextResponse.json({ received: true });
}
