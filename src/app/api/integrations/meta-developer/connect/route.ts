import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!appId || !appSecret) {
    return NextResponse.json({
      configured: false,
      message: "Meta App credentials not configured. Set META_APP_ID and META_APP_SECRET.",
    });
  }

  if (!redirectUri) {
    return NextResponse.json({
      configured: false,
      message: "META_REDIRECT_URI not set.",
    });
  }

  const scopes = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "read_insights",
    "instagram_basic",
    "instagram_manage_insights",
    "pages_messaging",
  ].join(",");

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${userId}`;

  return NextResponse.json({
    configured: true,
    auth_url: authUrl,
    app_id: appId,
    scopes: scopes.split(","),
  });
}
