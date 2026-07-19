// Media Upload API — Supabase Storage with localStorage fallback
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return "image/gif";
  return null;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const purpose = form.get("purpose");
    if (!file)
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (purpose === "wallpaper") {
      if (!IMAGE_MIME_TYPES.has(file.type))
        return NextResponse.json({ error: "Only JPG, PNG, WebP, and GIF images are allowed" }, { status: 415 });
      if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES)
        return NextResponse.json({ error: "Images must be between 1 byte and 10 MB" }, { status: 413 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const detectedMime = detectImageMime(buffer);
    if (purpose === "wallpaper" && (!detectedMime || detectedMime !== file.type))
      return NextResponse.json({ error: "The uploaded file is not a valid image" }, { status: 415 });
    const contentType = purpose === "wallpaper" ? detectedMime! : file.type || "application/octet-stream";

    // If Supabase configured, upload to Storage
    if (isAdminSupabaseConfigured()) {
      const sb = getAdminSupabase();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "wallpaper";
      const path = `${userId}/${Date.now()}_${safeName}`;
      const { data, error } = await sb.storage
        .from("media")
        .upload(path, buffer, { contentType, upsert: false });
      if (error) throw error;
      const { data: publicUrl } = sb.storage
        .from("media")
        .getPublicUrl(data.path);
      return NextResponse.json({ url: publicUrl.publicUrl, path: data.path });
    }

    // Fallback: return base64 data URL for local preview
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${contentType};base64,${base64}`;
    return NextResponse.json({ url: dataUrl, fallback: true });
  } catch {
    // Upload error:
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
