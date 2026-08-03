// Media Upload API — Supabase Storage with localStorage fallback
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";

// Size limits by media type
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_UPLOAD_BYTES = MAX_VIDEO_BYTES; // absolute max

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
]);

function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return "image/gif";
  return null;
}

function detectVideoMime(buffer: Buffer): string | null {
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 12) === "ftypisom") return "video/mp4";
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 12) === "ftypmp42") return "video/mp4";
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "RIFF") return "video/webm";
  if (buffer.length >= 8 && buffer.toString("ascii", 0, 8) === "\x00\x00\x00\x1Cftyp") return "video/quicktime";
  return null;
}

function detectAudioMime(buffer: Buffer): string | null {
  // MP3
  if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return "audio/mpeg";
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "audio/mpeg";
  // WAV
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") return "audio/wav";
  // OGG
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
  // WebM audio
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "\x1a\x45\xdf\xa3") return "audio/webm";
  return null;
}

function getMaxSizeForMime(mime: string): number {
  if (IMAGE_MIME_TYPES.has(mime)) return MAX_IMAGE_BYTES;
  if (VIDEO_MIME_TYPES.has(mime)) return MAX_VIDEO_BYTES;
  if (AUDIO_MIME_TYPES.has(mime)) return MAX_AUDIO_BYTES;
  return MAX_IMAGE_BYTES; // default to image limit for unknown types
}

export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const purpose = form.get("purpose") as string | null;
    if (!file)
      return NextResponse.json({ error: "No file provided" }, { status: 400 });

    // ── Apply validation to ALL uploads (not just wallpaper) ──────────
    const declaredMime = file.type || "application/octet-stream";
    const isImage = IMAGE_MIME_TYPES.has(declaredMime);
    const isVideo = VIDEO_MIME_TYPES.has(declaredMime);
    const isAudio = AUDIO_MIME_TYPES.has(declaredMime);

    if (!isImage && !isVideo && !isAudio) {
      return NextResponse.json(
        { error: `Unsupported file type: ${declaredMime}. Allowed: JPG, PNG, WebP, GIF, MP4, WebM, MOV, MP3, WAV, OGG` },
        { status: 415 },
      );
    }

    const maxSize = getMaxSizeForMime(declaredMime);
    if (file.size <= 0 || file.size > maxSize) {
      const maxMB = Math.floor(maxSize / (1024 * 1024));
      return NextResponse.json(
        { error: `File must be between 1 byte and ${maxMB} MB for ${declaredMime}` },
        { status: 413 },
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // File signature verification for all uploads
    let detectedMime: string | null = null;
    if (isImage) detectedMime = detectImageMime(buffer);
    else if (isVideo) detectedMime = detectVideoMime(buffer);
    else if (isAudio) detectedMime = detectAudioMime(buffer);

    if (!detectedMime) {
      return NextResponse.json(
        { error: "The uploaded file does not match its declared type (signature verification failed)" },
        { status: 415 },
      );
    }

    // Use detected MIME type (more trustworthy than client-declared)
    const contentType = detectedMime;

    // If Supabase configured, upload to Storage
    if (isAdminSupabaseConfigured()) {
      const sb = getAdminSupabase();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "upload";
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
