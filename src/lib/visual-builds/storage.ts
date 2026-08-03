import { createHash } from "crypto";
import { createProjectAsset, getProjectAssetByChecksum, listProjectAssets } from "./repository";
import { downloadAssetBytes, type AssetFetchOptions } from "./security";
import { type AssetInspection, type ProjectAsset, type VisualSourceType } from "./types";
import { getPublicAssetUrl, uploadBinaryAsset } from "@/lib/r2";

function extensionForContentType(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("avif")) return "avif";
  return "bin";
}

function isDataUrl(url: string): url is `data:${string}` {
  return url.startsWith("data:");
}

function dataUrlToBuffer(dataUrl: string): { bytes: Buffer; contentType: string } {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) {
    throw new Error("Invalid data URL");
  }
  const contentType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const data = match[3] || "";
  return {
    contentType,
    bytes: Buffer.from(data, isBase64 ? "base64" : "utf8"),
  };
}

export async function storeProjectAsset(input: {
  projectId: string;
  missionId: string;
  buildId: string;
  userId: string;
  sourceType: VisualSourceType;
  provider: string;
  sourceUrl: string;
  originalUrl: string | null;
  inspection: AssetInspection;
  attribution?: string | null;
  license?: string | null;
  prompt?: string | null;
  query?: string | null;
  sectionKey?: string | null;
  allowedHosts?: string[];
  fetchOptions?: AssetFetchOptions;
}): Promise<ProjectAsset> {
  const existing = await getProjectAssetByChecksum(input.projectId, input.inspection.checksum);
  if (existing) {
    return existing;
  }

  let bytes: Buffer;
  let contentType = input.inspection.contentType;
  if (isDataUrl(input.sourceUrl)) {
    const parsed = dataUrlToBuffer(input.sourceUrl);
    bytes = parsed.bytes;
    contentType = parsed.contentType;
  } else {
    const downloaded = await downloadAssetBytes(input.sourceUrl, {
      allowedHosts: input.allowedHosts,
      ...input.fetchOptions,
    });
    bytes = downloaded.bytes;
    if (!contentType) {
      contentType = downloaded.contentType || input.inspection.contentType;
    }
  }

  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== input.inspection.checksum) {
    throw new Error("Stored asset checksum does not match inspection checksum");
  }

  const ext = extensionForContentType(contentType);
  const filename = `${checksum.slice(0, 12)}.${ext}`;

  const uploaded = await uploadBinaryAsset(
    input.userId,
    filename,
    bytes,
    contentType,
    "asset",
  );
  const storedUrl = uploaded.publicUrl || getPublicAssetUrl(uploaded.storageKey);

  return createProjectAsset({
    projectId: input.projectId,
    missionId: input.missionId,
    buildId: input.buildId,
    userId: input.userId,
    sourceType: input.sourceType,
    provider: input.provider,
    originalUrl: input.originalUrl,
    storedUrl,
    attribution: input.attribution ?? null,
    license: input.license ?? null,
    prompt: input.prompt ?? null,
    query: input.query ?? null,
    sectionKey: input.sectionKey ?? null,
    width: input.inspection.width,
    height: input.inspection.height,
    bytes: input.inspection.bytes,
    checksum,
    contentType,
    inspection: input.inspection,
    selected: input.inspection.quality === "usable",
    rejected: input.inspection.quality === "invalid",
    rejectionReason: input.inspection.rejectionReasons.join("; ") || null,
  });
}

export async function listReusableProjectAssets(projectId: string, sectionKey?: string) {
  return listProjectAssets(projectId, {
    sectionKey,
    limit: 20,
  });
}
