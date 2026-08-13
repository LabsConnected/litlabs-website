import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for POST /api/assets — asset registration endpoint.
 *
 * These tests mock the auth and registration layers to verify
 * the API contract without hitting real databases or providers.
 *
 * Phase E.1 contract changes:
 * - Only RegisterableAssetKind (image, video, music, audio) accepted.
 * - design, code, game are rejected at the API level (400).
 * - provider, model, prompt are REQUIRED — no fabricated provenance.
 * - URL must be durable HTTP(S) — blob: and data: rejected.
 */

// Mock auth before importing the route.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

// Mock registration before importing the route.
vi.mock("@/lib/assets/registration", () => ({
  registerStudioAsset: vi.fn(),
  isRegisterableAssetKind: vi.fn((kind: string) =>
    ["image", "video", "music", "audio"].includes(kind),
  ),
}));

// Mock the repository read (not used in POST, but imported).
vi.mock("@/lib/assets/repository", () => ({
  listStudioAssets: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { registerStudioAsset } from "@/lib/assets/registration";
import { POST } from "@/app/api/assets/route";

const mockAuth = vi.mocked(auth);
const mockRegister = vi.mocked(registerStudioAsset);

function makeReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_INPUT = {
  kind: "image",
  url: "https://cdn.litlabs.net/img.png",
  provider: "fal",
  model: "flux-1-schnell",
  prompt: "A neon city skyline at dusk",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/assets — registration endpoint", () => {
  it("rejects unauthenticated requests", async () => {
    mockAuth.mockResolvedValue({ userId: null } as never);
    const res = await POST(makeReq(VALID_INPUT));
    expect(res.status).toBe(401);
  });

  it("rejects missing kind", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ ...VALID_INPUT, kind: undefined }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("kind");
  });

  it("rejects non-registerable kind (design)", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ ...VALID_INPUT, kind: "design" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not registerable");
  });

  it("rejects non-registerable kind (code)", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ ...VALID_INPUT, kind: "code" }));
    expect(res.status).toBe(400);
  });

  it("rejects non-registerable kind (game)", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ ...VALID_INPUT, kind: "game" }));
    expect(res.status).toBe(400);
  });

  it("rejects missing url", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ ...VALID_INPUT, url: undefined }));
    expect(res.status).toBe(400);
  });

  it("rejects blob: url", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ ...VALID_INPUT, url: "blob:abc123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("HTTP");
  });

  it("rejects data: url", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ ...VALID_INPUT, url: "data:image/png;base64,abc" }));
    expect(res.status).toBe(400);
  });

  it("rejects missing provider (no fabricated provenance)", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ ...VALID_INPUT, provider: undefined }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("provider");
  });

  it("rejects missing model (no fabricated provenance)", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ ...VALID_INPUT, model: undefined }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("model");
  });

  it("rejects missing prompt (no fabricated provenance)", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ ...VALID_INPUT, prompt: undefined }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("prompt");
  });

  it("rejects empty-string provider", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ ...VALID_INPUT, provider: "" }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON body", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const req = new NextRequest("http://localhost/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("accepts valid registration and returns 201", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    mockRegister.mockResolvedValue({
      asset: {
        id: "generation_job:abc-123",
        kind: "image",
        source: "generated",
        name: "Generated Image",
        url: "https://cdn.litlabs.net/img.png",
        createdAt: "2026-08-14T00:00:00Z",
        visibility: "private",
      },
      error: null,
      replayed: false,
    } as never);

    const res = await POST(makeReq(VALID_INPUT));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.asset.id).toBe("generation_job:abc-123");
    expect(body.replayed).toBe(false);
  });

  it("returns 200 for idempotent replay", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    mockRegister.mockResolvedValue({
      asset: {
        id: "generation_job:abc-123",
        kind: "image",
        source: "generated",
        name: "Generated Image",
        url: "https://cdn.litlabs.net/img.png",
        createdAt: "2026-08-14T00:00:00Z",
        visibility: "private",
      },
      error: null,
      replayed: true,
    } as never);

    const res = await POST(makeReq({ ...VALID_INPUT, requestId: "existing-req-001" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replayed).toBe(true);
  });

  it("returns 403 for project access denied", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    mockRegister.mockResolvedValue({
      asset: null,
      error: "Project not found or access denied.",
      replayed: false,
    } as never);

    const res = await POST(makeReq({ ...VALID_INPUT, projectId: "someone-elses-project" }));
    expect(res.status).toBe(403);
  });

  it("passes projectId to registration", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    mockRegister.mockResolvedValue({
      asset: { id: "generation_job:abc", kind: "image", source: "generated", name: "test", url: "https://example.com", createdAt: "2026-01-01", visibility: "private" },
      error: null,
      replayed: false,
    } as never);

    await POST(makeReq({ ...VALID_INPUT, projectId: "proj-001" }));

    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-001" }),
      "clerk-123",
    );
  });

  it("passes all optional metadata fields", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    mockRegister.mockResolvedValue({
      asset: { id: "generation_job:abc", kind: "video", source: "generated", name: "test", url: "https://example.com", createdAt: "2026-01-01", visibility: "private" },
      error: null,
      replayed: false,
    } as never);

    await POST(makeReq({
      ...VALID_INPUT,
      kind: "video",
      url: "https://cdn.litlabs.net/video.mp4",
      thumbnailUrl: "https://cdn.litlabs.net/thumb.jpg",
      mimeType: "video/mp4",
      width: 1920,
      height: 1080,
      durationSeconds: 5,
      costCredits: 10,
      metadata: { aspectRatio: "16:9" },
    }));

    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "video",
        url: "https://cdn.litlabs.net/video.mp4",
        thumbnailUrl: "https://cdn.litlabs.net/thumb.jpg",
        mimeType: "video/mp4",
        width: 1920,
        height: 1080,
        durationSeconds: 5,
        costCredits: 10,
        metadata: { aspectRatio: "16:9" },
      }),
      "clerk-123",
    );
  });
});
