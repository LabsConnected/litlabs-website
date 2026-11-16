/**
 * LION-RUN-DIAGNOSIS-2026-11-16 Q2/F2a — the image.generate tool handler
 * must forward the Asset Lake outcome from generateImage's result.
 *
 * Live defect (production 280035ab, 2026-11-16): the lion image WAS
 * generated and the workspace-file save succeeded ("Image generated and
 * saved to project"), yet the Media panel showed "No images yet" — the
 * panel reads only the Asset Lake (generation_jobs), and when that
 * record's persistence fails, generateImage reports it via
 * `assetPersistenceFailed` / `assetId`. The handler dropped both fields,
 * so the failure was invisible in the run record and the run was
 * diagnosed blind. These tests pin that both fields survive into the
 * tool result the agent loop records.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/generation/image-service", () => ({
  generateImage: vi.fn(),
}));

import { generateImage } from "@/lib/generation/image-service";
import { handleImageGenerate } from "../tool-handlers";

const transport = {
  userId: "user-1",
  projectId: "proj-1",
  conversationId: "conv-1",
  operationId: "op-1",
};

function successResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    requestId: "approval:op-1",
    providerId: "pollinations",
    downloadUrl: "https://cdn.test/lion.png",
    thumbUrl: null,
    title: "lion",
    id: "img-1",
    cost: 0,
    free: true,
    balance: null,
    generationJobId: "job-9",
    assetId: "generation_job:job-9",
    assetPersistenceFailed: false,
    durationMs: 1234,
    ...overrides,
  };
}

describe("handleImageGenerate — Asset Lake visibility (F2a)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards assetId and assetPersistenceFailed on a fully persisted generation", async () => {
    vi.mocked(generateImage).mockResolvedValue(successResult() as never);

    const result = (await handleImageGenerate(
      { prompt: "a lion" },
      transport,
    )) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.assetId).toBe("generation_job:job-9");
    expect(result.assetPersistenceFailed).toBe(false);
    // The chat-renderable markdown is unchanged.
    expect(result.markdown).toBe("![a lion](https://cdn.test/lion.png)");
  });

  it("surfaces a persistence failure instead of dropping it: assetId null, assetPersistenceFailed true", async () => {
    vi.mocked(generateImage).mockResolvedValue(
      successResult({
        generationJobId: null,
        assetId: null,
        assetPersistenceFailed: true,
      }) as never,
    );

    const result = (await handleImageGenerate(
      { prompt: "a lion" },
      transport,
    )) as Record<string, unknown>;

    // Generation itself succeeded — the image exists and renders in
    // chat — but the run record must show that the Asset Lake save
    // failed, which is exactly why Media would not list it.
    expect(result.success).toBe(true);
    expect(result.assetId).toBeNull();
    expect(result.assetPersistenceFailed).toBe(true);
  });

  it("does not fabricate Asset Lake fields on a failed generation", async () => {
    vi.mocked(generateImage).mockResolvedValue({
      success: false,
      error: "no provider available",
      code: "NO_PROVIDER",
      retryable: true,
    } as never);

    const result = (await handleImageGenerate(
      { prompt: "a lion" },
      transport,
    )) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(result.error).toBe("no provider available");
    expect("assetId" in result).toBe(false);
    expect("assetPersistenceFailed" in result).toBe(false);
  });
});
