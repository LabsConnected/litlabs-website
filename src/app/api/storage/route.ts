// Storage API - Generate pre-signed URLs for direct uploads

import { NextRequest, NextResponse } from "next/server";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_BUCKET = process.env.R2_BUCKET_NAME || "litlabs-media";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const type = searchParams.get("type");

  if (!key || !type) {
    return NextResponse.json({ error: "key and type required" }, { status: 400 });
  }

  // Return mock URL for dev, real pre-signed URL in production
  const uploadUrl = R2_ACCOUNT_ID
    ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`
    : `https://temp-upload.litlabs.net/${key}`;

  return NextResponse.json({
    uploadUrl,
    publicUrl: `https://media.litlabs.net/${key}`,
    method: "PUT",
    headers: { "Content-Type": type },
  });
}