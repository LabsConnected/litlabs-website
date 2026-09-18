// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression test for the ACT-mode approval-resume P0 (2026-09-17):
 * approving image.generate deterministically failed with "The approved
 * workspace operation failed, so the project was not completed."
 *
 * Root cause (per the 2026-09-18 re-fix): handleImageGenerate self-fetched
 * /api/media/generate over HTTP. The agent loop has no Clerk session, so
 * the route 401'd and every approved image.generate run died. The #385
 * patch (X-Internal-Service-Key + X-Agent-User-Id headers) layered header
 * auth over an unauthenticated server-to-server call instead of fixing the
 * boundary.
 *
 * The fix: the handler calls the shared image service DIRECTLY with
 * explicit trusted server-side context from the workspace transport
 * (userId, projectId, operationId). No HTTP self-fetch, no cookies
 * forwarded, no internal service-key headers — and no user ID is ever
 * read from the tool inputs.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/generation/image-service", () => ({
  generateImage: vi.fn(),
}));
vi.mock("@/lib/media", () => ({}));

import { handleImageGenerate } from "./tool-handlers";
import { toolRegistry } from "./tool-registry";
import { generateImage } from "@/lib/generation/image-service";

const mockedGenerateImage = vi.mocked(generateImage);

const OK_RESULT = {
  success: true as const,
  requestId: "approval:run_123",
  providerId: "pollinations" as const,
  downloadUrl: "https://cdn/x.png",
  thumbUrl: null,
  title: "a sunny dog park",
  id: "img_1",
  cost: 0,
  free: true,
  balance: 100,
  generationJobId: "job_1",
  assetId: "generation_job:job_1",
  assetPersistenceFailed: false,
  durationMs: 42,
};

describe("image.generate agent handler (service-direct)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockedGenerateImage.mockResolvedValue(OK_RESULT);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls the shared service with trusted transport context (never HTTP)", async () => {
    const transport = { userId: "user_abc", projectId: "proj_1", operationId: "run_123" };
    const result = (await handleImageGenerate({ prompt: "a sunny dog park" }, transport)) as {
      success: boolean;
      downloadUrl: string;
      markdown: string;
      insertHint: string;
    };

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe("https://cdn/x.png");
    expect(result.markdown).toBe("![a sunny dog park](https://cdn/x.png)");
    expect(result.insertHint).toContain("project.insert_asset");

    // The service — not an HTTP self-fetch — does the work.
    expect(mockedGenerateImage).toHaveBeenCalledTimes(1);
    const [ctx, input] = mockedGenerateImage.mock.calls[0];
    expect(ctx).toMatchObject({
      userId: "user_abc",
      projectId: "proj_1",
      requestId: "approval:run_123",
    });
    expect(input).toMatchObject({
      prompt: "a sunny dog park",
      format: "image",
      generationMode: "auto-free",
    });
    // No HTTP request leaves the handler — no cookies to forward, no
    // internal service-key headers to stuff.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("fails closed when the transport carries no user id (no fetch, no service call)", async () => {
    const result = (await handleImageGenerate(
      { prompt: "a sunny dog park" },
      { projectId: "proj_1" },
    )) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("authenticated user context");
    expect(mockedGenerateImage).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("never trusts a user id from the tool inputs", async () => {
    const result = (await handleImageGenerate(
      { prompt: "a sunny dog park", userId: "attacker_chosen_id" },
      { userId: "user_abc", projectId: "proj_1" },
    )) as { success: boolean };

    expect(result.success).toBe(true);
    const [ctx] = mockedGenerateImage.mock.calls[0];
    expect(ctx.userId).toBe("user_abc");
  });

  it("surfaces a service failure as a handler failure (no silent lie)", async () => {
    mockedGenerateImage.mockResolvedValue({
      success: false as const,
      requestId: "approval:run_123",
      providerId: "pollinations" as const,
      code: "PROVIDER_ERROR" as const,
      error: "provider exploded",
      retryable: true,
      durationMs: 10,
    });

    const result = (await handleImageGenerate(
      { prompt: "a sunny dog park" },
      { userId: "user_abc", projectId: "proj_1" },
    )) as { success: boolean; error: string; code: string; retryable: boolean };

    expect(result.success).toBe(false);
    expect(result.error).toBe("provider exploded");
    expect(result.code).toBe("PROVIDER_ERROR");
    expect(result.retryable).toBe(true);
  });

  it("uses manual mode when a providerId is given", async () => {
    await handleImageGenerate(
      { prompt: "a sunny dog park", providerId: "gemini" },
      { userId: "user_abc", projectId: "proj_1" },
    );

    const [, input] = mockedGenerateImage.mock.calls[0];
    expect(input).toMatchObject({ generationMode: "manual", providerId: "gemini" });
  });

  it("no longer requires projectId in inputs (the handler never used it)", () => {
    expect(toolRegistry.validateInputs("image.generate", { prompt: "a sunny dog park" })).toBeNull();
  });
});
