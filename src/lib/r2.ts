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

  // Return the public URL (if custom domain) or R2.dev URL
  return {
    storageKey: key,
    publicUrl: process.env.R2_PUBLIC_URL
      ? `${process.env.R2_PUBLIC_URL}/${key}`
      : `https://${BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.dev/${key}`,
  };
}

/**
 * Generate signed URL for private audio access
 * @param key - Storage key
 * @param expiresIn - Seconds until expiry (default 1 hour)
 */
export async function getSignedAudioUrl(key: string, expiresIn: number = 3600) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(r2Client, command, { expiresIn });
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
