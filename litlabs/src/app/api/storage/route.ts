// Storage API - Generate pre-signed URLs via Supabase Storage

import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { auth } from "@clerk/nextjs/server";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const type = searchParams.get("type");

  if (!key || !type) {
    return NextResponse.json({ error: "key and type required" }, { status: 400 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  }

  const sb = getAdminSupabase();
  const path = `${userId}/${key}`;

  const { data, error } = await sb.storage
    .from("media")
    .createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Failed to create upload URL" }, { status: 500 });
  }

  const { data: publicUrlData } = sb.storage.from("media").getPublicUrl(path);

  return NextResponse.json({
    uploadUrl: data.signedUrl,
    token: data.token,
    path,
    publicUrl: publicUrlData.publicUrl,
    method: "PUT",
    headers: { "Content-Type": type },
  });
}

export const dynamic = "force-dynamic";