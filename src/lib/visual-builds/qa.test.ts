import { describe, expect, it } from "vitest";
import { AssetManifestSchema, PreviewCaptureSchema, VisualBuildRequestSchema, VisualPlanSchema, VisualReviewSchema } from "./types";
import { applyRepairToSource, buildVisualPlan, determineBudget, evaluateCompletionGate, reviewCaptures, routeVisualSource } from "./qa";
import { assetInspectionIsValid, inspectAssetBuffer, validateAssetUrl } from "./security";

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+X0cAAAAASUVORK5CYII=",
  "base64",
);

describe("visual build qa", () => {
  it("routes visual sources deterministically", () => {
    expect(routeVisualSource("project-assets", "auto", 0)).toBe("project");
    expect(routeVisualSource("real-photos", "auto", 0)).toBe("stock");
    expect(routeVisualSource("ai-generated", "auto", 0)).toBe("generated");
    expect(routeVisualSource("auto", "uploaded", 1)).toBe("project");
  });

  it("validates visual plan payloads", () => {
    const request = VisualBuildRequestSchema.parse({
      prompt: "Build a branded landing page for an AI studio",
      quality: "polished",
      visualSource: "auto",
      artDirection: "editorial",
      imageSource: "stock",
      mockups: "browser",
      review: true,
      responsiveQA: true,
    });

    const plan = buildVisualPlan({
      projectId: "project-1",
      missionId: "mission-1",
      workspaceId: "workspace-1",
      request,
      projectName: "LiTT Studio",
    });

    expect(VisualPlanSchema.parse(plan)).toMatchObject({
      projectId: "project-1",
      missionId: "mission-1",
      workspaceId: "workspace-1",
      qualityLevel: "polished",
      mockupMode: "browser",
    });
    expect(plan.sectionRequirements[0]?.required).toBe(true);
  });

  it("rejects unsafe asset URLs", () => {
    expect(() => validateAssetUrl("http://localhost/image.png", ["images.unsplash.com"]))
      .toThrow(/HTTPS/);
    expect(() => validateAssetUrl("https://127.0.0.1/image.png", ["127.0.0.1"]))
      .toThrow(/private-network/);
    expect(() => validateAssetUrl("https://evil.example.com/image.png", ["images.unsplash.com"]))
      .toThrow(/allowlist/);
    expect(validateAssetUrl("https://images.unsplash.com/photo-123.jpg", ["images.unsplash.com"]).hostname)
      .toBe("images.unsplash.com");
  });

  it("inspects image buffers and rejects zero-byte assets", async () => {
    const inspection = await inspectAssetBuffer(png1x1, "image/png", { minimumWidth: 1, minimumHeight: 1 });
    expect(inspection.width).toBe(1);
    expect(inspection.height).toBe(1);
    expect(assetInspectionIsValid(inspection)).toBe(true);
    expect(inspection.quality).toBe("weak");

    const empty = await inspectAssetBuffer(Buffer.alloc(0), "image/png", { minimumWidth: 1, minimumHeight: 1 });
    expect(empty.quality).toBe("invalid");
    expect(empty.rejectionReasons).toContain("Zero-byte asset");
  });

  it("validates manifest and review shapes", () => {
    const manifest = AssetManifestSchema.parse({
      id: "manifest-1",
      projectId: "project-1",
      missionId: "mission-1",
      buildId: "build-1",
      assets: [],
      selectedCount: 0,
      rejectedCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(manifest.buildId).toBe("build-1");

    const review = reviewCaptures({
      requiredAssetCount: 1,
      captures: [
        PreviewCaptureSchema.parse({
          id: "capture-1",
          projectId: "project-1",
          missionId: "mission-1",
          buildId: "build-1",
          viewport: "mobile",
          width: 390,
          height: 844,
          screenshotUrl: null,
          consoleErrors: [],
          pageErrors: [],
          failedRequests: [],
          horizontalOverflow: true,
          documentWidth: 500,
          viewportWidth: 390,
          brokenImages: 1,
          missingFonts: 0,
          layoutShifts: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ],
    });

    expect(VisualReviewSchema.parse(review).verdict).toBe("repair");
    expect(review.findings.some((finding) => finding.category === "overflow")).toBe(true);
    expect(applyRepairToSource("width: 100vw; overflow-x: visible;", review.findings)).toContain("width: 100%;");
  });

  it("enforces completion gates and repair budgets", () => {
    const gate = evaluateCompletionGate({
      previewReady: true,
      invalidAssetCount: 0,
      horizontalOverflow: false,
      failedViewports: [],
      visualReview: { score: 100, verdict: "pass", findings: [] },
      requiredSections: [{ present: true }],
    });
    expect(gate).toBe(true);
    expect(determineBudget({ prompt: "x", quality: "draft", visualSource: "auto", artDirection: "auto", imageSource: "auto", mockups: "browser", review: true, responsiveQA: true }).maxRepairPasses).toBe(1);
  });
});
