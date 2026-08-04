/**
 * Universal attachment system — types, validation, and constants.
 *
 * Supports: files, documents, images, video, audio, camera photos,
 * video recording, voice recording, screen capture, pasted links,
 * and existing project files.
 */

// ---------------------------------------------------------------------------
// Attachment categories
// ---------------------------------------------------------------------------

export type AttachmentCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "code"
  | "archive"
  | "link"
  | "project-file";

export type AttachmentStatus =
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "failed";

// ---------------------------------------------------------------------------
// Attachment model
// ---------------------------------------------------------------------------

export interface Attachment {
  /** Stable client-side ID. */
  id: string;
  /** Category for routing to the right processor. */
  category: AttachmentCategory;
  /** Original filename or link label. */
  name: string;
  /** MIME type (or "link/*" for pasted URLs). */
  mimeType: string;
  /** File size in bytes (0 for links). */
  size: number;
  /** Current processing state. */
  status: AttachmentStatus;
  /** Upload progress 0–100 (null when not uploading). */
  progress: number | null;
  /** Uploaded URL (data URL fallback or storage URL). */
  url: string | null;
  /** Thumbnail/preview URL (for images/video). */
  previewUrl: string | null;
  /** Error message when status === "failed". */
  error: string | null;
  /** Source — how the attachment was added. */
  source: "upload" | "camera" | "record-audio" | "record-video" | "screen" | "paste" | "project-file";
  /** AbortController key for canceling in-flight uploads. */
  uploadId: string | null;
}

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

export const MAX_ATTACHMENTS = 10;

export const SIZE_LIMITS: Record<AttachmentCategory, number> = {
  image: 25 * 1024 * 1024, // 25 MB
  video: 1024 * 1024 * 1024, // 1 GB
  audio: 250 * 1024 * 1024, // 250 MB
  document: 100 * 1024 * 1024, // 100 MB
  code: 10 * 1024 * 1024, // 10 MB
  archive: 500 * 1024 * 1024, // 500 MB
  link: 0,
  "project-file": 100 * 1024 * 1024, // 100 MB
};

export const ACCEPTED_MIME: Record<AttachmentCategory, string[]> = {
  image: ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/svg+xml"],
  video: ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"],
  audio: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/m4a", "audio/x-m4a", "audio/ogg", "audio/flac", "audio/webm"],
  document: [
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
  ],
  code: [
    "text/typescript",
    "text/javascript",
    "text/jsx",
    "text/tsx",
    "text/css",
    "text/html",
    "text/xml",
    "text/yaml",
    "text/x-yaml",
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
  ],
  archive: ["application/zip", "application/x-zip-compressed", "application/gzip", "application/x-tar", "application/x-7z-compressed"],
  link: [],
  "project-file": [],
};

// File extension fallbacks for when MIME type is empty or generic
export const EXTENSION_MAP: Record<string, AttachmentCategory> = {
  // Images
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", svg: "image",
  // Video
  mp4: "video", mov: "video", webm: "video", mkv: "video",
  // Audio
  mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio", flac: "audio", aac: "audio",
  // Documents
  pdf: "document", doc: "document", docx: "document",
  xls: "document", xlsx: "document",
  ppt: "document", pptx: "document",
  txt: "document", md: "document", markdown: "document",
  csv: "document", json: "document", rtf: "document",
  // Code
  ts: "code", tsx: "code", js: "code", jsx: "code",
  css: "code", html: "code", xml: "code",
  yaml: "code", yml: "code",
  py: "code", rs: "code", go: "code", java: "code",
  c: "code", cpp: "code", h: "code",
  sh: "code", sql: "code",
  // Archives
  zip: "archive", gz: "archive", tar: "archive", "7z": "archive",
};

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

export function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

export function classifyFile(file: File): AttachmentCategory {
  // Check MIME type first
  for (const [cat, mimes] of Object.entries(ACCEPTED_MIME)) {
    if ((mimes as string[]).includes(file.type)) {
      return cat as AttachmentCategory;
    }
  }
  // Fall back to extension
  const ext = getExtension(file.name);
  if (ext && EXTENSION_MAP[ext]) {
    return EXTENSION_MAP[ext];
  }
  // Generic text types
  if (file.type.startsWith("text/")) return "document";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  // Unknown — treat as document to be permissive
  return "document";
}

export function validateFile(file: File): { ok: true; category: AttachmentCategory } | { ok: false; error: string } {
  const category = classifyFile(file);
  const limit = SIZE_LIMITS[category];
  if (limit > 0 && file.size > limit) {
    const maxMB = Math.floor(limit / (1024 * 1024));
    return { ok: false, error: `${file.name} exceeds the ${maxMB} MB limit for ${category} files` };
  }
  if (file.size === 0) {
    return { ok: false, error: `${file.name} is empty` };
  }
  return { ok: true, category };
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function isLinkUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function linkCategory(url: string): AttachmentCategory {
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "link";
  if (lower.includes("github.com")) return "link";
  if (lower.includes("drive.google.com")) return "link";
  return "link";
}

// ---------------------------------------------------------------------------
// Accept strings for file inputs
// ---------------------------------------------------------------------------

export const ACCEPT_STRINGS: Record<string, string> = {
  files: ".pdf,.doc,.docx,.txt,.md,.csv,.json,.rtf,.xls,.xlsx,.ppt,.pptx",
  images: "image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml",
  video: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.mkv",
  audio: "audio/mpeg,audio/mp3,audio/wav,audio/m4a,audio/ogg,audio/flac,audio/webm,.mp3,.wav,.m4a,.ogg,.flac",
  all: ".pdf,.doc,.docx,.txt,.md,.csv,.json,.rtf,.xls,.xlsx,.ppt,.pptx,image/*,video/*,audio/*,.ts,.tsx,.js,.jsx,.css,.html,.yaml,.yml,.py,.rs,.go,.java,.c,.cpp,.sh,.sql,.zip,.gz,.tar,.7z",
};
