import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for POST /api/assets — asset registration endpoint.
 *
 * These tests mock the auth and registration layers to verify
 * the API contract without hitting real databases or providers.
 */

// Mock auth before importing the route.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

// Mock registration before importing the route.
vi.mock("@/lib/assets/registration", () => ({
  registerStudioAsset: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/assets — registration endpoint", () => {
  it("rejects unauthenticated requests", async () => {
    mockAuth.mockResolvedValue({ userId: null } as never);
    const res = await POST(makeReq({ kind: "image", url: "https://example.com/img.png" }));
    expect(res.status).toBe(401);
  });

  it("rejects missing kind", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ url: "https://example.com/img.png" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("kind");
  });

  it("rejects invalid kind", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ kind: "invalid", url: "https://example.com/img.png" }));
    expect(res.status).toBe(400);
  });

  it("rejects missing url", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ kind: "image" }));
    expect(res.status).toBe(400);
  });

  it("rejects non-HTTP url", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    const res = await POST(makeReq({ kind: "image", url: "blob:abc123" }));
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

    const res = await POST(makeReq({
      kind: "image",
      url: "https://cdn.litlabs.net/img.png",
      provider: "fal",
      prompt: "A neon city",
    }));
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

    const res = await POST(makeReq({
      kind: "image",
      url: "https://cdn.litlabs.net/img.png",
      requestId: "existing-req-001",
    }));
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

    const res = await POST(makeReq({
      kind: "image",
      url: "https://cdn.litlabs.net/img.png",
      projectId: "someone-elses-project",
    }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for non-generation kind (design)", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    mockRegister.mockResolvedValue({
      asset: null,
      error: "Asset kind 'design' is not a generation modality. Use a different persistence strategy.",
      replayed: false,
    } as never);

    const res = await POST(makeReq({
      kind: "design",
      url: "https://cdn.litlabs.net/design.html",
    }));
    expect(res.status).toBe(400);
  });

  it("passes projectId to registration", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-123" } as never);
    mockRegister.mockResolvedValue({
      asset: { id: "generation_job:abc", kind: "image", source: "generated", name: "test", url: "https://example.com", createdAt: "2026-01-01", visibility: "private" },
      error: null,
      replayed: false,
    } as never);

    await POST(makeReq({
      kind: "image",
      url: "https://cdn.litlabs.net/img.png",
      projectId: "proj-001",
    }));

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
      kind: "video",
      url: "https://cdn.litlabs.net/video.mp4",
      thumbnailUrl: "https://cdn.litlabs.net/thumb.jpg",
      mimeType: "video/mp4",
      provider: "veo",
      model: "veo-3.1",
      prompt: "A cat playing piano",
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
        provider: "veo",
        model: "veo-3.1",
        prompt: "A cat playing piano",
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
