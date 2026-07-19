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

/* ------------------------------------------------------------------ */
/*  LRU cache for signed audio URLs                                    */
/*  Signed URL generation requires an internal S3 signing call. When  */
/*  the same track is requested repeatedly (e.g. album page replay),  */
/*  we can short-circuit and reuse the URL. Default TTL = 50 min;    */
/*  the caller-supplied expiresIn defaults to 60 min.                 */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  url: string;
  expiresAt: number; // ms epoch
}

const SIGNED_URL_CACHE_MAX = 256;
const signedUrlCache = new Map<string, CacheEntry>();

function lruSet(key: string, entry: CacheEntry) {
  if (signedUrlCache.size >= SIGNED_URL_CACHE_MAX) {
    // Map preserves insertion order; delete the oldest entry
    const oldest = signedUrlCache.keys().next().value;
    if (oldest !== undefined) signedUrlCache.delete(oldest);
  }
  signedUrlCache.set(key, entry);
}

/** Drop every cached signed URL that belongs to this storage key, regardless
 *  of its expiresIn variant. Cheap (linear in cache size, capped at 256). */
function bustCacheForKey(storageKey: string) {
  const prefix = `signed:${storageKey}:`;
  for (const k of signedUrlCache.keys()) {
    if (k.startsWith(prefix)) signedUrlCache.delete(k);
  }
}

function lruGet(key: string): string | null {
  const entry = signedUrlCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    signedUrlCache.delete(key);
    return null;
  }
  // bump recency
  signedUrlCache.delete(key);
  signedUrlCache.set(key, entry);
  return entry.url;
}

/**
 * Upload audio file to R2
 * @param key - Path like "music/track-123.mp3"
 * @param buffer - File buffer
 * @param contentType - MIME type (audio/mpeg, audio/wav, etc.)
 */
export async function uploadAudio(key: string, buffer: Buffer, contentType: string = 'audio/mpeg') {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    // Cache for 1 year - audio files don't change
    CacheControl: 'public, max-age=31536000, immutable',
  });

  await r2Client.send(command);

  // Bust any cached signed URL for this key since content may have changed
  bustCacheForKey(key);

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
 * Caches up to 50 minutes when expiresIn >= 60 min (default).
 * @param key - Storage key
 * @param expiresIn - Seconds until expiry (default 1 hour)
 */
export async function getSignedAudioUrl(key: string, expiresIn: number = 3600) {
  const cacheKey = `signed:${key}:${expiresIn}`;
  const cached = lruGet(cacheKey);
  if (cached) return cached;

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const url = await getSignedUrl(r2Client, command, { expiresIn });

  // Refresh 10 minutes before the signed URL itself would expire, or
  // halfway through, whichever is shorter, so callers never see a
  // just-expired URL.
  const ttlMs = Math.max(60_000, Math.min(expiresIn * 1000 - 60_000, (expiresIn * 1000) / 2));
  lruSet(cacheKey, { url, expiresAt: Date.now() + ttlMs });
  return url;
}

/**
 * Delete audio file from R2
 */
export async function deleteAudio(key: string) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await r2Client.send(command);
  bustCacheForKey(key); // best-effort cache bust (all expiresIn variants)
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
