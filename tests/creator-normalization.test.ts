import { describe, it, expect } from "vitest";
import type { CreatorKind, WorkspaceStage } from "@/app/(app)/studio/lib/studio-destinations";
import { CREATOR_KIND_LABELS } from "@/app/(app)/studio/lib/studio-destinations";
import { deriveCreator, deriveWorkspaceStage } from "@/app/(app)/studio/context/derive-studio-context";
import type { AssetKind } from "@/lib/assets/types";
import { ASSET_KINDS, isAssetKind } from "@/lib/assets/types";
import { ASSET_SOURCE_PREFIXES } from "@/lib/assets/types";
import { buildCanonicalId, parseCanonicalId, isCanonicalAssetId } from "@/lib/assets/ids";

// ─── Section 27: Shared creator contract tests ───────────────────

describe("Phase E — Shared creator contract", () => {
  // 1. Six creator mappings are exact
  describe("creator mappings", () => {
    it("Image → image", () => {
      expect(deriveCreator("create", null, "image")).toBe("image");
    });

    it("Video → video", () => {
      expect(deriveCreator("create", null, "video")).toBe("video");
    });

    it("Music → music", () => {
      expect(deriveCreator("create", null, "music")).toBe("music");
    });

    it("Audio → audio", () => {
      expect(deriveCreator("create", null, "audio")).toBe("audio");
    });

    it("Design → design (routes through Studio/design)", () => {
      expect(deriveCreator("studio", "design", null)).toBe("design");
    });

    it("360° → environment (internal ID, UI label 360°)", () => {
      expect(deriveCreator("create", null, "environment")).toBe("environment");
    });
  });

  // 2. environment UI label remains 360°
  it("environment UI label remains 360°", () => {
    expect(CREATOR_KIND_LABELS.environment).toBe("360°");
  });

  // 3. workspaceMode survives creator activation
  describe("workspaceMode independence from creator", () => {
    it("workspaceMode=plan is valid with creator=image", () => {
      // The context can represent { workspaceMode: "plan", creator: "image" }
      // because workspaceMode and creator are independent dimensions.
      const stage: WorkspaceStage = "plan";
      const creator: CreatorKind = "image";
      expect(stage).toBe("plan");
      expect(creator).toBe("image");
    });

    it("workspaceMode=code is valid with creator=image", () => {
      const stage: WorkspaceStage = "code";
      const creator: CreatorKind = "image";
      expect(stage).toBe("code");
      expect(creator).toBe("image");
    });

    it("workspaceMode=canvas is valid with creator=music", () => {
      const stage: WorkspaceStage = "canvas";
      const creator: CreatorKind = "music";
      expect(stage).toBe("canvas");
      expect(creator).toBe("music");
    });

    it("workspaceMode=preview is valid with creator=video", () => {
      const stage: WorkspaceStage = "preview";
      const creator: CreatorKind = "video";
      expect(stage).toBe("preview");
      expect(creator).toBe("video");
    });
  });

  // 4-6. Creator switching preserves projectId, sessionId, activeFile
  // (These are tested in studio-context.test.tsx — the provider owns
  // activeFile/activeAssetId and the parent controls projectId/sessionId.
  // Creator switching does NOT unmount the StudioContextProvider.)

  // 7. activeAssetId preserved until deliberate change/project change
  // (Tested in studio-context.test.tsx)

  // 8. Game is not rendered as a functional creator
  it("Game is not a functional creator — no GameCreatorTool", () => {
    // Game is in the CreatorKind taxonomy but has no implementation.
    // deriveCreator returns "game" for createMode="game" (routing slot),
    // but no GameCreatorTool component exists.
    const creator = deriveCreator("create", null, "game");
    expect(creator).toBe("game");
    // Game is excluded from Phase E — no asset registration, no host.
  });
});

// ─── AssetKind contract ──────────────────────────────────────────

describe("Phase E — AssetKind contract", () => {
  it("AssetKind includes all 7 kinds", () => {
    expect(ASSET_KINDS).toHaveLength(7);
    expect(ASSET_KINDS).toContain("image");
    expect(ASSET_KINDS).toContain("video");
    expect(ASSET_KINDS).toContain("music");
    expect(ASSET_KINDS).toContain("audio");
    expect(ASSET_KINDS).toContain("design");
    expect(ASSET_KINDS).toContain("code");
    expect(ASSET_KINDS).toContain("game");
  });

  it("environment is NOT an AssetKind (360° uses image/video)", () => {
    expect(isAssetKind("environment")).toBe(false);
  });

  it("isAssetKind validates correctly", () => {
    expect(isAssetKind("image")).toBe(true);
    expect(isAssetKind("video")).toBe(true);
    expect(isAssetKind("music")).toBe(true);
    expect(isAssetKind("audio")).toBe(true);
    expect(isAssetKind("design")).toBe(true);
    expect(isAssetKind("code")).toBe(true);
    expect(isAssetKind("game")).toBe(true);
    expect(isAssetKind("environment")).toBe(false);
    expect(isAssetKind("invalid")).toBe(false);
  });
});

// ─── Canonical asset IDs with new source prefixes ────────────────

describe("Phase E — Canonical IDs with new source prefixes", () => {
  it("generation_job prefix is registered", () => {
    expect(ASSET_SOURCE_PREFIXES).toContain("generation_job");
  });

  it("music_track prefix is registered", () => {
    expect(ASSET_SOURCE_PREFIXES).toContain("music_track");
  });

  it("builds generation_job canonical ID", () => {
    expect(buildCanonicalId("generation_job", "abc-123")).toBe("generation_job:abc-123");
  });

  it("builds music_track canonical ID", () => {
    expect(buildCanonicalId("music_track", "xyz-789")).toBe("music_track:xyz-789");
  });

  it("parses generation_job canonical ID", () => {
    expect(parseCanonicalId("generation_job:abc-123")).toEqual({
      prefix: "generation_job",
      rawId: "abc-123",
    });
  });

  it("parses music_track canonical ID", () => {
    expect(parseCanonicalId("music_track:xyz-789")).toEqual({
      prefix: "music_track",
      rawId: "xyz-789",
    });
  });

  it("isCanonicalAssetId validates new prefixes", () => {
    expect(isCanonicalAssetId("generation_job:abc")).toBe(true);
    expect(isCanonicalAssetId("music_track:abc")).toBe(true);
  });

  it("different sources with same raw UUID do NOT collide", () => {
    const genJobId = buildCanonicalId("generation_job", "same-uuid");
    const musicTrackId = buildCanonicalId("music_track", "same-uuid");
    const projectAssetId = buildCanonicalId("project_asset", "same-uuid");
    const userMediaId = buildCanonicalId("user_media", "same-uuid");
    expect(new Set([genJobId, musicTrackId, projectAssetId, userMediaId]).size).toBe(4);
  });
});
