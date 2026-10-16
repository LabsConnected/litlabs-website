// Storage API - Generate pre-signed URLs via Supabase Storage

import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { auth } from "@/lib/auth";

const MEDIA_BUCKET = "media";

function isMissingBucketError(error: { message?: string }): boolean {
  // Supabase Storage reports a missing bucket as "Bucket not found" on some
  // versions and "The related resource does not exist" (observed on staging)
  // via the PostgREST-style gateway on others.
  return /bucket not found|bucket.*does not exist|related resource does not exist/i
    .test(error.message ?? "");
}

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
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

  let { data, error } = await sb.storage
    .from(MEDIA_BUCKET)
    .createSignedUploadUrl(path);

  // The "media" bucket predates migrations (it was created by hand in the
  // dashboard), so environments provisioned purely from migrations — staging,
  // previews, fresh self-hosts — fail every signed-upload request with
  // "Bucket not found". Self-provision once and retry; createBucket is
  // idempotent and this branch never runs where the bucket already exists.
  if (error && isMissingBucketError(error)) {
    const { error: createError } = await sb.storage.createBucket(MEDIA_BUCKET, {
      public: true,
    });
    if (createError && !/already exists|duplicate/i.test(createError.message)) {
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }
    ({ data, error } = await sb.storage
      .from(MEDIA_BUCKET)
      .createSignedUploadUrl(path));
  }

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Failed to create upload URL" }, { status: 500 });
  }

  const { data: publicUrlData } = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path);

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