// Cloudflare R2 helper for audio file storage
// R2 is S3-compatible but with zero egress fees - perfect for music streaming

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// R2 uses S3-compatible API
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'littree-music';

// ─── Security: upload validation ───────────────────────────────────

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME_TYPES = new Set([
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac',
  'audio/aac', 'audio/mp4', 'audio/webm',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm',
  'application/octet-stream',
]);

const ALLOWED_CATEGORIES = new Set(['audio', 'image', 'video', 'asset']);

/**
 * Sanitize a filename to prevent path traversal and dangerous characters.
 * Returns a safe filename or throws if the input is invalid.
 */
function sanitizeFilename(filename: string): string {
  if (!filename || filename.length > 255) {
    throw new Error('Invalid filename: must be 1-255 characters');
  }
  // Remove any path separators or traversal attempts
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  if (!safe || safe === '.' || safe === '..') {
    throw new Error('Invalid filename: sanitized to empty or dangerous value');
  }
  return safe.slice(-200);
}

/**
 * Build a user-scoped storage key that enforces ownership.
 * All R2 objects must be stored under a path prefixed with the user's ID.
 */
function buildOwnedKey(userId: string, filename: string, category: string): string {
  if (!userId || userId.length < 3) {
    throw new Error('Invalid userId for R2 ownership');
  }
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw new Error(`Invalid upload category: ${category}. Allowed: ${[...ALLOWED_CATEGORIES].join(', ')}`);
  }
  const safeName = sanitizeFilename(filename);
  return `${userId}/${category}/${Date.now()}_${safeName}`;
}

/**
 * Validate that a storage key belongs to the specified user.
 * This prevents cross-user access via guessed keys.
 */
function validateOwnership(userId: string, key: string): void {
  if (!userId || userId.length < 3) {
    throw new Error('Invalid userId for R2 ownership check');
  }
  // Key must start with the user's ID as the first path segment
  const prefix = `${userId}/`;
  if (!key.startsWith(prefix)) {
    throw new Error(`R2 ownership violation: key "${key}" does not belong to user "${userId}"`);
  }
  // Block path traversal in the remaining path
  if (key.includes('..') || key.includes('//')) {
    throw new Error(`R2 key contains path traversal: "${key}"`);
  }
}

/**
 * Validate MIME type against the allowlist.
 */
function validateMimeType(contentType: string): void {
  if (!contentType || !ALLOWED_MIME_TYPES.has(contentType)) {
    throw new Error(`MIME type "${contentType}" is not allowed. Allowed: ${[...ALLOWED_MIME_TYPES].slice(0, 8).join(', ')}...`);
  }
}

/**
 * Validate file size.
 */
function validateFileSize(bufferLength: number): void {
  if (bufferLength <= 0) {
    throw new Error('File is empty');
  }
  if (bufferLength > MAX_FILE_SIZE) {
    throw new Error(`File size ${bufferLength} exceeds maximum ${MAX_FILE_SIZE} bytes (50 MB)`);
  }
}

/**
 * Upload audio file to R2 with ownership validation.
 * @param userId - The authenticated user's ID (required for ownership)
 * @param filename - Original filename
 * @param buffer - File buffer
 * @param contentType - MIME type (audio/mpeg, audio/wav, etc.)
 * @param category - Upload category (audio, image, video, asset)
 */
export async function uploadAudio(
  userId: string,
  filename: string,
  buffer: Buffer,
  contentType: string = 'audio/mpeg',
  category: string = 'audio',
) {
  validateMimeType(contentType);
  validateFileSize(buffer.length);
  const key = buildOwnedKey(userId, filename, category);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    // Cache for 1 year - audio files don't change
    CacheControl: 'public, max-age=31536000, immutable',
  });

  await r2Client.send(command);

  // Return the public URL (if custom domain) or R2.dev URL
  return {
    storageKey: key,
    publicUrl: process.env.R2_PUBLIC_URL
      ? `${process.env.R2_PUBLIC_URL}/${key}`
      : `https://${BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.dev/${key}`,
  };
}

/**
 * Generate signed URL for private audio access.
 * Validates that the requesting user owns the object.
 * @param userId - The authenticated user's ID
 * @param key - Storage key (must start with userId/)
 * @param expiresIn - Seconds until expiry (default 1 hour)
 */
export async function getSignedAudioUrl(userId: string, key: string, expiresIn: number = 3600) {
  validateOwnership(userId, key);
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(r2Client, command, { expiresIn });
}

/**
 * Delete audio file from R2.
 * Validates that the requesting user owns the object.
 * @param userId - The authenticated user's ID
 * @param key - Storage key (must start with userId/)
 */
export async function deleteAudio(userId: string, key: string) {
  validateOwnership(userId, key);
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await r2Client.send(command);
  return { deleted: true };
}

/**
 * Get R2 public URL for a track
 * Use this when tracks should be publicly accessible without signed URLs
 */
export function getPublicAudioUrl(key: string) {
  if (process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL}/${key}`;
  }
  return `https://${BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.dev/${key}`;
}

export async function uploadBinaryAsset(
  userId: string,
  filename: string,
  body: Buffer,
  contentType: string,
  category: string = 'asset',
  cacheControl = "public, max-age=31536000, immutable",
) {
  validateMimeType(contentType);
  validateFileSize(body.length);
  const key = buildOwnedKey(userId, filename, category);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
  });

  await r2Client.send(command);

  return {
    storageKey: key,
    publicUrl: getPublicAssetUrl(key),
  };
}

export async function deleteBinaryAsset(userId: string, key: string) {
  validateOwnership(userId, key);
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await r2Client.send(command);
  return { deleted: true };
}

export function getPublicAssetUrl(key: string) {
  if (process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL}/${key}`;
  }
  return `https://${BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.dev/${key}`;
}
