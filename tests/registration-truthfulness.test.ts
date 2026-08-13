import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase E.1 — Registration truthfulness tests.
 *
 * Tests the registration layer's truthfulness guarantees:
 * - Idempotent replay does NOT mutate existing job lifecycle.
 * - Reserved metadata keys are protected from client override.
 * - provider/model/prompt are required — no fabrication.
 * - URL must be durable HTTP(S).
 * - design/code/game are not registerable.
 */

// Mock supabase and dependencies before importing.
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => ({ data: { id: "user-uuid-001" }, error: null })),
        })),
      })),
    })),
  },
}));

vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(),
}));

vi.mock("@/lib/generation/jobs", () => ({
  createGenerationJob: vi.fn(),
  getGenerationJobByRequestId: vi.fn(),
  updateGenerationJobStatus: vi.fn(),
  getGenerationJob: vi.fn(),
}));

import { registerStudioAsset, isRegisterableAssetKind } from "@/lib/assets/registration";
import { getGenerationJobByRequestId, createGenerationJob, updateGenerationJobStatus } from "@/lib/generation/jobs";
import { getProject } from "@/lib/projects/project-repository";

const mockGetByRequestId = vi.mocked(getGenerationJobByRequestId);
const mockCreateJob = vi.mocked(createGenerationJob);
const mockUpdateStatus = vi.mocked(updateGenerationJobStatus);
const mockGetProject = vi.mocked(getProject);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetByRequestId.mockResolvedValue(null);
  mockGetProject.mockResolvedValue({ id: "proj-001" } as never);
});

const VALID_INPUT = {
  kind: "image" as const,
  url: "https://cdn.litlabs.net/img.png",
  provider: "fal",
  model: "flux-1-schnell",
  prompt: "A neon city",
};

// ─── Idempotency tests (E.1.9) ───────────────────────────────────

describe("Registration idempotency (E.1.9)", () => {
  it("returns existing asset on replay WITHOUT mutating lifecycle", async () => {
    // An existing completed job with the same requestId.
    const existingJob = {
      id: "job-existing-001",
      userId: "user-uuid-001",
      modality: "image",
      provider: "fal",
      model: "flux-1-schnell",
      status: "completed",
      prompt: "A neon city",
      requestId: "req-001",
      providerJobId: null,
      actualProviderCostCents: 1,
      littBitsCharged: 5,
      refundStatus: "none",
      assetId: "generation_job:job-existing-001",
      error: null,
      metadata: { durableUrl: "https://cdn.litlabs.net/img.png" },
      createdAt: "2026-08-14T00:00:00Z",
      completedAt: "2026-08-14T00:00:05Z",
    };
    mockGetByRequestId.mockResolvedValue(existingJob as never);

    const result = await registerStudioAsset(
      { ...VALID_INPUT, requestId: "req-001" },
      "clerk-123",
    );

    expect(result.replayed).toBe(true);
    expect(result.asset).not.toBeNull();
    expect(result.asset!.id).toBe("generation_job:job-existing-001");

    // CRITICAL: updateGenerationJobStatus must NOT be called on replay.
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    // CRITICAL: createGenerationJob must NOT be called on replay.
    expect(mockCreateJob).not.toHaveBeenCalled();
  });

  it("returns existing non-completed job truthfully without forcing completed", async () => {
    // An existing job that is still "generating" — we must not force it to completed.
    const existingJob = {
      id: "job-existing-002",
      userId: "user-uuid-001",
      modality: "image",
      provider: "fal",
      model: "flux-1-schnell",
      status: "generating",
      prompt: "A neon city",
      requestId: "req-002",
      providerJobId: null,
      actualProviderCostCents: null,
      littBitsCharged: 5,
      refundStatus: "none",
      assetId: null,
      error: null,
      metadata: {},
      createdAt: "2026-08-14T00:00:00Z",
      completedAt: null,
    };
    mockGetByRequestId.mockResolvedValue(existingJob as never);

    const result = await registerStudioAsset(
      { ...VALID_INPUT, requestId: "req-002" },
      "clerk-123",
    );

    expect(result.replayed).toBe(true);
    expect(result.asset).toBeNull(); // Not completed — no asset.
    expect(result.error).toContain("not yet available");

    // CRITICAL: must NOT mutate the existing generating job.
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockCreateJob).not.toHaveBeenCalled();
  });
});

// ─── Reserved metadata protection (E.1.10) ───────────────────────

describe("Reserved metadata protection (E.1.10)", () => {
  it("client metadata cannot override durableUrl", async () => {
    mockCreateJob.mockResolvedValue({
      id: "job-new-001",
      userId: "user-uuid-001",
      modality: "image",
      provider: "fal",
      model: "flux-1-schnell",
      status: "queued",
      prompt: "A neon city",
      requestId: "reg-job-new-001",
      providerJobId: null,
      actualProviderCostCents: null,
      littBitsCharged: 0,
      refundStatus: "none",
      assetId: null,
      error: null,
      metadata: {}, // Will be filled by createGenerationJob
      createdAt: "2026-08-14T00:00:00Z",
      completedAt: null,
    } as never);

    await registerStudioAsset(
      {
        ...VALID_INPUT,
        url: "https://cdn.litlabs.net/real.png",
        metadata: {
          durableUrl: "https://evil.com/fake.png", // Attempt to override
          projectId: "evil-project", // Attempt to override
        },
      },
      "clerk-123",
    );

    // Check that createGenerationJob was called with metadata where
    // durableUrl is the REAL url, not the client-supplied one.
    const call = mockCreateJob.mock.calls[0][0];
    expect(call.metadata?.durableUrl).toBe("https://cdn.litlabs.net/real.png");
    expect(call.metadata?.durableUrl).not.toBe("https://evil.com/fake.png");
  });

  it("client metadata cannot override projectId", async () => {
    mockCreateJob.mockResolvedValue({
      id: "job-new-002",
      userId: "user-uuid-001",
      modality: "image",
      provider: "fal",
      model: "flux-1-schnell",
      status: "queued",
      prompt: "test",
      requestId: "reg-job-new-002",
      providerJobId: null,
      actualProviderCostCents: null,
      littBitsCharged: 0,
      refundStatus: "none",
      assetId: null,
      error: null,
      metadata: {},
      createdAt: "2026-08-14T00:00:00Z",
      completedAt: null,
    } as never);

    await registerStudioAsset(
      {
        ...VALID_INPUT,
        projectId: "real-project-001",
        metadata: {
          projectId: "evil-project", // Attempt to override
        },
      },
      "clerk-123",
    );

    const call = mockCreateJob.mock.calls[0][0];
    expect(call.metadata?.projectId).toBe("real-project-001");
    expect(call.metadata?.projectId).not.toBe("evil-project");
  });

  it("non-reserved client metadata is preserved", async () => {
    mockCreateJob.mockResolvedValue({
      id: "job-new-003",
      userId: "user-uuid-001",
      modality: "image",
      provider: "fal",
      model: "flux-1-schnell",
      status: "queued",
      prompt: "test",
      requestId: "reg-job-new-003",
      providerJobId: null,
      actualProviderCostCents: null,
      littBitsCharged: 0,
      refundStatus: "none",
      assetId: null,
      error: null,
      metadata: {},
      createdAt: "2026-08-14T00:00:00Z",
      completedAt: null,
    } as never);

    await registerStudioAsset(
      {
        ...VALID_INPUT,
        metadata: {
          aspectRatio: "16:9",
          customField: "custom-value",
        },
      },
      "clerk-123",
    );

    const call = mockCreateJob.mock.calls[0][0];
    expect(call.metadata?.aspectRatio).toBe("16:9");
    expect(call.metadata?.customField).toBe("custom-value");
  });
});

// ─── No fabricated provenance (E.1.4) ────────────────────────────

describe("No fabricated provenance (E.1.4)", () => {
  it("rejects missing provider", async () => {
    const result = await registerStudioAsset(
      { ...VALID_INPUT, provider: "" } as never,
      "clerk-123",
    );
    expect(result.error).toContain("Provider is required");
    expect(result.asset).toBeNull();
  });

  it("rejects missing model", async () => {
    const result = await registerStudioAsset(
      { ...VALID_INPUT, model: "" } as never,
      "clerk-123",
    );
    expect(result.error).toContain("Model is required");
    expect(result.asset).toBeNull();
  });

  it("rejects missing prompt", async () => {
    const result = await registerStudioAsset(
      { ...VALID_INPUT, prompt: "" } as never,
      "clerk-123",
    );
    expect(result.error).toContain("Prompt is required");
    expect(result.asset).toBeNull();
  });
});

// ─── URL validation (E.1.12) ─────────────────────────────────────

describe("URL validation (E.1.12)", () => {
  it("rejects blob: URL", async () => {
    const result = await registerStudioAsset(
      { ...VALID_INPUT, url: "blob:abc123" },
      "clerk-123",
    );
    expect(result.error).toContain("durable HTTP(S)");
    expect(result.asset).toBeNull();
  });

  it("rejects data: URL", async () => {
    const result = await registerStudioAsset(
      { ...VALID_INPUT, url: "data:image/png;base64,abc" },
      "clerk-123",
    );
    expect(result.error).toContain("durable HTTP(S)");
    expect(result.asset).toBeNull();
  });

  it("rejects empty URL", async () => {
    const result = await registerStudioAsset(
      { ...VALID_INPUT, url: "" },
      "clerk-123",
    );
    expect(result.error).toContain("URL is required");
    expect(result.asset).toBeNull();
  });
});

// ─── RegisterableAssetKind (E.1.12) ──────────────────────────────

describe("RegisterableAssetKind (E.1.12)", () => {
  it("image is registerable", () => {
    expect(isRegisterableAssetKind("image")).toBe(true);
  });

  it("video is registerable", () => {
    expect(isRegisterableAssetKind("video")).toBe(true);
  });

  it("music is registerable", () => {
    expect(isRegisterableAssetKind("music")).toBe(true);
  });

  it("audio is registerable", () => {
    expect(isRegisterableAssetKind("audio")).toBe(true);
  });

  it("design is NOT registerable", () => {
    expect(isRegisterableAssetKind("design")).toBe(false);
  });

  it("code is NOT registerable", () => {
    expect(isRegisterableAssetKind("code")).toBe(false);
  });

  it("game is NOT registerable", () => {
    expect(isRegisterableAssetKind("game")).toBe(false);
  });
});
