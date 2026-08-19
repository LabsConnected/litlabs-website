import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Video Lab — Server-side billing security", () => {
  it("generate-video route does not accept cost from client body", () => {
    const content = read("src/app/api/media/generate-video/route.ts");
    // The route must not destructure `cost` from the request body
    expect(content).not.toMatch(/cost\s*=\s*\d+.*\}.*=.*body/);
    expect(content).not.toMatch(/const.*cost.*=.*body\.cost/);
    // Must use server-authoritative pricing
    expect(content).toContain("getVideoModelPricing");
  });

  it("video-status route does not accept cost from client body", () => {
    const content = read("src/app/api/media/video-status/route.ts");
    // Must not destructure cost from request body
    expect(content).not.toMatch(/\{\s*.*cost.*\}.*=.*await.*req\.json/);
    // Must resolve cost from job store
    expect(content).toContain("findJobByOperationId");
    expect(content).toContain("job.cost");
  });

  it("alibaba-status route does not accept cost from client body", () => {
    const content = read("src/app/api/media/alibaba-status/route.ts");
    // Must not destructure cost from request body
    expect(content).not.toMatch(/cost\s*=\s*\d+/);
    // Must resolve cost from job store
    expect(content).toContain("findJobByOperationId");
    expect(content).toContain("job.cost");
  });

  it("refund uses idempotent markVideoJobRefunded", () => {
    const videoStatus = read("src/app/api/media/video-status/route.ts");
    expect(videoStatus).toContain("markVideoJobRefunded");

    const alibabaStatus = read("src/app/api/media/alibaba-status/route.ts");
    expect(alibabaStatus).toContain("markVideoJobRefunded");
  });

  it("refund verifies job belongs to authenticated user", () => {
    const videoStatus = read("src/app/api/media/video-status/route.ts");
    expect(videoStatus).toContain("job.userId !== userId");

    const alibabaStatus = read("src/app/api/media/alibaba-status/route.ts");
    expect(alibabaStatus).toContain("job.userId !== userId");
  });
});

describe("Video Lab — Model capabilities", () => {
  it("VIDEO_MODELS have capability metadata", () => {
    const content = read("src/lib/studio-models.ts");
    expect(content).toContain("VideoModelCapabilities");
    expect(content).toContain("textToVideo");
    expect(content).toContain("imageToVideo");
    expect(content).toContain("supportsReferenceImage");
  });

  it("getVideoModelPricing throws for unavailable models", () => {
    const content = read("src/lib/studio-models.ts");
    expect(content).toContain("getVideoModelPricing");
    expect(content).toMatch(/!model\.available.*throw/);
  });

  it("unavailable models cannot be selected in VideoTool", () => {
    const content = read("src/app/(app)/studio/tools/VideoTool.tsx");
    expect(content).toContain("AVAILABLE_MODELS");
    expect(content).toContain("UNAVAILABLE_MODELS");
    expect(content).toContain("Coming later");
  });

  it("Veo duration is sent to the API", () => {
    const content = read("src/app/api/media/generate-video/route.ts");
    expect(content).toContain("durationSeconds");
  });

  it("Veo reference image (imageBytes) is sent to generation", () => {
    const content = read("src/app/api/media/generate-video/route.ts");
    expect(content).toContain("imageBytes");
    expect(content).toContain("supportsReferenceImage");
  });

  it("VideoTool sends imageBytes for Veo when reference image is uploaded", () => {
    const content = read("src/app/(app)/studio/tools/VideoTool.tsx");
    expect(content).toContain("uploadedImageBase64");
    expect(content).toContain("imageBytes");
    expect(content).toContain("caps.supportsReferenceImage");
  });
});

describe("Video Lab — UI redesign", () => {
  it("VideoTool is renamed to LiTT Video Lab", () => {
    const content = read("src/app/(app)/studio/tools/VideoTool.tsx");
    expect(content).toContain("LiTT Video Lab");
  });

  it("VideoTool has three creation modes", () => {
    const content = read("src/app/(app)/studio/tools/VideoTool.tsx");
    expect(content).toContain('"quick"');
    expect(content).toContain('"animate"');
    expect(content).toContain('"director"');
  });

  it("VideoTool has camera/motion/look/composition shot controls", () => {
    const content = read("src/app/(app)/studio/tools/VideoTool.tsx");
    expect(content).toContain("CAMERA_OPTIONS");
    expect(content).toContain("MOTION_OPTIONS");
    expect(content).toContain("LOOK_OPTIONS");
    expect(content).toContain("COMPOSITION_OPTIONS");
  });

  it("VideoTool has Enhance with LiTT feature", () => {
    const content = read("src/app/(app)/studio/tools/VideoTool.tsx");
    expect(content).toContain("Enhance with LiTT");
    expect(content).toContain("enhancedPrompt");
    expect(content).toContain("showEnhanced");
  });

  it("VideoTool uses AbortController for polling cancellation", () => {
    const content = read("src/app/(app)/studio/tools/VideoTool.tsx");
    expect(content).toContain("AbortController");
    expect(content).toContain("ac.signal.aborted");
  });

  it("VideoTool revokes object URLs on cleanup", () => {
    const content = read("src/app/(app)/studio/tools/VideoTool.tsx");
    expect(content).toContain("revokeObjectURL");
  });

  it("VideoTool honors prefers-reduced-motion", () => {
    const content = read("src/app/(app)/studio/tools/VideoTool.tsx");
    expect(content).toContain("useReducedMotion");
  });
});

describe("Video Lab — Job store", () => {
  it("video-jobs module exists with required functions", () => {
    const content = read("src/lib/video-jobs.ts");
    expect(content).toContain("createVideoJob");
    expect(content).toContain("getVideoJob");
    expect(content).toContain("markVideoJobRefunded");
    expect(content).toContain("findJobByOperationId");
  });

  it("markVideoJobRefunded is idempotent (returns false on second call)", () => {
    const content = read("src/lib/video-jobs.ts");
    expect(content).toMatch(/if.*job\.refunded.*return false/);
  });
});
