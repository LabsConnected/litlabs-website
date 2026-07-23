import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/github-app";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get("x-hub-signature-256") || "";
  const event = request.headers.get("x-github-event") || "unknown";

  try {
    if (!verifyWebhookSignature(payload, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook error";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const data = JSON.parse(payload);

  // Store webhook events for audit and sync. Keep this lightweight; heavy
  // processing should be offloaded to a background job.
  try {
    await supabaseAdmin.from("github_webhook_events").insert({
      event,
      payload: data,
      delivery_id: request.headers.get("x-github-delivery"),
      created_at: new Date().toISOString(),
    });
  } catch {
    // Non-fatal: continue processing even if audit insert fails.
  }

  // Handle installation events to keep our records in sync.
  if (event === "installation" && data.installation) {
    const action = data.action;
    const installationId = data.installation.id;
    if (action === "deleted") {
      await supabaseAdmin
        .from("github_installations")
        .delete()
        .eq("installation_id", installationId);
    }
  }

  if (event === "push" && data.repository && data.ref) {
    // A push happened. Future logic: update workspace status, trigger builds, etc.
  }

  if (event === "pull_request" && data.pull_request) {
    // Future logic: update PR status, notify agent, etc.
  }

  return NextResponse.json({ received: true, event });
}
