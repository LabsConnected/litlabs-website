import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state parameter" }, { status: 400 });
  }

  if (state !== userId) {
    return NextResponse.json({ error: "State mismatch — possible CSRF attack" }, { status: 403 });
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!appId || !appSecret || !redirectUri) {
    return NextResponse.json({ error: "Meta credentials not configured" }, { status: 500 });
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`,
      { method: "GET" },
    );
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      return NextResponse.json({ error: tokenData.error.message }, { status: 400 });
    }

    const accessToken = tokenData.access_token;

    // Get long-lived token
    const longLivedRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${accessToken}`,
    );
    const longLivedData = await longLivedRes.json();

    const longLivedToken = longLivedData.access_token || accessToken;
    const expiresAt = longLivedData.expires_in
      ? new Date(Date.now() + longLivedData.expires_in * 1000).toISOString()
      : null;

    // Get user's Pages and Instagram accounts
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${longLivedToken}&fields=id,name,access_token,category,instagram_business_account`,
    );
    const pagesData = await pagesRes.json();

    const pages = (pagesData.data || []).map((page: Record<string, unknown>) => ({
      id: page.id,
      name: page.name,
      category: page.category,
      has_instagram: !!page.instagram_business_account,
      instagram_account_id: (page.instagram_business_account as Record<string, unknown> | undefined)?.id,
    }));

    // Get app details
    const appRes = await fetch(
      `https://graph.facebook.com/v19.0/${appId}?access_token=${longLivedToken}&fields=id,name,category,app_domains`,
    );
    const appDetails = await appRes.json();

    // Store integration account
    const { data: existingAccount } = await supabaseAdmin
      .from("integration_accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", "meta")
      .single();

    let accountId: string;
    if (existingAccount) {
      const { data: updated } = await supabaseAdmin
        .from("integration_accounts")
        .update({
          status: "connected",
          provider_account_id: appDetails.id,
          provider_account_name: appDetails.name,
          scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "read_insights", "instagram_basic", "instagram_manage_insights", "pages_messaging"],
          last_connected_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
          metadata: { app_details: appDetails, pages },
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingAccount.id)
        .select("id")
        .single();
      accountId = updated?.id || existingAccount.id;
    } else {
      const { data: newAccount } = await supabaseAdmin
        .from("integration_accounts")
        .insert({
          user_id: userId,
          provider: "meta",
          provider_account_id: appDetails.id,
          provider_account_name: appDetails.name,
          status: "connected",
          scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "read_insights", "instagram_basic", "instagram_manage_insights", "pages_messaging"],
          last_connected_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
          metadata: { app_details: appDetails, pages },
        })
        .select("id")
        .single();
      accountId = newAccount?.id;
    }

    if (!accountId) {
      return NextResponse.json({ error: "Failed to store integration account" }, { status: 500 });
    }

    // Store encrypted credential
    await supabaseAdmin
      .from("integration_credentials")
      .insert({
        integration_account_id: accountId,
        credential_type: "meta_access_token",
        encrypted_value: longLivedToken,
        expires_at: expiresAt,
        scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "read_insights", "instagram_basic", "instagram_manage_insights", "pages_messaging"],
      });

    return NextResponse.json({
      success: true,
      app: { id: appDetails.id, name: appDetails.name, category: appDetails.category },
      pages,
      token_expires_at: expiresAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Meta OAuth callback failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
