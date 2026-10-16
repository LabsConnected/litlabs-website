import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  userId: "user-b" as string | null,
  configured: true,
  signedCalls: 0,
  createBucketCalls: [] as { id: string; opts: unknown }[],
  // FIFO queue of createSignedUploadUrl results; empty means success.
  signedQueue: [] as { data: unknown; error: { message: string } | null }[],
  createBucketError: null as { message: string } | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: mocks.userId, clerkId: mocks.userId })),
}));

vi.mock("@/lib/supabase-admin", () => ({
  isAdminSupabaseConfigured: () => mocks.configured,
  getAdminSupabase: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: async () => {
          mocks.signedCalls += 1;
          return (
            mocks.signedQueue.shift() ?? {
              data: { signedUrl: "https://signed/upload", token: "tok" },
              error: null,
            }
          );
        },
        getPublicUrl: () => ({ data: { publicUrl: "https://pub/object" } }),
      }),
      createBucket: async (id: string, opts: unknown) => {
        mocks.createBucketCalls.push({ id, opts });
        return { error: mocks.createBucketError };
      },
    },
  }),
}));

import { GET } from "./route";

function req() {
  return new NextRequest(
    "https://staging.example/api/storage?key=audio/test.mp3&type=audio/mpeg",
  );
}

describe("GET /api/storage media bucket self-provisioning", () => {
  beforeEach(() => {
    mocks.userId = "user-b";
    mocks.configured = true;
    mocks.signedCalls = 0;
    mocks.createBucketCalls = [];
    mocks.signedQueue = [];
    mocks.createBucketError = null;
  });

  it("returns 401 for anonymous requests", async () => {
    mocks.userId = null;
    expect((await GET(req())).status).toBe(401);
    expect(mocks.signedCalls).toBe(0);
  });

  it("self-provisions a missing media bucket and returns 200", async () => {
    mocks.signedQueue.push({
      data: null,
      error: { message: "Bucket not found" },
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mocks.createBucketCalls).toEqual([
      { id: "media", opts: { public: true } },
    ]);
    expect(mocks.signedCalls).toBe(2);
    const body = await res.json();
    expect(body.path).toBe("user-b/audio/test.mp3");
  });

  it("does not attempt provisioning for unrelated storage errors", async () => {
    mocks.signedQueue.push({
      data: null,
      error: { message: "exceeded the maximum allowed size" },
    });
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(mocks.createBucketCalls).toHaveLength(0);
    expect(mocks.signedCalls).toBe(1);
  });

  it("returns 500 when the bucket cannot be provisioned", async () => {
    mocks.signedQueue.push({
      data: null,
      error: { message: "Bucket not found" },
    });
    mocks.createBucketError = { message: "insufficient permissions" };
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(mocks.signedCalls).toBe(1);
  });
});
