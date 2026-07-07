// LiT Notification API
// Triggers notifications to Discord, webhooks, etc.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { lit, NotificationPayload } from "@/lib/jarvis";

// Admin user IDs
const ADMIN_IDS = (process.env.ADMIN_CLERK_IDS || process.env.ADMIN_CLERK_ID || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();

    // Only admin or server can trigger notifications
    if (!userId || !ADMIN_IDS.includes(userId)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await req.json()) as NotificationPayload;

    // Validate payload
    if (!payload.type || !payload.title || !payload.body) {
      return NextResponse.json(
        { error: "Missing required fields: type, title, body" },
        { status: 400 }
      );
    }

    // Ensure LiT is initialized
    if (typeof process.env.DISCORD_WEBHOOK_URL === "string") {
      lit.init({
        discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
        adminEmail: process.env.ADMIN_EMAIL,
        webhookEndpoint: process.env.LIT_WEBHOOK_URL,
      });
    }

    const success = await lit.notify(payload);

    if (success) {
      return NextResponse.json({ success: true, message: "Notification sent" });
    } else {
      return NextResponse.json(
        { success: false, error: "Failed to send notification" },
        { status: 500 }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Quick notification helpers
export async function PUT(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId || !ADMIN_IDS.includes(userId)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { action, data } = body;

    // Ensure initialized
    if (typeof process.env.DISCORD_WEBHOOK_URL === "string") {
      lit.init({
        discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
        adminEmail: process.env.ADMIN_EMAIL,
        webhookEndpoint: process.env.LIT_WEBHOOK_URL,
      });
    }

    let success = false;

    switch (action) {
      case "sale":
        success = await lit.sale(data);
        break;
      case "signup":
        success = await lit.signup(data);
        break;
      case "agent_created":
        success = await lit.agentCreated(data);
        break;
      case "system_alert":
        success = await lit.systemAlert(data);
        break;
      case "cli_event":
        success = await lit.cliEvent(data);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    return NextResponse.json({ success });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
