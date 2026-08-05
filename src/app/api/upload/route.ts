// Media Upload API — Supabase Storage with localStorage fallback
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";
import { newRequestId, jsonError } from "@/lib/api-route-helpers";

// ── Route configuration ──────────────────────────────────────────
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Size limits by media type
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024; // 1 GB
const MAX_AUDIO_BYTES = 250 * 1024 * 1024; // 250 MB
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_CODE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024; // 500 MB

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
]);

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
]);

const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/x-m4a",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
]);

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/rtf",
  "text/html",
  "text/xml",
  "text/yaml",
  "text/x-yaml",
  "application/yaml",
]);

const CODE_MIME_TYPES = new Set([
  "text/typescript",
  "text/javascript",
  "text/jsx",
  "text/tsx",
  "text/css",
  "application/typescript",
  "application/javascript",
  "text/x-python",
  "text/x-rust",
  "text/x-go",
  "text/x-java",
  "text/x-c",
  "text/x-cpp",
  "text/x-sh",
  "text/x-sql",
]);

const ARCHIVE_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-tar",
  "application/x-7z-compressed",
]);

// Extensions for fallback classification when MIME is generic
const EXTENSION_MIME: Record<string, string> = {
  ts: "text/typescript", tsx: "text/tsx", js: "text/javascript", jsx: "text/jsx",
  py: "text/x-python", rs: "text/x-rust", go: "text/x-go", java: "text/x-java",
  c: "text/x-c", cpp: "text/x-cpp", h: "text/x-c", sh: "text/x-sh", sql: "text/x-sql",
  css: "text/css", html: "text/html", xml: "text/xml", yaml: "text/yaml", yml: "text/yaml",
  md: "text/markdown", markdown: "text/markdown", txt: "text/plain", csv: "text/csv",
  json: "application/json", rtf: "application/rtf",
  pdf: "application/pdf",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip", gz: "application/gzip", tar: "application/x-tar", "7z": "application/x-7z-compressed",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/m4a", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif",
};

function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return "image/gif";
  // AVIF: starts with \x00\x00\x00 ftyp
  if (buffer.length >= 12 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x00 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);
    if (["avif", "avis", "mif1"].includes(brand)) return "image/avif";
  }
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
  if (DOCUMENT_MIME_TYPES.has(mime)) return MAX_DOCUMENT_BYTES;
  if (CODE_MIME_TYPES.has(mime)) return MAX_CODE_BYTES;
  if (ARCHIVE_MIME_TYPES.has(mime)) return MAX_ARCHIVE_BYTES;
  return MAX_DOCUMENT_BYTES; // default to document limit for unknown types
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

function classifyByExtension(ext: string): { mime: string; category: "image" | "video" | "audio" | "document" | "code" | "archive" } | null {
  const mime = EXTENSION_MIME[ext];
  if (!mime) return null;
  if (IMAGE_MIME_TYPES.has(mime)) return { mime, category: "image" };
  if (VIDEO_MIME_TYPES.has(mime)) return { mime, category: "video" };
  if (AUDIO_MIME_TYPES.has(mime)) return { mime, category: "audio" };
  if (DOCUMENT_MIME_TYPES.has(mime)) return { mime, category: "document" };
  if (CODE_MIME_TYPES.has(mime)) return { mime, category: "code" };
  if (ARCHIVE_MIME_TYPES.has(mime)) return { mime, category: "archive" };
  return { mime, category: "document" };
}

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  let userId: string | null;
  try {
    ({ userId } = await auth(req));
  } catch (err) {
    return jsonError(500, "Authentication check failed", requestId, err);
  }
  if (!userId)
    return jsonError(401, "Unauthorized", requestId);

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const purpose = form.get("purpose");
    if (!file)
      return NextResponse.json({ error: "No file provided" }, { status: 400 });

    // ── Wallpaper-specific validation ────────────────────────────────
    // Wallpapers have stricter rules: only images, max 10 MB, AVIF allowed.
    const WALLPAPER_MIME_TYPES = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
    ]);
    const WALLPAPER_MAX_BYTES = 10 * 1024 * 1024;

    if (purpose === "wallpaper") {
      if (!WALLPAPER_MIME_TYPES.has(file.type)) {
        return NextResponse.json(
          { error: "Wallpapers must be JPG, PNG, WebP, or AVIF images." },
          { status: 415 },
        );
      }
      if (file.size > WALLPAPER_MAX_BYTES) {
        return NextResponse.json(
          { error: "Wallpaper too large. Maximum size is 10 MB." },
          { status: 413 },
        );
      }
    }

    // ── Apply validation to ALL uploads ──────────────────────────────
    const declaredMime = file.type || "application/octet-stream";
    const isImage = IMAGE_MIME_TYPES.has(declaredMime);
    const isVideo = VIDEO_MIME_TYPES.has(declaredMime);
    const isAudio = AUDIO_MIME_TYPES.has(declaredMime);
    const isDocument = DOCUMENT_MIME_TYPES.has(declaredMime);
    const isCode = CODE_MIME_TYPES.has(declaredMime);
    const isArchive = ARCHIVE_MIME_TYPES.has(declaredMime);

    // Try extension-based classification if MIME is generic/missing
    let effectiveMime = declaredMime;
    if (!isImage && !isVideo && !isAudio && !isDocument && !isCode && !isArchive) {
      const ext = getExtension(file.name);
      const extClass = classifyByExtension(ext);
      if (extClass) {
        effectiveMime = extClass.mime;
        if (extClass.category === "image") { /* re-check below */ }
      }
    }

    const isImageEff = IMAGE_MIME_TYPES.has(effectiveMime);
    const isVideoEff = VIDEO_MIME_TYPES.has(effectiveMime);
    const isAudioEff = AUDIO_MIME_TYPES.has(effectiveMime);
    const isDocumentEff = DOCUMENT_MIME_TYPES.has(effectiveMime);
    const isCodeEff = CODE_MIME_TYPES.has(effectiveMime);
    const isArchiveEff = ARCHIVE_MIME_TYPES.has(effectiveMime);

    if (!isImageEff && !isVideoEff && !isAudioEff && !isDocumentEff && !isCodeEff && !isArchiveEff) {
      return NextResponse.json(
        { error: `Unsupported file type: ${declaredMime}. Allowed: images, video, audio, PDF, DOCX, TXT, MD, CSV, JSON, code files, ZIP` },
        { status: 415 },
      );
    }

    const maxSize = getMaxSizeForMime(effectiveMime);
    if (file.size <= 0 || file.size > maxSize) {
      const maxMB = Math.floor(maxSize / (1024 * 1024));
      return NextResponse.json(
        { error: `File must be between 1 byte and ${maxMB} MB for ${effectiveMime}` },
        { status: 413 },
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // File signature verification for media types
    let detectedMime: string | null = null;
    if (isImageEff) detectedMime = detectImageMime(buffer);
    else if (isVideoEff) detectedMime = detectVideoMime(buffer);
    else if (isAudioEff) detectedMime = detectAudioMime(buffer);

    // For non-media types (documents, code, archives), trust the extension
    // since there's no reliable magic-byte signature for all of them.
    if (!detectedMime && (isDocumentEff || isCodeEff || isArchiveEff)) {
      detectedMime = effectiveMime;
    }

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
