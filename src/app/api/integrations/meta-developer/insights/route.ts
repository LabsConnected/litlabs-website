import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: account } = await supabaseAdmin
    .from("integration_accounts")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("provider", "meta")
    .single();

  if (!account) {
    return NextResponse.json({ error: "Meta integration not connected" }, { status: 404 });
  }

  const { data: credential } = await supabaseAdmin
    .from("integration_credentials")
    .select("encrypted_value, expires_at")
    .eq("integration_account_id", account.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!credential) {
    return NextResponse.json({ error: "No valid token found" }, { status: 404 });
  }

  const accessToken = credential.encrypted_value;
  const pages = (account.metadata as Record<string, unknown>)?.pages as Array<Record<string, unknown>> | undefined;

  if (!pages || pages.length === 0) {
    return NextResponse.json({ pages: [], insights: [] });
  }

  const results: Array<{ page_id: string; page_name: string; insights: Record<string, unknown>; posts: Array<Record<string, unknown>> }> = [];

  for (const page of pages) {
    const pageId = page.id as string;
    const pageName = page.name as string;
    const pageAccessToken = page.access_token as string || accessToken;

    try {
      // Fetch page insights (last 28 days)
      const insightsRes = await fetch(
        `https://graph.facebook.com/v19.0/${pageId}/insights?metric=page_impressions,page_post_engagements,page_follows,page_views&period=day&date_preset=last_28d&access_token=${pageAccessToken}`,
      );
      const insightsData = await insightsRes.json();

      // Fetch recent posts
      const postsRes = await fetch(
        `https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,message,created_time,permalink_url,insights.metric(post_impressions,post_reactions_like_total).limit(1)&limit=10&access_token=${pageAccessToken}`,
      );
      const postsData = await postsRes.json();

      results.push({
        page_id: pageId,
        page_name: pageName,
        insights: insightsData.data || [],
        posts: postsData.data || [],
      });
    } catch {
      results.push({
        page_id: pageId,
        page_name: pageName,
        insights: { error: "Failed to fetch insights" },
        posts: [],
      });
    }
  }

  return NextResponse.json({ pages: results });
}
