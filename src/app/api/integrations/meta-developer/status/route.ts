import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: account, error } = await supabaseAdmin
    .from("integration_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "meta")
    .single();

  if (error || !account) {
    return NextResponse.json({
      connected: false,
      configured: !!(process.env.META_APP_ID && process.env.META_APP_SECRET),
      message: "Meta Developer integration not connected",
    });
  }

  // Check token health
  const { data: credential } = await supabaseAdmin
    .from("integration_credentials")
    .select("expires_at, scopes")
    .eq("integration_account_id", account.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const now = new Date();
  const isExpired = credential?.expires_at ? new Date(credential.expires_at) < now : false;
  const isExpiringSoon = credential?.expires_at
    ? new Date(credential.expires_at).getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000
    : false;

  let status = account.status;
  if (isExpired) status = "expired";
  else if (isExpiringSoon) status = "degraded";

  // Get pages from metadata
  const pages = (account.metadata as Record<string, unknown>)?.pages as Array<Record<string, unknown>> | undefined;
  const appDetails = (account.metadata as Record<string, unknown>)?.app_details as Record<string, unknown> | undefined;

  return NextResponse.json({
    connected: true,
    status,
    app: appDetails ? {
      id: appDetails.id,
      name: appDetails.name,
      category: appDetails.category,
      mode: process.env.META_APP_MODE || "live",
      graph_api_version: "v19.0",
    } : null,
    pages: pages || [],
    token_health: {
      expires_at: credential?.expires_at,
      is_expired: isExpired,
      is_expiring_soon: isExpiringSoon,
      scopes: credential?.scopes || [],
    },
    webhook_configured: !!(process.env.META_APP_SECRET && process.env.META_WEBHOOK_VERIFY_TOKEN),
    last_synced_at: account.last_synced_at,
  });
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: account } = await supabaseAdmin
    .from("integration_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "meta")
    .single();

  if (!account) {
    return NextResponse.json({ error: "Meta integration not found" }, { status: 404 });
  }

  // Delete credentials
  await supabaseAdmin
    .from("integration_credentials")
    .delete()
    .eq("integration_account_id", account.id);

  // Update account status
  await supabaseAdmin
    .from("integration_accounts")
    .update({
      status: "disconnected",
      last_error: "User disconnected",
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  return NextResponse.json({ success: true });
}
