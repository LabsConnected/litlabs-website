import { describe, it, expect } from "vitest";
import type { ProjectAsset } from "@/lib/visual-builds/types";
import type { UserMediaRow } from "@/lib/assets/adapters/user-media";
import {
  projectAssetToStudioAsset,
  mapSource,
  inferKindFromProjectAsset,
} from "@/lib/assets/adapters/project-asset";
import {
  userMediaToStudioAsset,
  inferKindFromUserMedia,
  mapVisibility,
} from "@/lib/assets/adapters/user-media";
import {
  buildCanonicalId,
  parseCanonicalId,
  isCanonicalAssetId,
  getAssetSourcePrefix,
} from "@/lib/assets/ids";
import { StudioAssetSchema } from "@/lib/assets/schemas";

// ─── Test fixtures ───────────────────────────────────────────────

function makeProjectAsset(overrides: Partial<ProjectAsset> = {}): ProjectAsset {
  return {
    id: "asset-uuid-001",
    projectId: "proj-uuid-001",
    missionId: "mission-uuid-001",
    buildId: "build-uuid-001",
    sourceType: "generated",
    provider: "fal",
    originalUrl: "https://example.com/original.png",
    storedUrl: "https://cdn.litlabs.net/asset.png",
    attribution: null,
    license: null,
    prompt: "A neon city skyline at dusk",
    query: null,
    sectionKey: "hero-image",
    width: 1920,
    height: 1080,
    bytes: 2048576,
    checksum: "sha256:abc123",
    contentType: "image/png",
    inspection: {
      reachable: true,
      statusCode: 200,
      contentType: "image/png",
      width: 1920,
      height: 1080,
      bytes: 2048576,
      aspectRatio: 1.78,
      hasAlpha: false,
      animated: false,
      checksum: "sha256:abc123",
      quality: "usable",
      rejectionReasons: [],
    },
    selected: true,
    rejected: false,
    rejectionReason: null,
    createdAt: "2026-08-13T00:00:00Z",
    updatedAt: "2026-08-13T00:00:00Z",
    ...overrides,
  };
}

function makeUserMediaRow(overrides: Partial<UserMediaRow> = {}): UserMediaRow {
  return {
    id: "media-uuid-001",
    user_id: "user-uuid-001",
    url: "https://cdn.litlabs.net/upload.jpg",
    type: "image",
    caption: "My artwork",
    is_public: true,
    category: "gallery",
    likes_count: 5,
    created_at: "2026-08-13T00:00:00Z",
    ...overrides,
  };
}

// ─── Source mapping ──────────────────────────────────────────────

describe("project_asset source mapping", () => {
  it("generated → generated", () => {
    expect(mapSource("generated")).toBe("generated");
  });

  it("uploaded → uploaded", () => {
    expect(mapSource("uploaded")).toBe("uploaded");
  });

  it("stock → imported", () => {
    expect(mapSource("stock")).toBe("imported");
  });

  it("project → imported", () => {
    expect(mapSource("project")).toBe("imported");
  });
});

// ─── Kind inference ──────────────────────────────────────────────

describe("kind inference from project_asset", () => {
  it("image/png → image", () => {
    expect(inferKindFromProjectAsset(makeProjectAsset({ contentType: "image/png" }))).toBe("image");
  });

  it("video/mp4 → video", () => {
    expect(inferKindFromProjectAsset(makeProjectAsset({ contentType: "video/mp4" }))).toBe("video");
  });

  it("audio/mpeg → audio", () => {
    expect(inferKindFromProjectAsset(makeProjectAsset({ contentType: "audio/mpeg" }))).toBe("audio");
  });

  it("unknown content type → image (fallback)", () => {
    expect(inferKindFromProjectAsset(makeProjectAsset({ contentType: "application/octet-stream" }))).toBe("image");
  });
});

describe("kind inference from user_media", () => {
  it("type=image → image", () => {
    expect(inferKindFromUserMedia(makeUserMediaRow({ type: "image" }))).toBe("image");
  });

  it("type=video → video", () => {
    expect(inferKindFromUserMedia(makeUserMediaRow({ type: "video" }))).toBe("video");
  });

  it("type=audio → audio", () => {
    expect(inferKindFromUserMedia(makeUserMediaRow({ type: "audio" }))).toBe("audio");
  });

  it("unknown type → image (fallback)", () => {
    expect(inferKindFromUserMedia(makeUserMediaRow({ type: "unknown" }))).toBe("image");
  });
});

// ─── Visibility mapping ──────────────────────────────────────────

describe("user_media visibility mapping", () => {
  it("is_public=true → public", () => {
    expect(mapVisibility(true)).toBe("public");
  });

  it("is_public=false → private", () => {
    expect(mapVisibility(false)).toBe("private");
  });
});

// ─── Project asset → StudioAsset ─────────────────────────────────

describe("projectAssetToStudioAsset", () => {
  it("maps generated asset with full provenance", () => {
    const asset = projectAssetToStudioAsset(makeProjectAsset());
    expect(asset.id).toBe("project_asset:asset-uuid-001");
    expect(asset.projectId).toBe("proj-uuid-001");
    expect(asset.kind).toBe("image");
    expect(asset.source).toBe("generated");
    expect(asset.url).toBe("https://cdn.litlabs.net/asset.png");
    expect(asset.mimeType).toBe("image/png");
    expect(asset.provider).toBe("fal");
    expect(asset.prompt).toBe("A neon city skyline at dusk");
    expect(asset.width).toBe(1920);
    expect(asset.height).toBe(1080);
    expect(asset.visibility).toBe("private");
  });

  it("preserves checksum and inspection in metadata", () => {
    const asset = projectAssetToStudioAsset(makeProjectAsset());
    expect(asset.metadata?.checksum).toBe("sha256:abc123");
    expect(asset.metadata?.inspection).toEqual(expect.objectContaining({
      reachable: true,
      statusCode: 200,
    }));
  });

  it("preserves missionId and buildId in metadata", () => {
    const asset = projectAssetToStudioAsset(makeProjectAsset());
    expect(asset.metadata?.missionId).toBe("mission-uuid-001");
    expect(asset.metadata?.buildId).toBe("build-uuid-001");
  });

  it("preserves originalUrl in metadata", () => {
    const asset = projectAssetToStudioAsset(makeProjectAsset());
    expect(asset.metadata?.originalUrl).toBe("https://example.com/original.png");
  });

  it("maps uploaded sourceType correctly", () => {
    const asset = projectAssetToStudioAsset(makeProjectAsset({ sourceType: "uploaded" }));
    expect(asset.source).toBe("uploaded");
  });

  it("maps stock sourceType to imported", () => {
    const asset = projectAssetToStudioAsset(makeProjectAsset({ sourceType: "stock" }));
    expect(asset.source).toBe("imported");
  });

  it("does NOT fabricate dimensions when null", () => {
    const asset = projectAssetToStudioAsset(
      makeProjectAsset({ width: null, height: null }),
    );
    expect(asset.width).toBeUndefined();
    expect(asset.height).toBeUndefined();
  });

  it("does NOT fabricate provider when empty", () => {
    const asset = projectAssetToStudioAsset(makeProjectAsset({ provider: "" }));
    expect(asset.provider).toBeUndefined();
  });

  it("does NOT fabricate prompt when null", () => {
    const asset = projectAssetToStudioAsset(makeProjectAsset({ prompt: null }));
    expect(asset.prompt).toBeUndefined();
  });

  it("validates against Zod schema", () => {
    const asset = projectAssetToStudioAsset(makeProjectAsset());
    const result = StudioAssetSchema.safeParse(asset);
    expect(result.success).toBe(true);
  });
});

// ─── User media → StudioAsset ────────────────────────────────────

describe("userMediaToStudioAsset", () => {
  it("maps public user_media correctly", () => {
    const asset = userMediaToStudioAsset(makeUserMediaRow({ is_public: true }));
    expect(asset.id).toBe("user_media:media-uuid-001");
    expect(asset.projectId).toBeNull();
    expect(asset.kind).toBe("image");
    expect(asset.source).toBe("imported"); // provenance unknown
    expect(asset.visibility).toBe("public");
    expect(asset.name).toBe("My artwork");
    expect(asset.url).toBe("https://cdn.litlabs.net/upload.jpg");
  });

  it("maps private user_media correctly", () => {
    const asset = userMediaToStudioAsset(makeUserMediaRow({ is_public: false }));
    expect(asset.visibility).toBe("private");
  });

  it("does NOT fabricate provider/model/prompt", () => {
    const asset = userMediaToStudioAsset(makeUserMediaRow());
    expect(asset.provider).toBeUndefined();
    expect(asset.model).toBeUndefined();
    expect(asset.prompt).toBeUndefined();
  });

  it("uses 'Untitled' when caption is null", () => {
    const asset = userMediaToStudioAsset(makeUserMediaRow({ caption: null }));
    expect(asset.name).toBe("Untitled");
  });

  it("preserves category and likes in metadata", () => {
    const asset = userMediaToStudioAsset(makeUserMediaRow());
    expect(asset.metadata?.category).toBe("gallery");
    expect(asset.metadata?.likesCount).toBe(5);
  });

  it("validates against Zod schema", () => {
    const asset = userMediaToStudioAsset(makeUserMediaRow());
    const result = StudioAssetSchema.safeParse(asset);
    expect(result.success).toBe(true);
  });
});

// ─── Canonical IDs ───────────────────────────────────────────────

describe("canonical asset IDs", () => {
  it("builds project_asset canonical ID", () => {
    expect(buildCanonicalId("project_asset", "abc-123")).toBe("project_asset:abc-123");
  });

  it("builds user_media canonical ID", () => {
    expect(buildCanonicalId("user_media", "xyz-789")).toBe("user_media:xyz-789");
  });

  it("parses a valid canonical ID", () => {
    const parsed = parseCanonicalId("project_asset:abc-123");
    expect(parsed).toEqual({ prefix: "project_asset", rawId: "abc-123" });
  });

  it("returns null for invalid format", () => {
    expect(parseCanonicalId("no-colon-here")).toBeNull();
  });

  it("returns null for unknown prefix", () => {
    expect(parseCanonicalId("unknown_source:abc-123")).toBeNull();
  });

  it("returns null for empty raw ID", () => {
    expect(parseCanonicalId("project_asset:")).toBeNull();
  });

  it("isCanonicalAssetId validates correctly", () => {
    expect(isCanonicalAssetId("project_asset:abc")).toBe(true);
    expect(isCanonicalAssetId("user_media:abc")).toBe(true);
    expect(isCanonicalAssetId("invalid")).toBe(false);
  });

  it("getAssetSourcePrefix extracts prefix", () => {
    expect(getAssetSourcePrefix("project_asset:abc")).toBe("project_asset");
    expect(getAssetSourcePrefix("user_media:abc")).toBe("user_media");
    expect(getAssetSourcePrefix("invalid")).toBeNull();
  });

  it("different sources with same raw UUID do NOT collide", () => {
    const projectAssetId = buildCanonicalId("project_asset", "same-uuid");
    const userMediaId = buildCanonicalId("user_media", "same-uuid");
    expect(projectAssetId).not.toBe(userMediaId);
  });
});
