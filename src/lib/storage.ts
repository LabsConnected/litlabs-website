export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

const config: R2Config = {
  accountId: process.env.R2_ACCOUNT_ID || "",
  accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  bucketName: process.env.R2_BUCKET_NAME || "litlabs-media",
};

export function getR2Config(): R2Config {
  return config;
}

export function getUploadUrl(key: string, contentType: string): string {
  if (!config.accountId || !config.accessKeyId) {
    return "";
  }
  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${key}`;
  return endpoint;
}

export function getPublicUrl(key: string): string {
  return process.env.NEXT_PUBLIC_MEDIA_BASE
    ? `${process.env.NEXT_PUBLIC_MEDIA_BASE}/${key}`
    : `https://media.litlabs.net/${key}`;
}